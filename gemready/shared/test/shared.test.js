import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeCard, boxBlur, darken } from "./fixtures.js";
import { findCardBounds, measureCentering, photoChecks, glare, borderMarks } from "../analysis.js";
import { centeringGrade, ratioLabel, candidateClass, gemChecks } from "../grading.js";
import { ebayFee, netVsRaw, pickTier, outcomeRows, worthItAt, verdict, planBatches, expectedNet } from "../outcomes.js";

const fees = JSON.parse(readFileSync(new URL("../fees.json", import.meta.url)));

// ---------------- analysis ----------------

test("finds the card's outer edges", () => {
  const img = makeCard();
  const b = findCardBounds(img);
  assert.ok(Math.abs(b.left - 114) <= 4, `left ${b.left}`);
  assert.ok(Math.abs(b.right - 686) <= 4, `right ${b.right}`);
  assert.ok(Math.abs(b.top - 100) <= 4, `top ${b.top}`);
  assert.ok(Math.abs(b.bottom - 900) <= 4, `bottom ${b.bottom}`);
  assert.ok(b.confidence > 0.3, `confidence ${b.confidence}`);
});

test("measures 60/40 left-right and 50/50 top-bottom", () => {
  const c = measureCentering(makeCard({ border: { left: 30, right: 20, top: 36, bottom: 36 } }));
  assert.equal(ratioLabel(c.lr), "60/40");
  assert.equal(ratioLabel(c.tb), "50/50");
});

test("measures 55/45 within a point across shapes", () => {
  for (const [l, r] of [[22, 18], [33, 27], [44, 36]]) {
    const c = measureCentering(makeCard({ border: { left: l, right: r, top: 30, bottom: 30 } }));
    const pct = Math.round(Math.max(c.lr, 1 - c.lr) * 100);
    assert.ok(Math.abs(pct - 55) <= 1, `${l}/${r} → ${pct}`);
  }
});

test("works on a smaller, off-center card in frame", () => {
  const c = measureCentering(makeCard({ card: { left: 60, top: 140, width: 500, height: 700 }, border: { left: 20, right: 30, top: 24, bottom: 36 } }));
  assert.equal(ratioLabel(c.lr), "60/40");
  assert.equal(ratioLabel(c.tb), "60/40");
});

test("finds the border, not the stronger art-box edge inside it", () => {
  const img = makeCard({ innerBox: true, border: { left: 34, right: 26, top: 40, bottom: 40 } });
  const b = findCardBounds(img);
  assert.ok(Math.abs(b.top - 100) <= 4, `top ${b.top}`);
  const c = measureCentering(img);
  assert.equal(ratioLabel(c.lr), "57/43");
  assert.equal(ratioLabel(c.tb), "50/50");
});

test("a flat card back with crisp edges isn't called blurry", () => {
  const r = photoChecks(makeCard({ flat: true }));
  assert.ok(!r.issues.some((i) => i.kind === "blur"), JSON.stringify(r.scores));
});

