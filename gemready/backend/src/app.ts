// GemReady API. Photos never come here except opt-in training crops; all
// grading math that touches pixels runs on the phone (shared/analysis.js).

import express from "express";
import cors from "cors";
import compression from "compression";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { db } from "./catalog/db.js";
import { matchCatalog, hintsFromText } from "./catalog/match.js";
import { compsFor, pricesUpdatedAt } from "./prices.js";
import { accuracyStats, turnaroundStats } from "./accuracy.js";
import { psaCert } from "./integrations.js";
import { type Store, today } from "./store.js";
// Shared with the app — one copy of the money math.
import { pickTier, outcomeRows, verdict, worthItAt, gradingCost, ebayFee, round2 } from "../../shared/outcomes.js";
import { GRADERS } from "../../shared/grading.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
export const VERSION = "1.0.0";

export function loadFees() { return readJson(join(ROOT, "shared", "fees.json")); }
export function loadManifest() {
  const p = process.env.MODEL_MANIFEST || join(ROOT, "model", "manifest.json");
  return existsSync(p) ? readJson(p) : { enabled: false, version: null };
}

const GRADES_OK = /^(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4|3|2|1\.5|1)$/;
const asGrader = (v: unknown) => (GRADERS.includes(String(v)) ? String(v) : "PSA");
const isDay = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

