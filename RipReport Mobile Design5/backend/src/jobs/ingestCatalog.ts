// Catalog ingest — seeds your DB from the free Pokémon TCG API (pokemontcg.io).
// Run: `npm run ingest:catalog`  (needs POKEMONTCG_API_KEY for higher rate limits)
//
// This is a SKELETON: it fetches a set's cards and maps them to the Card schema.
// Persist `loadCatalog(...)` output to Postgres (schema.sql) for production.

import "dotenv/config";
import type { Card, CardSet, Product, Lang } from "../types.js";
import { tierForRaw } from "../types.js";
import { loadCatalog } from "../db.js";

const API = "https://api.pokemontcg.io/v2";
const headers: Record<string, string> = process.env.POKEMONTCG_API_KEY
  ? { "X-Api-Key": process.env.POKEMONTCG_API_KEY }
  : {};

async function fetchSets(): Promise<CardSet[]> {
  const r = await fetch(`${API}/sets?orderBy=-releaseDate`, { headers });
  const j: any = await r.json();
  return (j.data || []).map((s: any) => ({
    code: s.ptcgoCode || s.id,
    name: s.name,
    released: s.releaseDate,
  }));
}

async function fetchCardsForSet(setId: string): Promise<Card[]> {
  const r = await fetch(`${API}/cards?q=set.id:${setId}&pageSize=250`, { headers });
  const j: any = await r.json();
  return (j.data || []).map((c: any): Card => {
    // Pokémon TCG API ships tcgplayer.prices as a STARTING price hint only — treat
    // it as a seed; real market/graded comps come from refreshPrices.ts.
    const rawSeed = Math.round(c?.tcgplayer?.prices?.holofoil?.market ?? c?.cardmarket?.prices?.averageSellPrice ?? 1);
    const langs: Lang[] = ["EN"]; // TCG API is EN; add JP via a JP catalog source
    return {
      id: c.id,
      name: c.name,
      set: c.set?.name ?? "",
      num: `${c.number}/${c.set?.printedTotal ?? ""}`,
      rarity: c.rarity ?? "C",
      variant: c.rarity ?? "",
      tier: tierForRaw(rawSeed),
      chase: /illustration rare|special|hyper|secret/i.test(c.rarity ?? ""),
      langs,
      raw: rawSeed,
      psa10: undefined, // filled by refreshPrices.ts
      chg: 0,
      img: c?.images?.large ?? c?.images?.small,
    };
  });
}

async function main() {
  const sets = await fetchSets();
  const targetSets = sets.slice(0, 3); // widen for full ingest
  const cards: Card[] = [];
  for (const s of targetSets) {
    // NOTE: fetchCardsForSet takes the API set id; map from your sets list as needed.
    // Left as an exercise — the API returns set.id on each card too.
  }
  const products: Product[] = []; // sealed products aren't in the TCG API — source from your distributor/retail feed
  loadCatalog({ cards, sets, products });
  console.log(`Ingested ${cards.length} cards across ${targetSets.length} sets.`);
  console.log("TODO: persist to Postgres (schema.sql) instead of the in-memory store.");
}

main().catch((e) => {
  console.error("ingest failed:", e);
  process.exit(1);
});
