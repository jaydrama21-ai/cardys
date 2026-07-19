// RipReport backend — HTTP surface for the RipDataService seam.
// Runs with ZERO keys (serves mock data in the live shape). Each env key you add
// flips one feed to real. Start: `npm i && npm run dev`.

import "dotenv/config";
import express from "express";
import cors from "cors";
import type { Company, Grade, Lang } from "./types.js";
import { db, loadCatalog } from "./db.js";
import { priceRaw, priceGraded, gradedAbs, histFor } from "./pricing.js";
import { recognize } from "./recognize.js";
import { loadLiveCatalog } from "./catalog.js";
import { PRODUCTS } from "./mock.js";
import { pgAvailable, initSchema, loadCatalogFromPg, saveCatalogToPg, loadPriceCompsFromPg } from "./store/pg.js";
import { warmPriceCache } from "./priceCache.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" })); // room for base64 scan frames

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

// ---- pricing ----
app.get("/price/raw/:id", (req, res) => {
  const c = db.cardById(req.params.id);
  if (!c) return res.status(404).json({ error: "unknown card" });
  return res.json({ id: c.id, lang: asLang(req.query.lang), price: priceRaw(c, asLang(req.query.lang)) });
});
app.get("/price/graded/:id", (req, res) => {
  const c = db.cardById(req.params.id);
  if (!c) return res.status(404).json({ error: "unknown card" });
  const company = asCompany(req.query.company), grade = asGrade(req.query.grade), lang = asLang(req.query.lang);
  return res.json({ id: c.id, company, grade, lang, price: priceGraded(c, company, grade, lang), abs: gradedAbs(c, grade) });
});
app.get("/price/history/:id", (req, res) => {
  const c = db.cardById(req.params.id);
  if (!c) return res.status(404).json({ error: "unknown card" });
  const end = req.query.end ? Number(req.query.end) : priceRaw(c, "EN");
  const chg = req.query.chg ? Number(req.query.chg) : c.chg;
  return res.json({ id: c.id, series: histFor(end, chg) });
});

// ---- recognition (scan) ----
app.post("/recognize", async (req, res) => {
  const image = req.body?.image;
  if (!image || typeof image !== "string") return res.status(400).json({ error: "expected { image: base64 }" });
  const result = await recognize(image);
  const card = result.id ? db.cardById(result.id) : null;
  return res.json({ ...result, card });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, async () => {
  console.log(`RipReport backend on :${port}  (mode=${process.env.DATA_MODE || "mock"}, cards=${db.cards().length})`);
  // In live mode: serve the persisted catalog immediately (if Postgres has one),
  // then refresh from the Pokémon TCG API and persist. The API key is optional —
  // keyless requests work with lower rate limits. Fully fallback-safe: any
  // failure keeps whatever catalog is already loaded (persisted or mock).
  if (process.env.DATA_MODE === "live") {
    if (pgAvailable()) {
      await initSchema();
      const persisted = await loadCatalogFromPg();
      if (persisted) {
        loadCatalog({ cards: persisted.cards, sets: persisted.sets, products: PRODUCTS });
        console.log(`Serving persisted catalog: ${persisted.cards.length} cards.`);
      }
      warmPriceCache(await loadPriceCompsFromPg());
    }
    const setLimit = Number(process.env.CATALOG_SET_LIMIT || 8);
    console.log(`Loading live catalog from Pokémon TCG API (latest ${setLimit} sets)…`);
    loadLiveCatalog(setLimit)
      .then(async (cat) => {
        if (cat.cards.length) {
          loadCatalog({ cards: cat.cards, sets: cat.sets, products: PRODUCTS });
          console.log(`Live catalog loaded: ${cat.cards.length} cards across ${cat.sets.length} sets.`);
          if (pgAvailable() && (await saveCatalogToPg(cat.cards, cat.sets))) {
            console.log("Catalog persisted to Postgres.");
          }
        } else {
          console.log("Live catalog returned 0 cards — keeping current catalog.");
        }
      })
      .catch((e) => console.error("Live catalog load failed, keeping current catalog:", e));
  }
});