/** Tiny fixed-window rate limiter for write routes. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now > h.reset) h = { n: 0, reset: now + windowMs };
    h.n++;
    hits.set(ip, h);
    if (hits.size > 50_000) hits.clear();
    if (h.n > max) return res.status(429).json({ error: "Too many requests. Try again in a few minutes." });
    next();
  };
}

export function createApp(store: Store) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: "3mb" }));
  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  const writes = limiter(60, 10 * 60 * 1000);
  const api = express.Router();

  api.get("/health", async (_req, res) => res.json({ ok: true, version: VERSION, cards: db.cards().length, mode: process.env.DATA_MODE || "mock" }));

  api.get("/config", (_req, res) => {
    const fees = loadFees();
    const m = loadManifest();
    res.json({
      version: VERSION,
      modelEnabled: !!m.enabled,
      modelVersion: m.version ?? null,
      feesVerifiedAt: fees.verifiedAt,
      pushPublicKey: process.env.VAPID_PUBLIC_KEY || null,
      psaCertLookup: !!process.env.PSA_API_TOKEN,
      sampleData: (process.env.DATA_MODE || "mock") === "mock",
    });
  });
  api.get("/model/manifest", (_req, res) => res.json(loadManifest()));
  api.get("/fees", (_req, res) => res.json(loadFees()));

  // ---- catalog ----
  api.get("/search", (req, res) => {
    const q = clip(req.query.q, 80);
    res.json(db.searchCards(q, "All").slice(0, 25));
  });
  api.get("/card/:id", (req, res) => {
    const c = db.cardById(req.params.id);
    return c ? res.json(c) : res.status(404).json({ error: "Unknown card" });
  });
  api.post("/match", writes, (req, res) => {
    const { text, name, number } = req.body ?? {};
    const hints = typeof text === "string" ? hintsFromText(text.slice(0, 2000)) : { name: clip(name, 80) || undefined, number: clip(number, 12) || undefined };
    const m = matchCatalog(hints);
    res.json({ hints, id: m.id, confidence: m.confidence, candidates: m.candidates.map((c) => ({ ...c.card, confidence: c.confidence })) });
  });

  // ---- outcomes ----
  async function outcomesFor(cardId: string, grader: string, opts: { shippingIn: number; minNet: number; value?: number }) {
    const card = db.cardById(cardId);
    if (!card) return null;
    const fees = loadFees();
    const comps = (await compsFor(card))[grader] ?? {};
    // Tier is chosen by what the card could be worth graded (the top comp), so
    // the declared value covers the best case — graders upcharge otherwise.
    const top = Math.max(card.raw, ...Object.values(comps).map((c) => c.value));
    const value = opts.value ?? top;
    const tier = pickTier(fees, grader, value);
    const ret = fees.graders[grader].returnShipping;
    const rows = outcomeRows({ grader, raw: card.raw, comps, tier, ebay: fees.ebay, shippingIn: opts.shippingIn, returnShipping: ret.amount });
    const cost = tier ? gradingCost(tier, { shippingIn: opts.shippingIn, returnShipping: ret.amount }) : null;
    return {
      card, grader, raw: card.raw, rawSource: (card as any).rawSource ?? (process.env.DATA_MODE === "live" ? "TCGplayer market" : "Sample data"),
      declaredValue: round2(value),
      tier, cost, returnShipping: ret,
      rawEbayFee: ebayFee(card.raw, fees.ebay),
      rows, verdict: verdict(rows, opts.minNet), worthAt: worthItAt(rows, opts.minNet),
      pricesUpdatedAt: pricesUpdatedAt(card, comps), feesAsOf: fees.verifiedAt,
    };
  }

  api.get("/outcomes/:id", async (req, res) => {
    const out = await outcomesFor(req.params.id, asGrader(req.query.grader), {
      shippingIn: Math.max(0, Math.min(500, Number(req.query.shippingIn) || 0)),
      minNet: Number(req.query.minNet) || 0,
    });
    return out ? res.json(out) : res.status(404).json({ error: "Unknown card" });
  });

  api.get("/compare/:id", async (req, res) => {
    const opts = { shippingIn: Math.max(0, Number(req.query.shippingIn) || 0), minNet: Number(req.query.minNet) || 0 };
    const all = await Promise.all(GRADERS.map((g) => outcomesFor(req.params.id, g, opts)));
    if (!all[0]) return res.status(404).json({ error: "Unknown card" });
    const fees = loadFees();
    res.json({
      card: all[0].card,
      graders: all.map((o) => ({ grader: o!.grader, tier: o!.tier, rows: o!.rows, worthAt: o!.worthAt, verdict: o!.verdict })),
      status: Object.fromEntries(GRADERS.map((g) => [g, fees.graders[g].tiers.map((t: any) => ({ name: t.name, price: t.price, status: t.status, maxValue: t.maxValue, note: t.note ?? null }))])),
      feesAsOf: fees.verifiedAt,
    });
  });

  // ---- anonymous sign-in ----
  api.post("/anon", writes, async (req, res) => {
    const { user, token } = await store.createAnon(!!req.body?.under13);
    res.json({ token, under13: user.under13 });
  });
  const auth = async (req: express.Request, res: express.Response) => {
    const u = await store.userForToken(req.headers.authorization);
    if (!u) { res.status(401).json({ error: "Not signed in" }); return null; }
    return u;
  };
  api.get("/me", async (req, res) => {
    const u = await auth(req, res); if (!u) return;
    res.json({ under13: u.under13, alerts: (await store.alertsFor(u.id)).length, push: !!u.push });
  });
  api.patch("/me", async (req, res) => {
    const u = await auth(req, res); if (!u) return;
    if (typeof req.body?.under13 === "boolean") await store.setUnder13(u.id, req.body.under13);
    res.json({ ok: true });
  });
  api.delete("/me", async (req, res) => {
    const u = await auth(req, res); if (!u) return;
    await store.deleteUser(u.id);
    res.json({ ok: true });
  });

  // ---- price alerts ----
  api.get("/alerts", async (req, res) => {
    const u = await auth(req, res); if (!u) return;
    res.json(await store.alertsFor(u.id));
  });
  api.put("/alerts/:cardId", writes, async (req, res) => {
    const u = await auth(req, res); if (!u) return;
    if (u.under13) return res.status(403).json({ error: "Price alerts are off for this account." });
    const card = db.cardById(req.params.cardId);
    if (!card) return res.status(404).json({ error: "Unknown card" });
    await store.putAlert({ userId: u.id, cardId: card.id, base: card.raw, lastNotifiedDay: null });
    res.json({ ok: true, base: card.raw, below: round2(card.raw * 0.8), above: round2(card.raw * 1.2) });
  });
  api.delete("/alerts/:cardId", async (req, res) => {
    const u = await auth(req, res); if (!u) return;
    await store.deleteAlert(u.id, req.params.cardId);
    res.json({ ok: true });
  });
  api.post("/push", writes, async (req, res) => {
    const u = await auth(req, res); if (!u) return;
    const sub = req.body?.subscription;
    if (sub && (typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint))) return res.status(400).json({ error: "Bad subscription" });
    await store.setPush(u.id, sub ?? null);
    res.json({ ok: true });
  });

  // ---- slab results (anonymous by construction: no user id is stored) ----
  api.post("/slab-results", writes, async (req, res) => {
    const b = req.body ?? {};
    const grader = String(b.grader ?? "");
    const grade = String(b.grade ?? "");
    if (!GRADERS.includes(grader) || !GRADES_OK.test(grade)) return res.status(400).json({ error: "Expected a grader (PSA, BGS, CGC, TAG) and a grade." });
    const est = b.estimate && typeof b.estimate === "object" ? b.estimate : null;
    const features = Array.isArray(b.features) && b.features.length <= 64 && b.features.every((n: unknown) => typeof n === "number" && isFinite(n)) ? b.features : null;
    await store.addSlabResult({
      day: today(),
      grader, grade,
      tier: b.tier ? clip(b.tier, 40) : null,
      cardId: b.cardId && db.cardById(String(b.cardId)) ? String(b.cardId) : null,
      holo: !!b.holo,
      estimate: est ? {
        mostLikely: est.mostLikely != null ? clip(est.mostLikely, 6) : null,
        probs: est.probs && typeof est.probs === "object" ? Object.fromEntries(Object.entries(est.probs).slice(0, 12).map(([k, v]) => [clip(k, 6), Number(v) || 0])) : null,
        centeringCap: est.centeringCap != null ? clip(est.centeringCap, 6) : null,
      } : null,
      features,
      sentOn: isDay(b.sentOn) ? b.sentOn : null,
      returnedOn: isDay(b.returnedOn) ? b.returnedOn : null,
      soldFor: Number(b.soldFor) > 0 ? round2(Number(b.soldFor)) : null,
      modelVersion: b.modelVersion ? clip(b.modelVersion, 20) : null,
    });
    res.json({ ok: true });
  });
  api.get("/accuracy", async (_req, res) => res.json(accuracyStats(await store.slabResults())));
  // Training export for model/train.py. Off unless ADMIN_TOKEN is set.
  api.get("/admin/slab-results", async (req, res) => {
    const t = process.env.ADMIN_TOKEN;
    if (!t || req.headers.authorization !== `Bearer ${t}`) return res.status(404).json({ error: "Not found" });
    res.json(await store.slabResults());
  });
  api.get("/turnaround", async (_req, res) => res.json(turnaroundStats(await store.slabResults())));
  api.get("/psa-cert/:cert", async (req, res) => {
    const c = await psaCert(req.params.cert);
    return c ? res.json(c) : res.status(404).json({ error: "Cert lookup unavailable — type the grade." });
  });

  // ---- feedback ----
  api.post("/feedback", writes, async (req, res) => {
    const kind = ["bug", "idea", "wrong-grade", "wrong-card", "other"].includes(req.body?.kind) ? req.body.kind : "other";
    const text = clip(req.body?.text, 2000).trim();
    if (!text) return res.status(400).json({ error: "Tell us what happened." });
    await store.addFeedback({ day: today(), kind, text, screen: clip(req.body?.screen, 40), version: clip(req.body?.version, 20) });
    res.json({ ok: true });
  });
  api.post("/helpful", writes, async (req, res) => {
    await store.addHelpful({ day: today(), screen: clip(req.body?.screen, 40), yes: !!req.body?.yes });
    res.json({ ok: true });
  });

  // ---- training crops (opt-in, 13+, cropped card only) ----
  const trainDir = process.env.TRAINING_DIR || join(ROOT, "backend", "data", "training");
  api.post("/training", writes, async (req, res) => {
    const u = await store.userForToken(req.headers.authorization);
    if (!u) return res.status(401).json({ error: "Not signed in" });
    if (u.under13) return res.status(403).json({ error: "Photo uploads are off for this account." });
    const { image, grader, grade, side, slot } = req.body ?? {};
    if (!GRADERS.includes(grader) || !GRADES_OK.test(String(grade))) return res.status(400).json({ error: "Expected grader and grade." });
    const b64 = typeof image === "string" ? image.replace(/^data:image\/jpeg;base64,/, "") : "";
    const buf = Buffer.from(b64, "base64");
    // JPEG only, re-encoded on the phone (which drops EXIF/location), ≤ 2 MB.
    if (buf.length < 1000 || buf.length > 2_000_000 || buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ error: "Expected a JPEG crop." });
    if (buf.includes(Buffer.from("Exif"))) return res.status(400).json({ error: "Photo still has camera data; re-encode before upload." });
    const day = today();
    const file = `${grader}/${String(grade)}/${day}-${randomBytes(8).toString("hex")}.jpg`;
    mkdirSync(join(trainDir, dirname(file)), { recursive: true });
    writeFileSync(join(trainDir, file), buf);
    await store.addTraining({ day, file, grader, grade: String(grade), side: clip(side, 8), slot: clip(slot, 8) });
    res.json({ ok: true });
  });

  app.use("/api", api);

  // The installable web app (and Capacitor's bundled copy) — same origin.
  const web = join(ROOT, "web");
  if (existsSync(join(web, "index.html"))) {
    app.use(express.static(web, {
      setHeaders(res, p) {
        if (p.endsWith("sw.js") || p.endsWith("index.html")) res.set("Cache-Control", "no-cache");
      },
    }));
  }
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}
