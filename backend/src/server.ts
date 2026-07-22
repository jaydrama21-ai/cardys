// RipReport backend — HTTP surface for the RipDataService seam.
// Runs with ZERO keys (serves mock data in the live shape). Each env key you add
// flips one feed to real. Start: `npm i && npm run dev`.

import "dotenv/config";
import express from "express";
import cors from "cors";
import compression from "compression";
import type { Company, Grade, Lang } from "./types.js";
import { db, loadCatalog } from "./db.js";
import { priceRaw, priceGraded, gradedAbs, histFor } from "./pricing.js";
import { recognize } from "./recognize.js";
import { loadLiveCatalog } from "./catalog.js";
import { PRODUCTS } from "./mock.js";
import { pgAvailable, initSchema, loadCatalogFromPg, saveCatalogToPg, loadPriceCompsFromPg, loadPriceHistoryFromPg } from "./store/pg.js";
import { warmPriceCache, warmHistoryCache, compMeta } from "./priceCache.js";
import { register, login, loginWithGoogle, userForToken, getHoldings, putHoldings, warmAccounts, consumeScan, scansLeftFor, deleteUser } from "./accounts.js";
import { refreshAllPrices } from "./jobs/refreshPrices.js";
import { applyTcgcsvPrices } from "./tcgcsvPrices.js";

const app = express();
app.use(cors());
app.use(compression()); // /cards is ~7MB of JSON for the full catalog; gzip ≈ 8×
app.use(express.json({ limit: "12mb" })); // room for base64 scan frames

// Serve the PWA build (repo-root deploy/) at / when it exists, so one origin
// hosts both the app and its API. API routes above/below always win — none of
// them collide with static file paths.
{
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const deployDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "deploy");
  if (existsSync(join(deployDir, "index.html"))) {
    app.use(express.static(deployDir));
    console.log(`Serving PWA from ${deployDir} at /`);
  }
}

const asLang = (v: unknown): Lang => (["EN", "JP", "KR", "ZH"].includes(v as string) ? (v as Lang) : "EN");
const asCompany = (v: unknown): Company =>
  (["PSA", "BGS", "CGC", "SGC", "TAG"].includes(v as string) ? (v as Company) : "PSA");
const asGrade = (v: unknown): Grade => {
  const n = Number(v);
  return ([10, 9.5, 9, 8] as number[]).includes(n) ? (n as Grade) : 10;
};

app.get("/health", (_req, res) =>
  res.json({ ok: true, mode: process.env.DATA_MODE || "mock", cards: db.cards().length })
);

// ---- catalog ----
app.get("/cards", (_req, res) => res.json(db.cards()));
app.get("/sets", (_req, res) => res.json(db.sets()));
app.get("/products", (_req, res) => res.json(db.products()));
app.get("/card/:id", (req, res) => {
  const c = db.cardById(req.params.id);
  return c ? res.json(c) : res.status(404).json(null);
});
app.get("/search", (req, res) =>
  res.json(db.searchCards(String(req.query.q ?? ""), (req.query.lang as Lang) || "All"))
);
app.get("/products/search", (req, res) => res.json(db.searchProducts(String(req.query.q ?? ""))));

// Same-origin image proxy for the share-image canvas (cross-origin card art
// would taint it). Whitelisted card-image hosts only, cached a day.
app.get("/img-proxy", async (req, res) => {
  const url = String(req.query.u || "");
  if (!/^https:\/\/(images\.pokemontcg\.io|images\.scrydex\.com|tcgplayer-cdn\.tcgplayer\.com)\//.test(url)) {
    return res.status(400).json({ error: "host not allowed" });
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return res.status(502).json({ error: "upstream " + r.status });
    res.set("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Access-Control-Allow-Origin", "*");
    return res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    return res.status(502).json({ error: "fetch failed" });
  }
});

// ---- pricing ----
app.get("/price/raw/:id", (req, res) => {
  const c = db.cardById(req.params.id);
  if (!c) return res.status(404).json({ error: "unknown card" });
  // `meta` is additive: present only when a real cached comp backs the price
  // (source, comp count, hours since last sale — the app's provenance UI).
  const meta = compMeta(c.id, "raw");
  return res.json({ id: c.id, lang: asLang(req.query.lang), price: priceRaw(c, asLang(req.query.lang)), ...(meta ? { meta } : {}) });
});
app.get("/price/graded/:id", (req, res) => {
  const c = db.cardById(req.params.id);
  if (!c) return res.status(404).json({ error: "unknown card" });
  const company = asCompany(req.query.company), grade = asGrade(req.query.grade), lang = asLang(req.query.lang);
  const kind = company === "PSA" ? `psa${String(grade).replace(".", "")}` : `${company.toLowerCase()}${grade === 10 ? "10" : ""}`;
  const meta = compMeta(c.id, kind);
  return res.json({ id: c.id, company, grade, lang, price: priceGraded(c, company, grade, lang), abs: gradedAbs(c, grade), ...(meta ? { meta } : {}) });
});
app.get("/price/history/:id", (req, res) => {
  const c = db.cardById(req.params.id);
  if (!c) return res.status(404).json({ error: "unknown card" });
  const end = req.query.end ? Number(req.query.end) : priceRaw(c, "EN");
  const chg = req.query.chg ? Number(req.query.chg) : c.chg;
  return res.json({ id: c.id, series: histFor(end, chg, c) });
});

