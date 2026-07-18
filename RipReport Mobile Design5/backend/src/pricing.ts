// Pricing engine. In mock mode it reproduces the prototype's modelled math so the
// app looks identical. In live mode, each function should return REAL comps from
// your pricing source (PriceCharting / TCGplayer / eBay sold), cached in your DB.

import type { Card, Company, Grade, Lang } from "./types.js";
import { GRADE_BASE, COMPANY_FACTOR, LANG_MULT } from "./types.js";

const LIVE = process.env.DATA_MODE === "live";

/** EN raw × language multiplier. */
export function priceRaw(card: Card, lang: Lang): number {
  if (LIVE) return liveRaw(card, lang);
  return Math.round(card.raw * LANG_MULT[lang]);
}

/** Absolute per-grade comp before company/language factors. */
export function gradedAbs(card: Card, grade: Grade): number {
  if (LIVE) return liveGradedAbs(card, grade);
  const p10 = card.psa10 ?? Math.round(card.raw * GRADE_BASE[10]);
  return Math.round(p10 * (GRADE_BASE[grade] / GRADE_BASE[10]));
}

/** Full graded comp = gradedAbs × companyFactor × langMult. */
export function priceGraded(card: Card, company: Company, grade: Grade, lang: Lang): number {
  if (LIVE) return liveGraded(card, company, grade, lang);
  return Math.round(gradedAbs(card, grade) * COMPANY_FACTOR[company] * LANG_MULT[lang]);
}

/** ~14-point series ending at `end`, shaped by 30-day % change (oldest→newest). */
export function histFor(end: number, chgPct: number): number[] {
  if (LIVE) return liveHistory(end, chgPct);
  const n = 14;
  const start = end / (1 + chgPct / 100);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const wobble = Math.sin(i * 1.3) * (end * 0.015);
    out.push(Math.max(0, Math.round(start + (end - start) * t + wobble)));
  }
  out[out.length - 1] = Math.round(end);
  return out;
}

// ---------------------------------------------------------------------------
// LIVE adapters — TODO: implement against your pricing source + price cache.
// Return whole USD numbers. Never throw; fall back to the modelled value.
// ---------------------------------------------------------------------------
function liveRaw(card: Card, lang: Lang): number {
  // TODO: read cached sold-comp for (card.id, "raw", lang) from your DB.
  return Math.round(card.raw * LANG_MULT[lang]);
}
function liveGradedAbs(card: Card, grade: Grade): number {
  // TODO: read cached per-grade comp for (card.id, grade) from your DB.
  const p10 = card.psa10 ?? Math.round(card.raw * GRADE_BASE[10]);
  return Math.round(p10 * (GRADE_BASE[grade] / GRADE_BASE[10]));
}
function liveGraded(card: Card, company: Company, grade: Grade, lang: Lang): number {
  // TODO: read cached per-company/grade/lang comp from your DB.
  return Math.round(liveGradedAbs(card, grade) * COMPANY_FACTOR[company] * LANG_MULT[lang]);
}
function liveHistory(end: number, chgPct: number): number[] {
  // TODO: return the real stored daily series (last value === end).
  const n = 14;
  const start = end / (1 + chgPct / 100);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round(start + (end - start) * (i / (n - 1))));
  out[out.length - 1] = Math.round(end);
  return out;
}
