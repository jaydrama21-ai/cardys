// Graded sale prices ("comps") per card, grader and grade.
//
// Sources, in order of preference:
//   1. PriceCharting (PRICECHARTING_API_TOKEN) — graded prices per grade.
//      Their card fields: new-price = grade 8, graded-price = grade 9,
//      box-only-price = 9.5, manual-only-price = PSA 10, bgs-10-price,
//      condition-17-price = CGC 10. Values are integer cents.
//   2. Mock comps (DATA_MODE=mock) so the app works with zero keys.
//
// eBay sold comps (Marketplace Insights, partner approval) can be added as a
// third adapter; it is the only source that gives real per-grade sale counts.
//
// The 3-sale rule lives in shared/outcomes.js. An aggregate source with no
// count (PriceCharting) passes `sales: null`, shown as "PriceCharting estimate".

import type { Card } from "./catalog/types.js";

export type Comp = { value: number; sales: number | null; source: string; updatedAt: string };
export type Comps = Record<string, Comp>; // grade label → comp

const cache = new Map<string, { at: number; comps: Record<string, Comps> }>();
const DAY = 24 * 60 * 60 * 1000;

const cents = (v: unknown) => (typeof v === "number" && v > 0 ? Math.round(v) / 100 : null);

export async function priceChartingSearch(card: Card): Promise<any | null> {
  const t = process.env.PRICECHARTING_API_TOKEN;
  if (!t) return null;
  const q = `${card.name} ${card.num.split("/")[0]} ${card.set}`;
  try {
    const r = await fetch(`https://www.pricecharting.com/api/products?t=${t}&q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const id = j?.products?.[0]?.id;
    if (!id) return null;
    const p = await fetch(`https://www.pricecharting.com/api/product?t=${t}&id=${id}`, { signal: AbortSignal.timeout(15_000) });
    if (!p.ok) return null;
    const prod: any = await p.json();
    return prod?.status === "error" ? null : prod;
  } catch {
    return null;
  }
}

export function compsFromPriceCharting(prod: any): Record<string, Comps> {
  const now = new Date().toISOString();
  const c = (v: unknown): Comp | null => {
    const value = cents(v);
    return value ? { value, sales: null, source: "PriceCharting", updatedAt: now } : null;
  };
  const out: Record<string, Comps> = { PSA: {}, BGS: {}, CGC: {}, TAG: {} };
  const set = (g: string, grade: string, comp: Comp | null) => { if (comp) out[g][grade] = comp; };
  set("PSA", "10", c(prod["manual-only-price"]));
  set("PSA", "9", c(prod["graded-price"]));
  set("PSA", "8", c(prod["new-price"]));
  set("BGS", "10", c(prod["bgs-10-price"]));
  set("BGS", "9.5", c(prod["box-only-price"]));
  set("CGC", "10", c(prod["condition-17-price"]));
  return out;
}

/** Mock comps scaled from the card's raw price — zero-key demo mode only. */
export function mockComps(card: Card): Record<string, Comps> {
  const now = new Date().toISOString();
  const raw = card.raw;
  const mk = (mult: number, sales: number): Comp => ({ value: Math.round(raw * mult), sales, source: "Sample data", updatedAt: now });
  return {
    PSA: { "10": mk(3.2, 6), "9": mk(1.4, 11), "8": mk(1.05, 4), "≤7": mk(0.8, 2) },
    BGS: { "10": mk(5, 1), "9.5": mk(2.1, 5), "9": mk(1.2, 7), "≤8.5": mk(0.85, 2) },
    CGC: { "10": mk(2.4, 4), "9.5": mk(1.5, 3), "9": mk(1.1, 5), "≤8.5": mk(0.8, 1) },
    TAG: { "10": mk(2.2, 3), "9": mk(1.15, 4), "8": mk(0.95, 2), "≤7": mk(0.7, 0) },
  };
}

export async function compsFor(card: Card): Promise<Record<string, Comps>> {
  const hit = cache.get(card.id);
  if (hit && Date.now() - hit.at < DAY) return hit.comps;
  let comps: Record<string, Comps> | null = null;
  const prod = await priceChartingSearch(card);
  if (prod) comps = compsFromPriceCharting(prod);
  if (!comps && (process.env.DATA_MODE || "mock") === "mock") comps = mockComps(card);
  comps = comps || { PSA: {}, BGS: {}, CGC: {}, TAG: {} };
  cache.set(card.id, { at: Date.now(), comps });
  return comps;
}

/** Oldest timestamp among the prices used — the "Prices updated" line. */
export function pricesUpdatedAt(card: Card, comps: Comps): string | null {
  const times = [(card as any).rawUpdatedAt, ...Object.values(comps).map((c) => c.updatedAt)].filter(Boolean);
  return times.length ? times.sort()[0] : null;
}
