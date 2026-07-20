// Price refresh — run nightly on a cron: `npm run refresh:prices`.
//
// Poll list = uploads/ShinyExport.csv (every single carries a real
// pricecharting_id). For each target it pulls current prices from
// PriceCharting by id, writes one comp row per (card, kind) — value, source,
// comp count, last-sold — into the price cache (and Postgres when
// DATABASE_URL is set), plus today's raw history point. Those rows are what
// the app's freshness dots + provenance read. eBay sold comps can layer on
// top later (partner access required).
//
// Smoke test: compares each fetched raw price against the CSV's
// value_per_unit and reports the spread.

import "dotenv/config";
import { db } from "../db.js";
import type { Card } from "../types.js";
import { shinyPricingTargets, type ShinyRow } from "../shiny.js";
import { setComp } from "../priceCache.js";
import { pgAvailable, initSchema, savePriceComp, savePriceHistoryPoint, type PriceCompRow } from "../store/pg.js";

// PriceCharting repurposes its game price fields for trading cards:
//   loose-price          → ungraded (raw)      graded-price   → PSA/grade 9
//   box-only-price       → grade 9.5           manual-only-price → PSA 10
//   bgs-10-price         → BGS 10              condition-17-price → CGC 10
//   condition-18-price   → SGC 10
// All values are integer CENTS.
const FIELD_KINDS: [string, string][] = [
  ["loose-price", "raw"],
  ["graded-price", "psa9"],
  ["box-only-price", "psa95"],
  ["manual-only-price", "psa10"],
  ["bgs-10-price", "bgs10"],
  ["condition-17-price", "cgc10"],
  ["condition-18-price", "sgc10"],
];

const centsToUsd = (v: unknown): number | null =>
  typeof v === "number" && v > 0 ? Math.round(v / 100) : null;

export async function fetchPriceChartingById(pcId: string): Promise<Record<string, unknown> | null> {
  const token = process.env.PRICECHARTING_API_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(
      `https://www.pricecharting.com/api/product?t=${token}&id=${encodeURIComponent(pcId)}`
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    return j && j.status !== "error" ? j : null;
  } catch {
    return null;
  }
}

/** Map one PriceCharting product payload to comp rows for a catalog card. */
export function compRowsFromPriceCharting(cardId: string, product: Record<string, unknown>): PriceCompRow[] {
  const rows: PriceCompRow[] = [];
  const comps = typeof product["sales-volume"] === "number" ? (product["sales-volume"] as number) : 0;
  for (const [field, kind] of FIELD_KINDS) {
    const usd = centsToUsd(product[field]);
    if (usd !== null) {
      rows.push({ cardId, kind, value: usd, source: "PriceCharting", comps, lastSoldAt: new Date() });
    }
  }
  return rows;
}

/** Find the catalog card a Shiny row refers to (name+set first, then name). */
export function matchCatalogCard(row: ShinyRow, cards: Card[]): Card | null {
  const name = row.name.toLowerCase();
  const set = row.set.toLowerCase();
  return (
    cards.find((c) => c.name.toLowerCase() === name && c.set.toLowerCase() === set) ??
    cards.find((c) => c.name.toLowerCase() === name) ??
    null
  );
}

/** Run one full refresh pass. Called by the CLI below and by the server's
 *  nightly scheduler; safe to call with no token (skips with a log line). */
export async function refreshAllPrices(): Promise<{ updated: number; targets: number }> {
  const targets = shinyPricingTargets();
  const cards = db.cards();
  console.log(`Poll list: ${targets.length} singles with a pricecharting_id (from ShinyExport.csv).`);
  if (!process.env.PRICECHARTING_API_TOKEN) {
    console.log("PRICECHARTING_API_TOKEN not set — nothing fetched. Add it to poll real comps.");
    return { updated: 0, targets: targets.length };
  }
  if (pgAvailable()) await initSchema();

  let updated = 0;
  const diffs: number[] = [];
  for (const t of targets) {
    const product = await fetchPriceChartingById(t.pcId!);
    if (!product) continue;
    const card = matchCatalogCard(t, cards);
    const cardId = card?.id ?? `shiny-${t.pcId}`; // cache by shiny id until the card is in the catalog
    const rows = compRowsFromPriceCharting(cardId, product);
    if (!rows.length) continue;
    for (const row of rows) {
      setComp(row);
      if (pgAvailable() && card) await savePriceComp(row);
    }
    const raw = rows.find((r) => r.kind === "raw");
    if (raw) {
      if (card) {
        card.raw = raw.value; // keep the serving catalog's seed price current
        if (pgAvailable()) await savePriceHistoryPoint(cardId, "raw", raw.value);
      }
      if (t.valuePerUnit > 0) diffs.push(Math.abs(raw.value - t.valuePerUnit) / t.valuePerUnit);
    }
    const p10 = rows.find((r) => r.kind === "psa10");
    if (p10 && card) card.psa10 = p10.value;
    updated++;
    await new Promise((r) => setTimeout(r, 250)); // stay well under rate limits
  }

  console.log(`Price refresh complete: ${updated}/${targets.length} targets updated.`);
  if (diffs.length) {
    const mean = (diffs.reduce((a, b) => a + b, 0) / diffs.length) * 100;
    console.log(`Smoke test vs ShinyExport value_per_unit: mean |diff| ${mean.toFixed(1)}% across ${diffs.length} cards.`);
  }
  if (!pgAvailable()) {
    console.log("DATABASE_URL not set — comps held in this process only. Set it so the server can serve them.");
  }
  return { updated, targets: targets.length };
}

async function main() {
  await refreshAllPrices();
}

// Only run when executed directly (the mapping helpers are imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("price refresh failed:", e);
    process.exit(1);
  });
}
