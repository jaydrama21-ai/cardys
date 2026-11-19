// Card matching from text the phone read off the card (on-device OCR).
// Matcher copied from backend/src/recognize.ts (RipReport): the collector
// number is the strongest signal, name similarity breaks ties.

import type { Card } from "./types.js";
import { db } from "./db.js";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
const normNum = (s: string) =>
  norm(s)
    .split("/")
    .map((p) => p.replace(/^0+(?=\d)/, ""))
    .join("/");

function nameSimilarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter(Boolean));
  const tb = new Set(norm(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

export interface Hints { name?: string; set?: string; number?: string }

export interface MatchResult {
  id: string | null;
  confidence: number;
  candidates: { card: Card; confidence: number }[];
}

export function matchCatalog(hints: Hints, cards: Card[] = db.cards()): MatchResult {
  const num = hints.number ? normNum(hints.number) : null;
  const scored = cards
    .map((c) => {
      let score = 0;
      if (num) {
        const cardNum = normNum(c.num);
        if (cardNum === num) score += 0.6;
        else if (cardNum.split("/")[0] === num.split("/")[0]) score += 0.35;
      }
      if (hints.name) score += 0.5 * nameSimilarity(hints.name, c.name);
      if (hints.set && norm(c.set) === norm(hints.set)) score += 0.15;
      return { card: c, score };
    })
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (!scored.length) return { id: null, confidence: 0, candidates: [] };
  const confidence = Math.min(0.99, scored[0].score);
  return {
    id: confidence >= 0.45 ? scored[0].card.id : null,
    confidence,
    candidates: scored.map((s) => ({ card: s.card, confidence: Math.min(0.99, s.score) })),
  };
}

/** Likely name (first wordy line that isn't HP/stage text) + collector number. */
export function hintsFromText(text: string): Hints {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const number = text.match(/\b(\d{1,3}\s*\/\s*\d{1,3})\b/)?.[1]?.replace(/\s+/g, "");
  const name = lines.find((l) => /[a-zA-Z]{3,}/.test(l) && !/^(hp|basic|stage|trainer|energy|evolves)\b/i.test(l));
  return { name, number };
}
