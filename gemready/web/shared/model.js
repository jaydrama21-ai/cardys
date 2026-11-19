// Grade-odds model: feature extraction + inference.
//
// The model is a per-grader multinomial logistic regression over features the
// phone already computes (centering, photo checks, how many photos). It is
// small enough to ship as JSON in model/manifest.json and run anywhere.
// The training pipeline (model/train.py) reads the same FEATURE_NAMES in the
// same order — change both together.
//
// The app only shows odds when manifest.enabled is true. The pipeline sets that
// flag only when the held-out evaluation clears the launch gate.

export const FEATURE_NAMES = [
  "front_lr_worst", // larger-side % left/right, e.g. 55
  "front_tb_worst",
  "back_lr_worst",
  "back_tb_worst",
  "front_sharpness_log",
  "back_sharpness_log",
  "front_glare",
  "back_glare",
  "closeups",
  "tilt_shots",
  "holo",
];

const worst = (f) => (f == null ? 50 : Math.round(Math.max(f, 1 - f) * 100));

/** Feature vector from a saved scan (see web/js/scan.js for the shape). */
export function featuresFromScan(scan) {
  const f = scan.front?.centering, b = scan.back?.centering;
  return [
    worst(f?.lr), worst(f?.tb), worst(b?.lr), worst(b?.tb),
    Math.log1p(scan.front?.checks?.sharpness ?? 0),
    Math.log1p(scan.back?.checks?.sharpness ?? 0),
    scan.front?.checks?.glare ?? 0,
    scan.back?.checks?.glare ?? 0,
    scan.closeups ?? 0,
    scan.tilt ?? 0,
    scan.holo ? 1 : 0,
  ];
}

function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/**
 * Odds for one grader, or null when the model is off or doesn't cover it.
 * Returns { probs: { [grade]: p }, mostLikely, chance, next }.
 */
export function predict(manifest, grader, x) {
  if (!manifest?.enabled) return null;
  const m = manifest.graders?.[grader];
  if (!m) return null;
  const xs = x.map((v, i) => (v - m.mean[i]) / (m.std[i] || 1));
  const z = m.W.map((row, k) => row.reduce((s, w, i) => s + w * xs[i], m.b[k]));
  const p = softmax(z);
  const probs = Object.fromEntries(m.classes.map((c, k) => [c, p[k]]));
  const order = m.classes.map((c, k) => [c, p[k]]).sort((a, b) => b[1] - a[1]);
  return { probs, mostLikely: order[0][0], chance: order[0][1], next: order[1]?.[0] ?? null };
}
