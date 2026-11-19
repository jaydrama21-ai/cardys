#!/usr/bin/env python3
"""Train the grade-odds model and decide whether the app may show odds.

Input: anonymous slab results exported from the backend
    curl -H "Authorization: Bearer $ADMIN_TOKEN" https://API/api/admin/slab-results > slabs.json
    python3 train.py slabs.json            # writes manifest.json next to this file

Each result carries `features` (shared/model.js FEATURE_NAMES order, computed on
the phone at scan time) and the real `grade` the slab came back with.

Model: one multinomial logistic regression per grader over that grader's
outcome ladder (PSA: 10 / 9 / 8 / ≤7, BGS: 10 / 9.5 / 9 / ≤8.5, ...).
Small, explainable, and it runs in the app as plain JSON math.

LAUNCH GATE (canvas note "betaWhen"), checked per grader on held-out cards:
  1. beats "guess the average" by 10%+  → mean absolute grade error at most
     90% of the baseline that always predicts the training-set mean grade
  2. lands within one grade on 75%+ of held-out cards
  3. at least MIN_TEST held-out cards (so the numbers mean something)
Only graders that pass are written to the manifest. `enabled` is true only if
at least one grader passes. The app reads `enabled` and shows odds only then.

Only numpy is needed.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import date
from pathlib import Path

import numpy as np

FEATURE_NAMES = [
    "front_lr_worst", "front_tb_worst", "back_lr_worst", "back_tb_worst",
    "front_sharpness_log", "back_sharpness_log", "front_glare", "back_glare",
    "closeups", "tilt_shots", "holo",
]
LADDERS = {
    "PSA": ["10", "9", "8", "≤7"],
    "BGS": ["10", "9.5", "9", "≤8.5"],
    "CGC": ["10", "9.5", "9", "≤8.5"],
    "TAG": ["10", "9", "8", "≤7"],
}
MIN_TEST = 30
GATE_MAE_RATIO = 0.90
GATE_WITHIN1 = 0.75


def ladder_class(grader: str, grade: str) -> int:
    """Index on the grader's outcome ladder for a real slab grade."""
    g = float(grade)
    ladder = LADDERS[grader]
    for i, label in enumerate(ladder[:-1]):
        if g >= float(label):
            return i
    return len(ladder) - 1


def class_value(grader: str, k: int) -> float:
    """Numeric grade a ladder class stands for (bottom bucket = its ceiling − 1)."""
    label = LADDERS[grader][k]
    if label.startswith("≤"):
        return float(label[1:]) - 1.0
    return float(label)


def softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def fit_softmax(X: np.ndarray, y: np.ndarray, k: int, l2: float = 1e-2, lr: float = 0.2, steps: int = 3000):
    n, d = X.shape
    W = np.zeros((k, d))
    b = np.zeros(k)
    Y = np.eye(k)[y]
    for _ in range(steps):
        P = softmax(X @ W.T + b)
        G = (P - Y) / n
        W -= lr * (G.T @ X + l2 * W)
        b -= lr * G.sum(axis=0)
    return W, b


def evaluate(grader: str, P: np.ndarray, y: np.ndarray, train_mean: float) -> dict:
    vals = np.array([class_value(grader, i) for i in range(P.shape[1])])
    actual = vals[y]
    pred = vals[P.argmax(axis=1)]
    mae = float(np.abs(pred - actual).mean())
    mae_base = float(np.abs(train_mean - actual).mean())
    within1 = float((np.abs(pred - actual) <= 1.0).mean())
    exact = float((pred == actual).mean())
    return {"mae": mae, "maeBaseline": mae_base, "within1": within1, "exact": exact, "n": int(len(y))}


def passes(m: dict) -> bool:
    return (
        m["n"] >= MIN_TEST
        and m["maeBaseline"] > 0
        and m["mae"] <= GATE_MAE_RATIO * m["maeBaseline"]
        and m["within1"] >= GATE_WITHIN1
    )


def train_grader(grader: str, rows: list[dict], seed: int = 7) -> dict:
    X = np.array([r["features"] for r in rows], dtype=float)
    y = np.array([ladder_class(grader, r["grade"]) for r in rows])
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(rows))
    cut = int(len(rows) * 0.8)
    tr, te = idx[:cut], idx[cut:]
    mean = X[tr].mean(axis=0)
    std = X[tr].std(axis=0)
    std[std == 0] = 1.0
    Xs = (X - mean) / std
    k = len(LADDERS[grader])
    W, b = fit_softmax(Xs[tr], y[tr], k)
    vals = np.array([class_value(grader, i) for i in range(k)])
    train_mean = float(vals[y[tr]].mean())
    metrics = evaluate(grader, softmax(Xs[te] @ W.T + b), y[te], train_mean)
    # Refit on everything for the shipped weights once the held-out check is done.
    W_all, b_all = fit_softmax(Xs, y, k)
    return {
        "metrics": metrics,
        "passed": passes(metrics),
        "model": {
            "classes": LADDERS[grader],
            "mean": mean.round(6).tolist(),
            "std": std.round(6).tolist(),
            "W": W_all.round(6).tolist(),
            "b": b_all.round(6).tolist(),
        },
    }


def build_manifest(results: list[dict], version: str | None = None) -> dict:
    usable = [
        r for r in results
        if r.get("grader") in LADDERS
        and isinstance(r.get("features"), list)
        and len(r["features"]) == len(FEATURE_NAMES)
        and all(isinstance(v, (int, float)) and math.isfinite(v) for v in r["features"])
    ]
    graders, report = {}, {}
    for g in LADDERS:
        rows = [r for r in usable if r["grader"] == g]
        if len(rows) < MIN_TEST * 5:  # need 150+ to hold out 30
            report[g] = {"passed": False, "reason": f"only {len(rows)} results with photos (need {MIN_TEST * 5})"}
            continue
        out = train_grader(g, rows)
        report[g] = {"passed": out["passed"], **out["metrics"]}
        if out["passed"]:
            graders[g] = out["model"]
    return {
        "enabled": bool(graders),
        "version": version or date.today().isoformat(),
        "featureNames": FEATURE_NAMES,
        "gate": {"maeRatio": GATE_MAE_RATIO, "within1": GATE_WITHIN1, "minTest": MIN_TEST},
        "report": report,
        "graders": graders,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    results = json.loads(Path(argv[1]).read_text())
    manifest = build_manifest(results)
    out = Path(argv[2]) if len(argv) > 2 else Path(__file__).with_name("manifest.json")
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    for g, r in manifest["report"].items():
        if "mae" in r:
            print(f"{g}: {'PASS' if r['passed'] else 'fail'}  within-1 {r['within1']:.0%}  MAE {r['mae']:.2f} vs baseline {r['maeBaseline']:.2f}  (n={r['n']})")
        else:
            print(f"{g}: fail  {r['reason']}")
    print(f"Odds {'ENABLED' if manifest['enabled'] else 'stay OFF'} → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
