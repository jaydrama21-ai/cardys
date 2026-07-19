// Price refresh — run on a cron (e.g. nightly). For every card, pull SOLD comps
// from your pricing source and cache them (raw, per-grade, 30d change, history).
// Run: `npm run refresh:prices`
//
// This is the job that makes the app's freshness dots + provenance REAL. Each
// price row should carry: value, source, comp count, last-sold timestamp — the
// card-detail `priceMeta()` in the app expects exactly that shape.

import "dotenv/config";
import { db } from "../db.js";

type PriceRow = {
  cardId: string;
  kind: "raw" | "psa10" | "psa9" | "cgc10" | string;
  value: number;       // whole USD
  source: string;      // "eBay sold" | "TCGplayer" | "PriceCharting"
  comps: number;       // number of sales in the window
  lastSoldHrs: number; // hours since most recent sale (drives Live/Aging/Stale dot)
};

// --- PriceCharting adapter (simplest to start) --------------------------------
async function fromPriceCharting(cardName: string): Promise<PriceRow[] | null> {
  const token = process.env.PRICECHARTING_API_TOKEN;
  if (!token) return null;
  // https://www.pricecharting.com/api-documentation
  const url = `https://www.pricecharting.com/api/product?t=${token}&q=${encodeURIComponent(cardName)}`;
  try {
    const r = await fetch(url);
    const j: any = await r.json();
    // TODO: map PriceCharting fields -> PriceRow[]. It exposes loose-price
    // (raw) + graded (psa10/psa9/etc) in cents; divide by 100.
    return [];
  } catch {
    return null;
  }
}

// --- eBay Marketplace Insights adapter (real sold comps) ----------------------
async function fromEbaySold(_cardName: string): Promise<PriceRow[] | null> {
  if (!process.env.EBAY_APP_ID) return null;
  // TODO: OAuth app token -> /buy/marketplace_insights/v1_beta/item_sales/search
  // Aggregate sold prices in a 30d window; compute median (value), count (comps),
  // most-recent sale (lastSoldHrs).
  return null;
}

async function refreshCard(cardName: string): Promise<PriceRow[]> {
  const rows = (await fromEbaySold(cardName)) ?? (await fromPriceCharting(cardName)) ?? [];
  return rows;
}

async function main() {
  const cards = db.cards();
  let updated = 0;
  for (const c of cards) {
    const rows = await refreshCard(c.name);
    if (rows.length) {
      // TODO: UPSERT rows into your price cache; update Card.raw/psa10/chg from them.
      updated++;
    }
  }
  console.log(`Price refresh complete. Cards with live comps: ${updated}/${cards.length}.`);
  if (!process.env.PRICECHARTING_API_TOKEN && !process.env.EBAY_APP_ID) {
    console.log("No pricing keys set — nothing fetched. Add PRICECHARTING_API_TOKEN or EBAY_APP_ID.");
  }
}

main().catch((e) => {
  console.error("price refresh failed:", e);
  process.exit(1);
});
