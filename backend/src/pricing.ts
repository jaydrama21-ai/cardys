// Pricing engine. In mock mode it reproduces the prototype's modelled math so the
// app looks identical. In live mode it reads cached sold-comps (warmed from
// Postgres, written by jobs/refreshPrices.ts) and falls back to the modelled
// value whenever no comp exists — it never throws and never blocks.

import type { Card, Company, Grade, Lang } from "./types.js";
import { GRADE_BASE, COMPANY_FACTOR, LANG_MULT } from "./types.js";
import { getComp, getHistorySeries } from "./priceCache.js";

const LIVE = process.env.DATA_MODE === "live";

/** Comp-cache kind for a PSA grade. */
const kindForGrade = (g: Grade): string =>
  g === 10 ? "psa10" : g === 9.5 ? "psa95" : g === 9 ? "psa9" : "psa8";

/** Comp-cache kind for a company+grade; null when only the factor model applies. */
const kindForCompany = (co: Company, g: Grade): string | null => {
  if (co === "PSA") return kindForGrade(g);
  return g === 10 ? `${co.toLowerCase()}10` : null; // bgs10 | cgc10 | sgc10 | tag10
};

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

/** ~14-point series ending at `end` (oldest→newest). Live mode returns the real
 *  stored daily series when one exists; otherwise the modelled interpolation. */
export function histFor(end: number, chgPct: number, card?: Card | null): number[] {
  if (LIVE && card) {
    const real = getHistorySeries(card.id, "raw");
    if (real && real.length >= 2) {
      const out = [...real];
      out[out.length - 1] = Math.round(end); // contract: last point === current value
      return out;
    }
  }
  const n = 14;
  const start = end / (1 + chgPct / 100);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const wobble = LIVE ? 0 : Math.sin(i * 1.3) * (end * 0.015);
    out.push(Math.max(0, Math.round(start + (end - start) * t + wobble)));
  }
  out[out.length - 1] = Math.round(end);
  return out;
}

// ---------------------------------------------------------------------------
// LIVE adapters — cached-comp reads with modelled fallback. Never throw.
// ---------------------------------------------------------------------------
function liveRaw(card: Card, lang: Lang): number {
  const comp = getComp(card.id, "raw");
  const enRaw = comp ? comp.value : card.raw;
  return Math.round(enRaw * LANG_MULT[lang]);
}

function liveGradedAbs(card: Card, grade: Grade): number {
  const exact = getComp(card.id, kindForGrade(grade));
  if (exact) return exact.value;
  // Scale from a real PSA-10 comp when we have one; else the seeded/modelled p10.
  const p10 =
    getComp(card.id, "psa10")?.value ??
    card.psa10 ??
    Math.round((getComp(card.id, "raw")?.value ?? card.raw) * GRADE_BASE[10]);
  return Math.round(p10 * (GRADE_BASE[grade] / GRADE_BASE[10]));
}

function liveGraded(card: Card, company: Company, grade: Grade, lang: Lang): number {
  const kind = kindForCompany(company, grade);
  const exact = kind ? getComp(card.id, kind) : null;
  // A real company-specific comp already includes the company premium.
  const abs = exact ? exact.value : liveGradedAbs(card, grade) * COMPANY_FACTOR[company];
  return Math.round(abs * LANG_MULT[lang]);
}
