import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { FileStore } from "../src/store.js";
import { accuracyStats } from "../src/accuracy.js";
import { compsFromPriceCharting } from "../src/prices.js";
import { hintsFromText, matchCatalog } from "../src/catalog/match.js";

const dir = mkdtempSync(join(tmpdir(), "gemready-"));
process.env.TRAINING_DIR = join(dir, "training");
const storePath = join(dir, "store.json");
const store = new FileStore(storePath);
let base = "";
let server: any;

before(async () => {
  await store.init();
  server = createApp(store).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

const j = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  return { status: r.status, body: await r.json() };
};

test("health and config", async () => {
  const h = await j("/health");
  assert.equal(h.body.ok, true);
  const c = await j("/config");
  assert.equal(c.body.modelEnabled, false); // odds stay off until the gate passes
  assert.equal(c.body.sampleData, true);
});

test("match reads name and number from OCR text", async () => {
  const hints = hintsFromText("Umbreon ex\nHP 280\n161/131 SIR");
  assert.equal(hints.number, "161/131");
  assert.equal(hints.name, "Umbreon ex");
  assert.equal(matchCatalog(hints).id, "pre-umbreon-ex-sir");
  const r = await j("/match", { method: "POST", body: JSON.stringify({ text: "Charizard ex\n199/165" }) });
  assert.equal(r.body.id, "mew-charizard-ex-sir");
});

test("outcomes: real fee math, tier choice and the 3-sale rule", async () => {
  const r = await j("/outcomes/pre-umbreon-ex-sir?grader=PSA");
  assert.equal(r.status, 200);
  const o = r.body;
  assert.equal(o.raw, 1350);
  // Top PSA comp = 1350 × 3.2 = 4320 → cheapest open PSA tier covering $4,320.
  assert.equal(o.tier.id, "psa-super-express");
  const ten = o.rows.find((x: any) => x.grade === "10");
  // (4320 − fee(4320)) − 349 − (1350 − fee(1350))
  const fee = (v: number) => Math.round((v * 0.1325 + 0.4) * 100) / 100;
  const expected = Math.round(((4320 - fee(4320) - 349) - (1350 - fee(1350))) * 100) / 100;
  assert.equal(ten.net, expected);
  const seven = o.rows.find((x: any) => x.grade === "≤7");
  assert.equal(seven.reason, "TOO_FEW_SALES");
  assert.ok(o.feesAsOf);
});

test("compare covers all four graders", async () => {
  const r = await j("/compare/ssp-milotic-ex-sir");
  assert.deepEqual(r.body.graders.map((g: any) => g.grader), ["PSA", "BGS", "CGC", "TAG"]);
});

test("anonymous sign-in, alerts, and Delete My Data", async () => {
  const a = await j("/anon", { method: "POST", body: JSON.stringify({ under13: false }) });
  const auth = { authorization: `Bearer ${a.body.token}` };
  const put = await j("/alerts/pre-espeon-ex-sir", { method: "PUT", headers: auth });
  assert.equal(put.body.below, 168);
  assert.equal(put.body.above, 252);
  assert.equal((await j("/alerts", { headers: auth })).body.length, 1);
  assert.equal((await j("/me", { method: "DELETE", headers: auth })).body.ok, true);
  assert.equal((await j("/me", { headers: auth })).status, 401);
  const saved = JSON.parse(readFileSync(storePath, "utf8"));
  assert.equal(saved.alerts.length, 0);
  // The raw token is never stored.
  assert.ok(!readFileSync(storePath, "utf8").includes(a.body.token));
});

test("under-13 accounts can't set alerts or upload photos", async () => {
  const a = await j("/anon", { method: "POST", body: JSON.stringify({ under13: true }) });
  const auth = { authorization: `Bearer ${a.body.token}` };
  assert.equal((await j("/alerts/pre-espeon-ex-sir", { method: "PUT", headers: auth })).status, 403);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 1)]).toString("base64");
  assert.equal((await j("/training", { method: "POST", headers: auth, body: JSON.stringify({ image: jpeg, grader: "PSA", grade: "9" }) })).status, 403);
});

test("training upload accepts a clean JPEG crop and rejects EXIF", async () => {
  const a = await j("/anon", { method: "POST", body: JSON.stringify({ under13: false }) });
  const auth = { authorization: `Bearer ${a.body.token}` };
  const clean = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 1)]).toString("base64");
  assert.equal((await j("/training", { method: "POST", headers: auth, body: JSON.stringify({ image: clean, grader: "PSA", grade: "9", side: "front", slot: "full" }) })).status, 200);
  const exif = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from("Exif"), Buffer.alloc(2000, 1)]).toString("base64");
  assert.equal((await j("/training", { method: "POST", headers: auth, body: JSON.stringify({ image: exif, grader: "PSA", grade: "9" }) })).status, 400);
});

test("slab results store no user link and validate grades", async () => {
  const bad = await j("/slab-results", { method: "POST", body: JSON.stringify({ grader: "XYZ", grade: "11" }) });
  assert.equal(bad.status, 400);
  const ok = await j("/slab-results", {
    method: "POST",
    headers: { authorization: "Bearer whatever" },
    body: JSON.stringify({ grader: "PSA", grade: "9", estimate: { mostLikely: "9", centeringCap: "10" }, sentOn: "2026-10-01", returnedOn: "2026-10-30", email: "me@x.com" }),
  });
  assert.equal(ok.status, 200);
  const saved = JSON.parse(readFileSync(storePath, "utf8")).slabResults.at(-1);
  assert.equal(saved.email, undefined);
  assert.deepEqual(Object.keys(saved).sort(), ["cardId", "day", "estimate", "features", "grade", "grader", "holo", "modelVersion", "returnedOn", "sentOn", "soldFor", "tier"].sort());
});

test("accuracy waits for 30 results, then reports within-one and misses", async () => {
  const mk = (est: string, act: string, grader = "PSA") => ({ day: "2026-11-01", grader, grade: act, tier: null, cardId: null, holo: false, estimate: { mostLikely: est, probs: null, centeringCap: null }, features: null, sentOn: null, returnedOn: null, soldFor: null, modelVersion: "t" });
  assert.equal(accuracyStats([mk("9", "9")]).enough, false);
  const rows = [...Array(20)].map(() => mk("9", "9")).concat([...Array(8)].map(() => mk("10", "9")), [mk("9", "7"), mk("8", "9")]);
  const s: any = accuracyStats(rows);
  assert.equal(s.enough, true);
  assert.equal(s.count, 30);
  assert.equal(Math.round(s.exact * 100), 67);
  assert.equal(Math.round(s.within1 * 100), 97);
  assert.equal(Math.round(s.tooHigh * 100), 90);
  assert.equal(s.byGrader.PSA.n, 30);
  assert.equal(s.byGrader.BGS.within1, null);
});

test("PriceCharting cents map onto each grader's ladder", () => {
  const c = compsFromPriceCharting({ "manual-only-price": 123456, "graded-price": 50000, "new-price": 30000, "bgs-10-price": 400000, "condition-17-price": 99900 });
  assert.equal(c.PSA["10"].value, 1234.56);
  assert.equal(c.PSA["9"].value, 500);
  assert.equal(c.PSA["8"].value, 300);
  assert.equal(c.BGS["10"].value, 4000);
  assert.equal(c.CGC["10"].value, 999);
  assert.equal(c.PSA["10"].sales, null);
});
