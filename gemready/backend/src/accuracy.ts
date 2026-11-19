// accuracy_stats(): what "Our Accuracy" shows, computed from anonymous slab
// results. Nothing is shown until there are enough results to mean something
// (canvas note "accuracyEmpty": 30). A grader's own row needs 30 of its own.

import type { SlabResult } from "./store.js";

export const MIN_RESULTS = 30;
const num = (g: string) => parseFloat(String(g).replace(/[^\d.]/g, ""));

const bucket = (g: string) => {
  const n = num(g);
  if (n >= 10) return "10";
  if (n >= 9.5) return "9.5";
  if (n >= 9) return "9";
  return "≤8.5";
};

function rate(rows: { est: number; act: number }[]) {
  if (!rows.length) return { n: 0, within1: null as number | null, exact: null as number | null };
  const within1 = rows.filter((r) => Math.abs(r.est - r.act) <= 1).length / rows.length;
  const exact = rows.filter((r) => r.est === r.act).length / rows.length;
  return { n: rows.length, within1, exact };
}

export function accuracyStats(results: SlabResult[], min = MIN_RESULTS) {
  const scored = results
    .filter((r) => r.estimate?.mostLikely != null && r.grade)
    .map((r) => ({ r, est: num(r.estimate!.mostLikely!), act: num(r.grade) }))
    .filter((x) => isFinite(x.est) && isFinite(x.act));
  if (scored.length < min) {
    return { enough: false, count: scored.length, needed: min, totalSlabs: results.length };
  }
  const overall = rate(scored);
  const byEstimate = Object.fromEntries(
    ["10", "9.5", "9", "≤8.5"].map((b) => [b, rate(scored.filter((x) => bucket(x.r.estimate!.mostLikely!) === b))])
  );
  const byGrader = Object.fromEntries(
    ["PSA", "BGS", "CGC", "TAG"].map((g) => {
      const rows = scored.filter((x) => x.r.grader === g);
      return [g, rows.length >= min ? rate(rows) : { n: rows.length, within1: null, exact: null, needed: min }];
    })
  );
  const misses = scored.filter((x) => x.est !== x.act);
  const holo = scored.filter((x) => x.r.holo);
  return {
    enough: true,
    count: scored.length,
    totalSlabs: results.length,
    within1: overall.within1,
    exact: overall.exact,
    byEstimate,
    byGrader,
    tooHigh: misses.length ? misses.filter((x) => x.est > x.act).length / misses.length : null,
    tooLow: misses.length ? misses.filter((x) => x.est < x.act).length / misses.length : null,
    holo: holo.length >= 10 ? rate(holo) : null,
  };
}

/** Median days from sent to back, per grader + tier (needs 5 returns). */
export function turnaroundStats(results: SlabResult[], min = 5) {
  const groups = new Map<string, number[]>();
  for (const r of results) {
    if (!r.sentOn || !r.returnedOn) continue;
    const days = (Date.parse(r.returnedOn) - Date.parse(r.sentOn)) / 864e5;
    if (!(days >= 0 && days < 400)) continue;
    const k = `${r.grader}|${r.tier ?? ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(days);
  }
  const out: Record<string, { median: number; n: number }> = {};
  for (const [k, v] of groups) {
    if (v.length < min) continue;
    v.sort((a, b) => a - b);
    out[k] = { median: Math.round(v[Math.floor(v.length / 2)]), n: v.length };
  }
  return out;
}
