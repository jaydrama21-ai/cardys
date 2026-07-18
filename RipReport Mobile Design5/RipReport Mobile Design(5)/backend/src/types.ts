// Entity schema — mirrors design_handoff_data_layer/RipDataService.interface.ts.
// Every screen in RipReport expects exactly these shapes.

export type Tier = "A" | "B" | "C" | "D";
export type Lang = "EN" | "JP" | "KR" | "ZH";
export type Company = "PSA" | "BGS" | "CGC" | "SGC" | "TAG";
export type Grade = 10 | 9.5 | 9 | 8;

export interface Card {
  id: string;
  name: string;
  set: string;
  num: string;
  rarity: string;
  variant: string;
  tier: Tier;
  chase?: boolean;
  langs: Lang[];
  raw: number;    // EN raw market, USD
  psa10?: number; // PSA-10 comp, USD
  chg: number;    // 30-day % change
  img?: string;   // card image URL (Pokémon TCG API `images.large`); optional
}

export interface CardSet {
  code: string;
  name: string;
  released: string;
}

export interface Product {
  id: string;
  name: string;
  set: string;
  type: string;
  packs: number;
  msrp: number;
  market: number;
}

export interface RecognizeResult {
  id: string | null;   // catalog id, or null if no confident match
  confidence: number;  // 0..1
  candidates?: { id: string; confidence: number }[];
}

// ---- prototype pricing constants (replace math with real comps in live mode) ----
export const GRADE_BASE: Record<Grade, number> = { 10: 5, 9.5: 3.4, 9: 2, 8: 1.3 };
export const COMPANY_FACTOR: Record<Company, number> = { PSA: 1.0, BGS: 1.15, CGC: 0.92, SGC: 0.9, TAG: 0.85 };
export const LANG_MULT: Record<Lang, number> = { EN: 1.0, JP: 0.9, KR: 0.75, ZH: 0.7 };

export function tierForRaw(raw: number): Tier {
  if (raw >= 30) return "A";
  if (raw >= 8) return "B";
  if (raw >= 2) return "C";
  return "D";
}
