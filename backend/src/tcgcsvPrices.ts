// Free catalog pricing — tcgcsv.com republishes TCGplayer's daily price dump
// as static JSON (no key, no rate limits). We match its Pokemon groups to our
// sets by name and its products to our cards by collector number, then seed
// each card's raw with the real TCGplayer market price. Ungraded only —
// graded comps still come from PriceCharting when its token is set.
//
// Never throws: any failure leaves the seeded prices in place.

import type { Card } from "./types.js";
import { tierForRaw } from "./types.js";
import { setComp } from "./priceCache.js";
import { pgAvailable, savePriceComp } from "./store/pg.js";

const BASE = "https://tcgcsv.com/tcgplayer/3"; // category 3 = Pokemon (EN)

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** "087/086" → "87/86"; tolerant of missing totals and letters (TG12, SWSH001). */
const normNum = (s: string) =>
  String(s || "")
    .toLowerCase()
    .split("/")
    .map((p) => p.trim().replace(/^0+(?=\w)/, ""))
    .join("/");

/** Best price row for the base printing: Normal, then Holofoil, then anything. */
function pickMarket(subs: any[]): number | null {
  const pick =
    subs.find((s) => s.subTypeName === "Normal" && s.marketPrice) ??
    subs.find((s) => s.subTypeName === "Holofoil" && s.marketPrice) ??
    subs.find((s) => s.marketPrice);
  const m = pick?.marketPrice;
  return typeof m === "number" && m > 0 ? m : null;
}

export async function applyTcgcsvPrices(cards: Card[]): Promise<{ setsMatched: number; cardsPriced: number }> {
  const out = { setsMatched: 0, cardsPriced: 0 };
  const groupsRes = await getJson(`${BASE}/groups`);
  const groups: any[] = groupsRes?.results || [];
  if (!groups.length) {
    console.log("tcgcsv: groups unavailable — keeping seeded prices");
    return out;
  }

  const bySet = new Map<string, Card[]>();
  for (const c of cards) {
    const k = c.set.toLowerCase();
    if (!bySet.has(k)) bySet.set(k, []);
    bySet.get(k)!.push(c);
  }

  // "SV08: Surging Sparks" → exact tail match against our set name first,
  // substring as fallback.
  const groupFor = (setName: string) =>
    groups.find((g) => String(g.name || "").toLowerCase().split(":").pop()!.trim() === setName) ??
    groups.find((g) => String(g.name || "").toLowerCase().includes(setName));

  for (const [setKey, setCards] of bySet) {
    const g = groupFor(setKey);
    if (!g) continue;
    const [prodRes, priceRes] = await Promise.all([
      getJson(`${BASE}/${g.groupId}/products`),
      getJson(`${BASE}/${g.groupId}/prices`),
    ]);
    const prods: any[] = prodRes?.results || [];
    const prices: any[] = priceRes?.results || [];
    if (!prods.length || !prices.length) continue;
    out.setsMatched++;

    const numToProduct = new Map<string, number>();
    for (const p of prods) {
      const num = (p.extendedData || []).find((e: any) => e.name === "Number")?.value;
      if (num) {
        numToProduct.set(normNum(num), p.productId);
        numToProduct.set(normNum(String(num).split("/")[0]), p.productId);
      }
    }
    const priceByProduct = new Map<number, any[]>();
    for (const pr of prices) {
      if (!priceByProduct.has(pr.productId)) priceByProduct.set(pr.productId, []);
      priceByProduct.get(pr.productId)!.push(pr);
    }

    for (const c of setCards) {
      const pid = numToProduct.get(normNum(c.num)) ?? numToProduct.get(normNum(c.num.split("/")[0]));
      if (!pid) continue;
      const market = pickMarket(priceByProduct.get(pid) || []);
      if (market === null) continue;
      c.raw = Math.max(1, Math.round(market));
      c.tier = tierForRaw(c.raw);
      const row = { cardId: c.id, kind: "raw", value: c.raw, source: "TCGplayer market", comps: 0, lastSoldAt: new Date() };
      setComp(row);
      if (pgAvailable()) savePriceComp(row).catch(() => {});
      out.cardsPriced++;
    }
  }

  console.log(`tcgcsv: priced ${out.cardsPriced} cards across ${out.setsMatched} sets from TCGplayer market data.`);
  return out;
}
