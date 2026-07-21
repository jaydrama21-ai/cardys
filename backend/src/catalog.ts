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
  const r = await fetch(`${API}/sets?orderBy=-releaseDate&pageSize=${limit}`, {
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`TCG API /sets responded ${r.status}`);
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
  const img = c?.images?.large ?? c?.images?.small;
  // Second image URL on the classic pokemontcg.io CDN — the two image hosts
  // fail independently, and the app's art slot layers both.
  const setId =
    c?.set?.id ??
    (typeof c.id === "string" && c.id.includes("-") ? c.id.slice(0, c.id.lastIndexOf("-")) : null);
  const img2 = setId && c.number ? `https://images.pokemontcg.io/${setId}/${c.number}_hires.png` : undefined;
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
    img,
    img2: img2 && img2 !== img ? img2 : undefined,
  };
}

export async function fetchCardsForSet(setId: string): Promise<Card[]> {
  const r = await fetch(`${API}/cards?q=set.id:${setId}&pageSize=250`, {
    headers: headers(),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`TCG API /cards responded ${r.status} for set ${setId}`);
  const j: any = await r.json();
  return (j.data || []).map(mapCard);
}

/** Pull the most recent `setLimit` sets and all their cards (with images).
 *  Tries the live API first; if it's down or rate-limiting (it often is), falls
 *  back to the official data mirror on GitHub — same cards, same image URLs,
 *  no key, no rate limits. */
export async function loadLiveCatalog(setLimit = 0): Promise<{ cards: Card[]; sets: CardSet[] }> {
  // setLimit <= 0 means the FULL catalog — the mirror serves that best (one
  // request per set, no rate limits), so skip the flaky API entirely.
  if (setLimit <= 0) return loadCatalogFromMirror(0);
  try {
    const setsRaw = await fetchSets(setLimit);
    if (!setsRaw.length) throw new Error("API returned no sets");
    const cards: Card[] = [];
    for (const s of setsRaw) {
      try {
        cards.push(...(await fetchCardsForSet(s._id)));
      } catch (e) {
        console.error(`catalog: skipping set ${s.name} (${s._id}):`, (e as Error).message);
      }
    }
    if (!cards.length) throw new Error("API returned no cards");
    // A card without an image is unusable in the app — drop it here.
    const withArt = cards.filter((c) => c.img);
    cards.length = 0;
    cards.push(...withArt);
    const used = new Set<string>();
    const sets: CardSet[] = setsRaw.map(({ _id, ...rest }) => {
      // ptcgoCodes collide (Crown Zenith and its Galarian Gallery are both
      // "CRZ") — fall back to the unique set id so every set persists.
      const code = used.has(rest.code) ? _id : rest.code;
      used.add(code);
      return { ...rest, code };
    });
    return { cards, sets };
  } catch (e) {
    console.error(`catalog: live API failed (${(e as Error).message}) — trying GitHub data mirror…`);
    return loadCatalogFromMirror(setLimit);
  }
}

// --- Fallback: PokemonTCG/pokemon-tcg-data on GitHub --------------------------
// The API's own dataset, published as raw JSON. Card entries lack the embedded
// `set` object the API adds, so we inject name/printedTotal from the set record
// before mapping.
const MIRROR = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";

export async function loadCatalogFromMirror(setLimit = 0): Promise<{ cards: Card[]; sets: CardSet[] }> {
  const r = await fetch(`${MIRROR}/sets/en.json`, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`mirror /sets responded ${r.status}`);
  const allSets: any[] = await r.json();
  const sorted = allSets
    .filter((s) => s.releaseDate)
    .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)));
  const picked = setLimit > 0 ? sorted.slice(0, setLimit) : sorted;

  const fetchSet = async (s: any): Promise<Card[]> => {
    try {
      const cr = await fetch(`${MIRROR}/cards/en/${s.id}.json`, { signal: AbortSignal.timeout(60_000) });
      if (!cr.ok) throw new Error(`responded ${cr.status}`);
      const raw: any[] = await cr.json();
      return raw.map((c) => mapCard({ ...c, set: { id: s.id, name: s.name, printedTotal: s.printedTotal } }));
    } catch (e) {
      console.error(`catalog: mirror skipping set ${s.name} (${s.id}):`, (e as Error).message);
      return [];
    }
  };

  // Pull sets 8 at a time — the full catalog (~170 sets) loads in well under a
  // minute without hammering the mirror.
  const cards: Card[] = [];
  for (let i = 0; i < picked.length; i += 8) {
    const batch = await Promise.all(picked.slice(i, i + 8).map(fetchSet));
    for (const b of batch) cards.push(...b);
  }

  const withArt = cards.filter((c) => c.img);
  cards.length = 0;
  cards.push(...withArt);
  const used = new Set<string>();
  const sets: CardSet[] = picked.map((s) => {
    // ptcgoCodes collide (e.g. Crown Zenith + its Galarian Gallery are both
    // "CRZ") — fall back to the unique set id so every set persists.
    const preferred = s.ptcgoCode || s.id;
    const code = used.has(preferred) ? s.id : preferred;
    used.add(code);
    return { code, name: s.name, released: s.releaseDate };
  });
  return { cards, sets };
}

/** Sealed products aren't in the TCG API — supply your own retail feed here.
 *  For now we keep the sample products so the Sealed tab stays populated. */
export function liveProductsFallback(mock: Product[]): Product[] {
  return mock;
}