// ---- accounts + holdings sync ----
// Brute-force guard: 20 auth attempts per IP per 10 minutes.
const authHits = new Map<string, { count: number; reset: number }>();
app.use("/auth", (req, res, next) => {
  if (req.method !== "POST") return next();
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  const now = Date.now();
  let h = authHits.get(ip);
  if (!h || now > h.reset) h = { count: 0, reset: now + 10 * 60 * 1000 };
  h.count += 1;
  authHits.set(ip, h);
  if (authHits.size > 10_000) authHits.clear(); // bounded memory
  if (h.count > 20) return res.status(429).json({ error: "too many attempts - try again later" });
  return next();
});
app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string")
    return res.status(400).json({ error: "expected { email, password }" });
  const out = await register(email, password);
  return "error" in out ? res.status(400).json(out) : res.json(out);
});
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string")
    return res.status(400).json({ error: "expected { email, password }" });
  const out = await login(email, password);
  return "error" in out ? res.status(401).json(out) : res.json(out);
});
app.post("/auth/google", async (req, res) => {
  const { credential } = req.body ?? {};
  if (typeof credential !== "string") return res.status(400).json({ error: "expected { credential }" });
  const out = await loginWithGoogle(credential);
  return "error" in out ? res.status(401).json(out) : res.json(out);
});
// Public client config — lets the app know which sign-in methods are live
// without baking ids into the build.
app.get("/auth/config", (_req, res) =>
  res.json({ googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || null })
);
app.get("/me", (req, res) => {
  const user = userForToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  return res.json({ ...user, scansLeft: scansLeftFor(user.id, null) });
});
app.delete("/me", async (req, res) => {
  const user = userForToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  await deleteUser(user.id);
  return res.json({ ok: true });
});
app.get("/holdings", (req, res) => {
  const user = userForToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  return res.json(getHoldings(user.id));
});
app.put("/holdings", async (req, res) => {
  const user = userForToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  const out = await putHoldings(user.id, req.body);
  return Array.isArray(out) ? res.json(out) : res.status(400).json(out);
});

// ---- recognition (scan) ----
app.post("/recognize", async (req, res) => {
  const image = req.body?.image;
  if (!image || typeof image !== "string") return res.status(400).json({ error: "expected { image: base64 }" });
  // Meter only real recognition (mock costs nothing and keeps demos free).
  const metered = (process.env.RECOGNIZE_MODE || "mock") !== "mock";
  const user = userForToken(req.headers.authorization);
  let scansLeft: number | null = null;
  if (metered) {
    const deviceId = typeof req.headers["x-device-id"] === "string" ? (req.headers["x-device-id"] as string) : null;
    const gate = await consumeScan(user?.id ?? null, deviceId);
    if (!gate.allowed) {
      return res.status(402).json({ error: gate.reason, scansLeft: 0, signin: !user });
    }
    scansLeft = gate.scansLeft;
  }
  const result = await recognize(image);
  const card = result.id ? db.cardById(result.id) : null;
  return res.json({ ...result, card, ...(scansLeft !== null ? { scansLeft } : {}) });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, async () => {
  console.log(`RipReport backend on :${port}  (mode=${process.env.DATA_MODE || "mock"}, cards=${db.cards().length})`);
  // In live mode: serve the persisted catalog immediately (if Postgres has one),
  // then refresh from the Pokémon TCG API and persist. The API key is optional —
  // keyless requests work with lower rate limits. Fully fallback-safe: any
  // failure keeps whatever catalog is already loaded (persisted or mock).
  // Accounts persist whenever Postgres is configured, regardless of data mode.
  if (pgAvailable()) {
    await initSchema();
    await warmAccounts();
  }
  if (process.env.DATA_MODE === "live") {
    if (pgAvailable()) {
      const persisted = await loadCatalogFromPg();
      if (persisted) {
        loadCatalog({ cards: persisted.cards, sets: persisted.sets, products: PRODUCTS });
        console.log(`Serving persisted catalog: ${persisted.cards.length} cards.`);
      }
      warmPriceCache(await loadPriceCompsFromPg());
      warmHistoryCache(await loadPriceHistoryFromPg());
    }
    const setLimit = Number(process.env.CATALOG_SET_LIMIT || 0);
    let refreshingPrices = false;
    const RETRY_MS = 10 * 60 * 1000; // failed fetch → try again in 10 min
    const REFRESH_MS = 24 * 60 * 60 * 1000; // success → refresh daily
    const refreshCatalog = async () => {
      console.log(setLimit > 0 ? `Loading live catalog (latest ${setLimit} sets)…` : "Loading FULL live catalog (all sets)…");
      try {
        const cat = await loadLiveCatalog(setLimit);
        if (!cat.cards.length) throw new Error("API returned 0 cards");
        // Free real prices: overlay TCGplayer market values (tcgcsv daily dump)
        // before the catalog is served and persisted. Real sealed products
        // replace the demo list whenever tcgcsv yields any.
        const priced = await applyTcgcsvPrices(cat.cards);
        loadCatalog({ cards: cat.cards, sets: cat.sets, products: priced.products.length ? priced.products : PRODUCTS });
        console.log(`Live catalog loaded: ${cat.cards.length} cards across ${cat.sets.length} sets.`);
        if (pgAvailable() && (await saveCatalogToPg(cat.cards, cat.sets))) {
          console.log("Catalog persisted to Postgres.");
        }
        // Nightly-ish price refresh rides the catalog cycle: once after every
        // successful load (boot + daily). No-ops with a log line until
        // PRICECHARTING_API_TOKEN is set.
        if (!refreshingPrices) {
          refreshingPrices = true;
          refreshAllPrices()
            .catch((e) => console.error("price refresh failed:", e))
            .finally(() => { refreshingPrices = false; });
        }
        setTimeout(refreshCatalog, REFRESH_MS);
      } catch (e) {
        console.error(`Live catalog load failed (retrying in ${RETRY_MS / 60000} min):`, (e as Error).message);
        setTimeout(refreshCatalog, RETRY_MS);
      }
    };
    refreshCatalog();
  }
});
