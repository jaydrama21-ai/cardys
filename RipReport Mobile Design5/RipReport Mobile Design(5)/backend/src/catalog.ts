// Live catalog loader — fetches real cards (with images) from the free
// Pokémon TCG API and maps them to the Card schema. Called by the server on
// boot when DATA_MODE=live and POKEMONTCG_API_KEY is set.

import type { Card, CardSet, Product } from "./types.js";
import { tierForRaw } from "./types.js";

const API = "https://api.pokemontcg.io/v2";
function headers(): Record<string, string> {
  return process.env.POKEMONTCG_API_KEY ? { "X-Api-Key": process.env.POKEMONTCG_API_KEY } : {};
}

type SetWithId = CardSet & { _id: string };

export async function fetchSets(limit = 8): Promise<SetWithId[]> {
  const r = await fetch(`${API}/sets?orderBy=-releaseDate&pageSize=${limit}`, { headers: headers() });
  const j: any = await r.json();
  return (j.data || []).map((s: any) => ({
    code: s.ptcgoCode || s.id,
    name: s.name,
    released: s.releaseDate,
    _id: s.id,
  }));
}

function mapCard(c: any): Card {
  const rawSeed =
    Math.round(
      c?.tcgplayer?.prices?.holofoil?.market ??
        c?.tcgplayer?.prices?.normal?.market ??
        c?.tcgplayer?.prices?.reverseHolofoil?.market ??
        c?.cardmarket?.prices?.averageSellPrice ??
        1
    ) || 1;
  return {
    id: c.id,
    name: c.name,
    set: c.set?.name ?? "",
    num: `${c.number}/${c.set?.printedTotal ?? ""}`,
    rarity: c.rarity ?? "Common",
    variant: c.rarity ?? "",
    tier: tierForRaw(rawSeed),
    chase: /illustration rare|special|hyper|secret|gold/i.test(c.rarity ?? ""),
    langs: ["EN"],
    raw: rawSeed,
    psa10: undefined, // refreshPrices.ts fills real graded comps
    chg: 0,
    img: c?.images?.large ?? c?.images?.small,
  };
}

export async function fetchCardsForSet(setId: string): Promise<Card[]> {
  const r = await fetch(`${API}/cards?q=set.id:${setId}&pageSize=250`, { headers: headers() });
  const j: any = await r.json();
  return (j.data || []).map(mapCard);
}

/** Pull the most recent `setLimit` sets and all their cards (with images). */
export async function loadLiveCatalog(setLimit = 8): Promise<{ cards: Card[]; sets: CardSet[] }> {
  const setsRaw = await fetchSets(setLimit);
  const cards: Card[] = [];
  for (const s of setsRaw) {
    try {
      cards.push(...(await fetchCardsForSet(s._id)));
    } catch {
      /* skip a set that fails; keep going */
    }
  }
  const sets: CardSet[] = setsRaw.map(({ _id, ...rest }) => rest);
  return { cards, sets };
}

/** Sealed products aren't in the TCG API — supply your own retail feed here.
 *  For now we keep the sample products so the Sealed tab stays populated. */
export function liveProductsFallback(mock: Product[]): Product[] {
  return mock;
}
