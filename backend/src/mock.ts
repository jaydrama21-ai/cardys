// Small mock dataset in the EXACT live shape, so the server runs with zero keys.
// Swap for real ingested data (jobs/ingestCatalog.ts) once POKEMONTCG_API_KEY is set.

import type { Card, CardSet, Product } from "./types.js";
import { tierForRaw } from "./types.js";

const raw = (
  id: string, name: string, set: string, num: string, rarity: string,
  variant: string, rawUsd: number, psa10: number, chg: number,
  langs: Card["langs"] = ["EN"], chase = false
): Card => ({
  id, name, set, num, rarity, variant, tier: tierForRaw(rawUsd),
  chase, langs, raw: rawUsd, psa10, chg,
});

export const SETS: CardSet[] = [
  { code: "PRE", name: "Prismatic Evolutions", released: "Jan 2025" },
  { code: "SSP", name: "Surging Sparks", released: "Nov 2024" },
  { code: "MEW", name: "151", released: "Sep 2023" },
];

export const CARDS: Card[] = [
  raw("pre-umbreon-ex-sir", "Umbreon ex", "Prismatic Evolutions", "161/131", "SIR", "Special Illustration Rare", 1350, 2600, 6.4, ["EN", "JP"], true),
  raw("pre-espeon-ex-sir", "Espeon ex", "Prismatic Evolutions", "155/131", "SIR", "Special Illustration Rare", 210, 520, 3.1, ["EN", "JP"], true),
  raw("ssp-pikachu-ex-sir", "Pikachu ex", "Surging Sparks", "238/191", "SIR", "Special Illustration Rare", 420, 900, -1.4, ["EN"], true),
  raw("ssp-milotic-ex-sir", "Milotic ex", "Surging Sparks", "213/191", "SIR", "Special Illustration Rare", 38, 96, 2.2),
  raw("mew-charizard-ex-sir", "Charizard ex", "151", "199/165", "SIR", "Special Illustration Rare", 260, 620, 1.8, ["EN", "JP"], true),
  raw("mew-alakazam-ex-sir", "Alakazam ex", "151", "184/165", "SIR", "Special Illustration Rare", 45, 120, -0.6),
  raw("ssp-cyclizar-rh", "Cyclizar", "Surging Sparks", "111/191", "C", "Reverse Holo", 1.2, 6, 0.4),
];

export const PRODUCTS: Product[] = [
  { id: "pr-pre-bb", name: "Prismatic Evolutions Booster Box", set: "Prismatic Evolutions", type: "Booster Box", packs: 36, msrp: 161, market: 520 },
  { id: "pr-pre-etb", name: "Prismatic Evolutions Elite Trainer Box", set: "Prismatic Evolutions", type: "Elite Trainer Box", packs: 9, msrp: 50, market: 145 },
  { id: "pr-ssp-bb", name: "Surging Sparks Booster Box", set: "Surging Sparks", type: "Booster Box", packs: 36, msrp: 144, market: 190 },
];