test("sharp, well-lit card passes photo checks", () => {
  const r = photoChecks(makeCard());
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("blur is caught", () => {
  const r = photoChecks(boxBlur(makeCard(), 7));
  assert.ok(r.issues.some((i) => i.kind === "blur"), JSON.stringify(r));
});

test("dark photo is caught", () => {
  const r = photoChecks(darken(makeCard(), 0.15));
  assert.ok(r.issues.some((i) => i.kind === "dark"));
});

test("glare is caught and located", () => {
  const img = makeCard({ glareAt: { x: 600, y: 200, r: 70 } });
  const g = glare(img, findCardBounds(img));
  assert.equal(g.glare, true);
  assert.equal(g.where, "top right");
});

test("clean border has no marks", () => {
  const img = makeCard();
  assert.equal(borderMarks(img, measureCentering(img)), false);
});

// ---------------- grading ----------------

test("PSA centering caps", () => {
  assert.equal(centeringGrade("PSA", { lr: 0.45, tb: 0.5 }, { lr: 0.3, tb: 0.5 }).grade, "10"); // 55/45 · 70/30
  assert.equal(centeringGrade("PSA", { lr: 0.42, tb: 0.5 }, { lr: 0.5, tb: 0.5 }).grade, "9");  // 58/42
  assert.equal(centeringGrade("PSA", { lr: 0.38, tb: 0.5 }, null).grade, "8");                  // 62/38
  assert.equal(centeringGrade("PSA", { lr: 0.5, tb: 0.5 }, { lr: 0.2, tb: 0.5 }).grade, "9");    // back 80/20
});

test("BGS 10 needs perfect centering", () => {
  assert.equal(centeringGrade("BGS", { lr: 0.5, tb: 0.5 }, { lr: 0.46, tb: 0.5 }).grade, "10");
  assert.equal(centeringGrade("BGS", { lr: 0.45, tb: 0.5 }, { lr: 0.45, tb: 0.5 }).grade, "9.5");
});

test("candidate class in beta uses only the centering cap", () => {
  assert.equal(candidateClass({ centeringCap: "8", threshold: "9" }), "weak");
  assert.equal(candidateClass({ centeringCap: "10", threshold: "9" }), "unknown");
  assert.equal(candidateClass({ mostLikely: "10", centeringCap: "10", threshold: "9" }), "strong");
  assert.equal(candidateClass({ mostLikely: "9", centeringCap: "10", threshold: "9" }), "maybe");
});

test("gem route needs every check", () => {
  const ok = gemChecks({ grader: "PSA", photos: { full: 2, closeups: 16, tilt: 2 }, front: { lr: 0.48, tb: 0.46 }, back: { lr: 0.5, tb: 0.5 } });
  assert.equal(ok.gem, true);
  const miss = gemChecks({ grader: "PSA", photos: { full: 2, closeups: 12, tilt: 0 }, front: { lr: 0.48, tb: 0.42 }, back: null });
  assert.equal(miss.gem, false);
  assert.equal(miss.failed.length, 3); // close-ups, tilt, centering
});

// ---------------- outcomes ----------------

test("eBay fee: 13.25% to $7,500, 2.35% above, + $0.40", () => {
  assert.equal(ebayFee(4200, fees.ebay), 556.9); // matches the canvas copy
  assert.equal(ebayFee(7200, fees.ebay), 954.4);
  assert.equal(ebayFee(10000, fees.ebay), 1052.9); // 993.75 + 58.75 + 0.40
  assert.equal(ebayFee(8, fees.ebay), 1.36); // 1.06 + 0.30
});

test("net vs raw takes eBay off both sides", () => {
  // sale 7,200 · raw 4,200 · cost 164.95
  // (7200 − 954.40 − 164.95) − (4200 − 556.90) = 2,437.55
  assert.equal(netVsRaw({ sale: 7200, raw: 4200, cost: 164.95, ebay: fees.ebay }), 2437.55);
});

test("picks the cheapest open tier that covers the value", () => {
  assert.equal(pickTier(fees, "TAG", 400).id, "tag-base");
  assert.equal(pickTier(fees, "TAG", 1200).id, "tag-priority");
  assert.equal(pickTier(fees, "TAG", 4500).id, "tag-premier");
  assert.equal(pickTier(fees, "TAG", 20000), null);
  assert.equal(pickTier(fees, "PSA", 900).id, "psa-regular"); // value tiers paused
  assert.equal(pickTier(fees, "BGS", 300).valueLimitUnknown, true);
});

test("outcome rows hide nets with fewer than 3 sales", () => {
  const tier = pickTier(fees, "PSA", 300);
  const rows = outcomeRows({
    grader: "PSA", raw: 120, tier, ebay: fees.ebay,
    comps: { "10": { value: 600, sales: 5 }, "9": { value: 200, sales: 2 } },
  });
  assert.equal(rows[0].reason, null);
  assert.ok(rows[0].net > 0);
  assert.equal(rows[1].reason, "TOO_FEW_SALES");
  assert.equal(rows[2].reason, "NO_RECENT_SALES");
});

test("worth-it grade and verdict", () => {
  const rows = [
    { grade: "10", net: 900 }, { grade: "9", net: 40 }, { grade: "8", net: -60 }, { grade: "≤7", net: null },
  ];
  assert.equal(worthItAt(rows, 0), "9");
  assert.equal(worthItAt(rows, 100), "10");
  assert.equal(verdict(rows, 100).worthAt, "10");
  assert.equal(verdict([{ grade: "10", net: -5 }], 0).kind, "not-worth");
});

test("expected net needs odds", () => {
  assert.equal(expectedNet([{ grade: "10", net: 100, prob: null }]), null);
  assert.equal(expectedNet([{ grade: "10", net: 100, prob: 0.5 }, { grade: "9", net: -20, prob: 0.5 }]), 40);
});

test("batches share a tier and flag minimums", () => {
  const out = planBatches([
    { id: "a", grader: "TAG", value: 300 }, { id: "b", grader: "TAG", value: 200 }, { id: "c", grader: "TAG", value: 450 },
  ], fees);
  assert.equal(out.length, 1);
  assert.equal(out[0].tier.id, "tag-base");
  assert.equal(out[0].needMore, 2);
});

// ---------------- model ----------------
import { predict, featuresFromScan, FEATURE_NAMES } from "../model.js";

test("JS inference matches the Python trainer exactly", () => {
  const d = JSON.parse(readFileSync(new URL("./model-fixture.json", import.meta.url)));
  const r = predict(d.m, "PSA", d.x);
  d.m.graders.PSA.classes.forEach((c, i) => assert.ok(Math.abs(r.probs[c] - d.p[i]) < 1e-9));
  assert.equal(predict({ ...d.m, enabled: false }, "PSA", d.x), null); // gate off → no odds
});

test("scan features line up with FEATURE_NAMES", () => {
  const x = featuresFromScan({ front: { centering: { lr: 0.45, tb: 0.5 }, checks: { sharpness: 100, glare: 0.01 } }, closeups: 16, tilt: 2, holo: true });
  assert.equal(x.length, FEATURE_NAMES.length);
  assert.equal(x[0], 55);
  assert.equal(x[2], 50); // no back photo → neutral
});
