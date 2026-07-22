// Free catalog pricing — tcgcsv.com republishes TCGplayer's daily price dump
// as static JSON (no key, no rate limits). We match its Pokemon groups to our
// sets by name and its products to our cards by collector number, then seed
// each card's raw with the real TCGplayer market price. Ungraded only —
// graded comps still come from PriceCharting when its token is set.
//
// Never throws: any failure leaves the seeded prices in place.

import type { Card, Product } from "./types.js";
import { tierForRaw } from "./types.js";
import { setComp } from "./priceCache.js";
import { pgAvailable, savePriceComp, batchSavePriceHistory } from "./store/pg.js";

// Sealed heuristics: products without a collector number that look like retail.
const SEALED_RE = /(booster box|elite trainer box|booster bundle|premium collection|collection box|booster pack|build & battle|tin\b|booster display)/i;
const packsFor = (name: string) =>
  /booster box|booster display/i.test(name) ? 36
  : /elite trainer/i.test(name) ? 9
  : /bundle/i.test(name) ? 6
  : /premium collection|collection box/i.test(name) ? 4
  : /build & battle/i.test(name) ? 4
  : 1;
const typeFor = (name: string) =>
  /booster box|booster display/i.test(name) ? "Booster Box"
  : /elite trainer/i.test(name) ? "Elite Trainer Box"
  : /bundle/i.test(name) ? "Booster Bundle"
  : /premium collection|collection box/i.test(name) ? "Collection"
  : /build & battle/i.test(name) ? "Build & Battle"
  : /tin\b/i.test(name) ? "Tin"
  : /booster pack/i.test(name) ? "Booster Pack"
  : "Sealed";

// tcgcsv has moved paths before — probe both layouts. Category 3 = Pokemon (EN).
const BASES = ["https://tcgcsv.com/tcgplayer/3", "https://tcgcsv.com/3"];

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RipReport/1.0; +https://cardys.onrender.com)" },
    });
    if (!r.ok) {
      console.error(`tcgcsv: ${url} responded ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error(`tcgcsv: ${url} failed:`, (e as Error).message);
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

export async function applyTcgcsvPrices(cards: Card[]): Promise<{ setsMatched: number; cardsPriced: number; products: Product[] }> {
  const out: { setsMatched: number; cardsPriced: number; products: Product[] } = { setsMatched: 0, cardsPriced: 0, products: [] };
  const histRows: { cardId: string; kind: string; value: number }[] = [];
  let BASE = "";
  let groups: any[] = [];
  for (const base of BASES) {
    const res = await getJson(`${base}/groups`);
    const rows: any[] = res?.results || [];
    if (rows.length) {
      BASE = base;
      groups = rows;
      break;
    }
  }
  if (!groups.length) {
    console.log("tcgcsv: groups unavailable on all known paths — keeping seeded prices");
    return out;
  }
  console.log(`tcgcsv: ${groups.length} groups via ${BASE}`);

  const bySet = new Map<string, Card[]>();
  for (const c of cards) {
    const k = c.set.toLowerCase();
    if (!bySet.has(k)) bySet.set(k, []);
    bySet.get(k)!.push(c);
  }

  // Group names come in several shapes — "SV08: Surging Sparks", old WotC
  // renames ("Base" → "Base Set"), and nested colons ("SWSH: Crown Zenith:
  // Galarian Gallery" for our set "Crown Zenith Galarian Gallery"). Compare
  // punctuation-collapsed forms of the tail, the name after the first colon,
  // and the whole name; substring only when unambiguous.
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const gForms = (g: any) => {
    const name = String(g.name || "");
    const ci = name.indexOf(":");
    return [
      squash(name.split(":").pop()!),
      ci >= 0 ? squash(name.slice(ci + 1)) : "",
      squash(name),
    ];
  };
  const groupFor = (setName: string) => {
    const want = squash(setName);
    const wantSet = want + " set";
    let g = groups.find((x) => gForms(x).some((f) => f === want || f === wantSet));
    if (!g) {
      const cands = groups.filter((x) => squash(String(x.name || "")).includes(want));
      if (cands.length === 1) g = cands[0];
    }
    return g;
  };

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
    const sealedProds: any[] = [];
    for (const p of prods) {
      const num = (p.extendedData || []).find((e: any) => e.name === "Number")?.value;
      if (num) {
        numToProduct.set(normNum(num), p.productId);
        numToProduct.set(normNum(String(num).split("/")[0]), p.productId);
      } else if (SEALED_RE.test(String(p.name || ""))) {
        sealedProds.push(p);
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
      histRows.push({ cardId: c.id, kind: "raw", value: c.raw });
      out.cardsPriced++;
    }

    // Real sealed prices for the Sealed tab / EV views.
    const setName = setCards[0]?.set || setKey;
    for (const p of sealedProds) {
      const market = pickMarket(priceByProduct.get(p.productId) || []);
      if (market === null) continue;
      out.products.push({
        id: "tcg-" + p.productId,
        name: String(p.name),
        set: setName,
        type: typeFor(String(p.name)),
        packs: packsFor(String(p.name)),
        msrp: Math.round(market),
        market: Math.round(market),
      });
    }
  }

  // Daily history point per priced card — powers real sparklines/curves later.
  if (pgAvailable() && histRows.length) {
    batchSavePriceHistory(histRows).catch((e) => console.error("history batch failed:", e));
  }

  console.log(`tcgcsv: priced ${out.cardsPriced} cards across ${out.setsMatched} sets; ${out.products.length} sealed products from TCGplayer market data.`);
  return out;
}
