// Grading rules shared by the app, backend and model pipeline.
//
// Centering limits are each grader's published or widely reported tolerances,
// written as the LARGER side's share in percent (55 means "55/45 or better").
// Graders change standards — REVIEW THESE when refreshing fees.json. Entries
// marked approximate are community-reported, not on the grader's own site.

export const GRADERS = ["PSA", "BGS", "CGC", "TAG"];

export const CENTERING_LIMITS = {
  PSA: {
    source: "https://www.psacard.com/resources/cardgradingstandards",
    approximate: false,
    grades: [
      { grade: "10", front: 55, back: 75 },
      { grade: "9", front: 60, back: 90 },
      { grade: "8", front: 65, back: 90 },
      { grade: "7", front: 70, back: 90 },
      { grade: "6", front: 80, back: 90 },
      { grade: "5", front: 85, back: 90 },
    ],
  },
  BGS: {
    source: "Beckett grading scale (published sub-grade centering)",
    approximate: false,
    grades: [
      { grade: "10", front: 50, back: 55 }, // Pristine
      { grade: "9.5", front: 55, back: 60 },
      { grade: "9", front: 60, back: 80 },
      { grade: "8.5", front: 65, back: 90 },
      { grade: "8", front: 70, back: 95 },
    ],
  },
  CGC: {
    source: "https://www.cgccards.com/card-grading/grading-scale/",
    approximate: true,
    grades: [
      { grade: "10", front: 55, back: 75 }, // Gem Mint 10 (Pristine 10 is 50/50 · 55/45)
      { grade: "9.5", front: 60, back: 80 },
      { grade: "9", front: 62, back: 85 },
      { grade: "8.5", front: 65, back: 90 },
      { grade: "8", front: 70, back: 90 },
    ],
  },
  TAG: {
    source: "TAG scores centering on its own 1000-point scale; PSA-equivalent limits used",
    approximate: true,
    grades: [
      { grade: "10", front: 55, back: 75 },
      { grade: "9", front: 60, back: 90 },
      { grade: "8", front: 65, back: 90 },
      { grade: "7", front: 70, back: 90 },
    ],
  },
};

/** "55/45" from a fraction 0..1 (the left or top share). */
export function ratioLabel(frac) {
  if (frac == null || !isFinite(frac)) return "—";
  const big = Math.round(Math.max(frac, 1 - frac) * 100);
  return `${big}/${100 - big}`;
}

/** Larger-side percent from a fraction: 0.45 → 55. */
export const worstSide = (frac) => Math.round(Math.max(frac, 1 - frac) * 100);

/**
 * Best grade centering alone allows on `grader`'s scale.
 * front/back: { lr, tb } fractions (left share, top share). back may be null
 * when there is no back photo — then only the front limit is applied and the
 * result is flagged `backUnknown`.
 */
export function centeringGrade(grader, front, back) {
  const limits = CENTERING_LIMITS[grader];
  if (!limits || !front) return null;
  const f = Math.max(worstSide(front.lr), worstSide(front.tb));
  const b = back ? Math.max(worstSide(back.lr), worstSide(back.tb)) : null;
  for (const row of limits.grades) {
    if (f <= row.front && (b == null || b <= row.back)) {
      return { grade: row.grade, frontWorst: f, backWorst: b, backUnknown: b == null, approximate: limits.approximate };
    }
  }
  const last = limits.grades[limits.grades.length - 1];
  return { grade: `<${last.grade}`, frontWorst: f, backWorst: b, backUnknown: b == null, approximate: limits.approximate };
}

/** Grade names per scale — "Grade Key". */
export const GRADE_SCALES = {
  PSA: [
    { grade: "10", name: "Gem Mint", note: "Top grade on the PSA scale" },
    { grade: "9", name: "Mint", note: "One minor flaw allowed" },
    { grade: "8", name: "NM-MT", note: "Slight wear or off-center" },
    { grade: "7", name: "NM", note: "Light wear visible" },
  ],
  BGS: [
    { grade: "10", name: "Black Label", note: "All four sub-grades are 10" },
    { grade: "10", name: "Pristine", note: "Near-flawless overall" },
    { grade: "9.5", name: "Gem Mint", note: "Same name as a PSA 10, sells for less" },
    { grade: "9", name: "Mint", note: "Minor flaws" },
    { grade: "8.5", name: "NM-MT+", note: "Light wear" },
  ],
  CGC: [
    { grade: "10", name: "Pristine", note: "Flawless under magnification" },
    { grade: "10", name: "Gem Mint", note: "Same name as a PSA 10" },
    { grade: "9.5", name: "Mint+", note: "Nearly flawless" },
    { grade: "9", name: "Mint", note: "Minor flaws" },
  ],
  TAG: [
    { grade: "10", name: "Pristine / Gem Mint", note: "Scored 950+ of 1000" },
    { grade: "9", name: "Mint", note: "Minor flaws" },
    { grade: "8", name: "NM-MT", note: "Slight wear" },
  ],
};

const num = (g) => parseFloat(String(g).replace(/[^\d.]/g, ""));

/**
 * Strong / Maybe / Weak — the collection badge.
 * With the model on, from the most likely grade vs the user's threshold.
 * In beta (no odds), only centering can rule a card out: a centering cap below
 * the threshold is "weak"; otherwise "unknown" until odds exist.
 */
export function candidateClass({ mostLikely = null, centeringCap = null, threshold = "9" }) {
  const t = num(threshold);
  if (centeringCap && !String(centeringCap).startsWith("<") && num(centeringCap) < t) return "weak";
  if (centeringCap && String(centeringCap).startsWith("<")) return "weak";
  if (mostLikely == null) return "unknown";
  const m = num(mostLikely);
  if (m >= t + 0.5 || (m >= t && m >= 9.5)) return "strong";
  if (m >= t) return "maybe";
  return "weak";
}

/**
 * Gem route (canvas note "gemRoute"): show Gem Candidate only when every gem
 * check passes. Returns { gem, failed: [reason…] }.
 */
export function gemChecks({ grader, photos, front, back, flags = [] }) {
  const failed = [];
  if ((photos?.full ?? 0) < 2) failed.push("Needs both full photos");
  if ((photos?.closeups ?? 0) < 16) failed.push("Needs all 16 close-ups");
  if ((photos?.tilt ?? 0) < 1) failed.push("Needs a tilt shot");
  const c = centeringGrade(grader, front, back);
  if (!c || c.grade !== "10") failed.push("Centering outside 10 limits");
  for (const f of flags) failed.push(f);
  return { gem: failed.length === 0, failed };
}
