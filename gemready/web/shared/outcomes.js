// Outcomes math shared by the web app, the backend and the tests.
// Pure functions: no I/O, no globals. Money is in US dollars (floats rounded
// to cents at the edges).
//
// The one formula everything rests on (matches the canvas copy on
// "Outcomes If You Grade" and "Costs If You Grade"):
//
//   net = (sale − eBayFee(sale) − gradingCost) − (raw − eBayFee(raw))
//
// i.e. what you'd keep after grading and selling, compared with selling raw
// today, with eBay's fee taken out of both sides.

export const MIN_SALES = 3; // never show a net with fewer recent graded sales

export const round2 = (n) => Math.round(n * 100) / 100;

/** eBay final value fee for one item at `sale` dollars (no store). */
export function ebayFee(sale, ebay) {
  if (!(sale > 0)) return 0;
  const upTo = Math.min(sale, ebay.threshold) * ebay.rateUpTo;
  const above = Math.max(0, sale - ebay.threshold) * ebay.rateAbove;
  const perOrder = sale <= ebay.smallOrderMax ? ebay.perOrderSmall : ebay.perOrderLarge;
  return round2(upTo + above + perOrder);
}

/** All costs to grade one card through `tier` (null parts are unknown). */
export function gradingCost(tier, { shippingIn = 0, returnShipping = null } = {}) {
  const known = (tier.price ?? 0) + (shippingIn || 0) + (returnShipping ?? 0);
  return {
    total: round2(known),
    gradingFee: tier.price,
    shippingIn: shippingIn || 0,
    returnShipping,
    complete: tier.price != null && returnShipping != null,
  };
}

export function netVsRaw({ sale, raw, cost, ebay }) {
  const keepGraded = sale - ebayFee(sale, ebay) - cost;
  const keepRaw = raw - ebayFee(raw, ebay);
  return round2(keepGraded - keepRaw);
}

/**
 * Cheapest open tier at `grader` that covers a card worth `value`.
 * A tier with maxValue=null is eligible but flagged (`valueLimitUnknown`).
 * Returns null when nothing open covers it.
 */
export function pickTier(fees, grader, value, { includePaused = false } = {}) {
  const g = fees.graders[grader];
  if (!g) return null;
  const open = g.tiers
    .filter((t) => includePaused || t.status !== "paused")
    .filter((t) => t.price != null)
    .filter((t) => t.maxValue == null || t.maxValue >= value)
    .sort((a, b) => a.price - b.price);
  // Prefer a tier with a known limit that covers the value over a cheaper
  // tier whose limit is unknown, when the card is worth more than $1,000.
  const known = open.filter((t) => t.maxValue != null);
  const pick = value > 1000 && known.length ? known[0] : open[0];
  if (!pick) return null;
  return { ...pick, valueLimitUnknown: pick.maxValue == null };
}

/** The grade ladder shown on Outcomes, per grader's own scale. */
export const OUTCOME_GRADES = {
  PSA: ["10", "9", "8", "≤7"],
  BGS: ["10", "9.5", "9", "≤8.5"],
  CGC: ["10", "9.5", "9", "≤8.5"],
  TAG: ["10", "9", "8", "≤7"],
};

/**
 * One row per grade on the grader's scale.
 * comps: { [grade]: { value, sales, source } } — recent graded sales.
 * probs (optional): { [grade]: 0..1 } from the model; omitted in beta.
 */
export function outcomeRows({ grader, raw, comps, tier, ebay, shippingIn = 0, returnShipping = null, probs = null }) {
  const cost = tier ? gradingCost(tier, { shippingIn, returnShipping }) : null;
  return OUTCOME_GRADES[grader].map((grade) => {
    const comp = comps?.[grade] ?? null;
    const p = probs ? probs[grade] ?? 0 : null;
    if (!comp || !(comp.value > 0)) {
      return { grade, prob: p, sale: null, sales: comp?.sales ?? 0, net: null, reason: "NO_RECENT_SALES" };
    }
    if ((comp.sales ?? 0) < MIN_SALES && comp.sales !== null) {
      return { grade, prob: p, sale: comp.value, sales: comp.sales, net: null, reason: "TOO_FEW_SALES" };
    }
    if (!cost) return { grade, prob: p, sale: comp.value, sales: comp.sales, net: null, reason: "NO_OPEN_TIER" };
    return {
      grade, prob: p, sale: comp.value, sales: comp.sales, source: comp.source,
      net: netVsRaw({ sale: comp.value, raw, cost: cost.total, ebay }),
      reason: null,
    };
  });
}

const gradeNum = (g) => parseFloat(String(g).replace("≤", ""));

/**
 * Lowest grade at which sending clears `minNet`, with every higher grade
 * clearing it too. null when no grade does.
 */
export function worthItAt(rows, minNet = 0) {
  const priced = rows.filter((r) => r.net != null).sort((a, b) => gradeNum(b.grade) - gradeNum(a.grade));
  let lowest = null;
  for (const r of priced) {
    if (r.net >= minNet) lowest = r.grade;
    else break;
  }
  return lowest;
}

/** Probability-weighted net, only when the model is on and every row is priced. */
export function expectedNet(rows) {
  if (rows.some((r) => r.prob == null)) return null;
  const priced = rows.filter((r) => r.net != null);
  const mass = priced.reduce((s, r) => s + r.prob, 0);
  if (mass < 0.8) return null; // too much probability on unpriced grades
  return round2(priced.reduce((s, r) => s + r.prob * r.net, 0) / mass);
}

/** One-line verdict for the gold box on Outcomes. */
export function verdict(rows, minNet = 0) {
  const at = worthItAt(rows, minNet);
  const priced = rows.filter((r) => r.net != null);
  if (!priced.length) return { kind: "unknown", worthAt: null };
  if (at == null) return { kind: "not-worth", worthAt: null };
  return { kind: "worth", worthAt: at };
}

/**
 * Group planned cards into shared shipments (same grader + tier) — Plan a
 * Submission. cards: [{ id, name, grader, value }].
 */
export function planBatches(cards, fees) {
  const groups = new Map();
  for (const c of cards) {
    const tier = pickTier(fees, c.grader, c.value);
    if (!tier) continue;
    const key = `${c.grader}|${tier.id}`;
    if (!groups.has(key)) groups.set(key, { grader: c.grader, tier, cards: [] });
    groups.get(key).cards.push(c);
  }
  return [...groups.values()].map((g) => {
    const ret = fees.graders[g.grader].returnShipping;
    const grading = round2(g.tier.price * g.cards.length);
    const shipping = ret.amount;
    const perCard = shipping == null ? round2(g.tier.price) : round2((grading + shipping) / g.cards.length);
    const savings = shipping == null ? null : round2(shipping * (g.cards.length - 1));
    const short = g.tier.min && g.cards.length < g.tier.min ? g.tier.min - g.cards.length : 0;
    return { ...g, grading, shipping, shippingEstimate: ret.estimate, perCard, savings, needMore: short };
  });
}
