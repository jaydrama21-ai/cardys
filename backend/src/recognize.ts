// Recognition: photo -> catalog id. Three strategies, chosen by env.
//   RECOGNIZE_MODE=ximilar  -> Ximilar card-recognition API
//   RECOGNIZE_MODE=ocr      -> OCR (Google Vision) name/number, fuzzy-match catalog
//   (mock, default)         -> returns a plausible candidate so the scan flow works
//
// Input is a base64 image (data URL or raw). Output is RecognizeResult — always
// { id, confidence, candidates[] }, never a throw.

import type { Card, RecognizeResult } from "./types.js";
import { db } from "./db.js";

const MODE = process.env.RECOGNIZE_MODE || "mock";

export async function recognize(imageBase64: string): Promise<RecognizeResult> {
  if (MODE === "ximilar" && process.env.XIMILAR_API_TOKEN) return recognizeXimilar(imageBase64);
  if (MODE === "ocr") return recognizeOcr(imageBase64);
  return recognizeMock();
}

// ---------------------------------------------------------------------------
// Catalog matcher — shared by both live strategies. The collector number is
// the strongest signal ("161/131" is nearly unique across the catalog); name
// similarity breaks ties and covers number-less reads.
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();

/** Collector numbers print with leading zeros ("087/086") but the catalog
 *  stores them bare ("87/86") — compare with zeros stripped. */
const normNum = (s: string) =>
  norm(s)
    .split("/")
    .map((p) => p.replace(/^0+(?=\d)/, ""))
    .join("/");

/** Token-overlap similarity in [0,1] — cheap and OCR-noise tolerant. Scored
 *  against the smaller token set so OCR extras ("HP210", "Basic") don't dilute
 *  a clean name hit. */
function nameSimilarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter(Boolean));
  const tb = new Set(norm(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

export interface RecognitionHints {
  name?: string;
  set?: string;
  number?: string; // "161/131" or just "161"
}

/** Score every catalog card against the hints; return ranked candidates. */
export function matchCatalog(hints: RecognitionHints): RecognizeResult {
  const cards = db.cards();
  const num = hints.number ? normNum(hints.number) : null;
  const scored = cards
    .map((c: Card) => {
      let score = 0;
      if (num) {
        const cardNum = normNum(c.num);
        if (cardNum === num) score += 0.6; // full "161/131" match
        else if (cardNum.split("/")[0] === num.split("/")[0]) score += 0.35; // printed number only
      }
      if (hints.name) score += 0.5 * nameSimilarity(hints.name, c.name);
      if (hints.set && norm(c.set) === norm(hints.set)) score += 0.15;
      return { card: c, score };
    })
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!scored.length) return { id: null, confidence: 0, candidates: [] };
  const best = scored[0];
  const confidence = Math.min(0.99, best.score);
  return {
    id: confidence >= 0.45 ? best.card.id : null,
    confidence,
    candidates: scored.map((s) => ({ id: s.card.id, confidence: Math.min(0.99, s.score) })),
  };
}

// --- Ximilar: image -> {name, set, number} -> catalog match -------------------
async function recognizeXimilar(imageBase64: string): Promise<RecognizeResult> {
  try {
    const res = await fetch("https://api.ximilar.com/card-id/v2/detect", {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.XIMILAR_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [{ _base64: stripDataUrl(imageBase64) }] }),
    });
    if (!res.ok) return { id: null, confidence: 0, candidates: [] };
    const json: any = await res.json();
    // The identified card rides on the detected object; exact nesting varies by
    // plan, so probe both the record and its first object.
    const rec = json?.records?.[0];
    const ident = rec?._objects?.[0]?._identification ?? rec?._identification;
    const best = ident?.best_match;
    if (!best) return { id: null, confidence: 0, candidates: [] };
    const matched = matchCatalog({
      name: best.name ?? best.full_name,
      set: best.set ?? best.set_name,
      number: best.card_number ?? best.number,
    });
    // Blend Ximilar's own confidence with the catalog-match confidence.
    const xiScore = typeof best.score === "number" ? best.score : 0.8;
    return { ...matched, confidence: Math.min(0.99, matched.confidence * 0.5 + xiScore * 0.5) };
  } catch {
    return { id: null, confidence: 0, candidates: [] };
  }
}

// --- OCR (Google Vision): read name + collector number, fuzzy-match -----------
async function recognizeOcr(imageBase64: string): Promise<RecognizeResult> {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) {
    console.error("RECOGNIZE_MODE=ocr needs GOOGLE_VISION_API_KEY.");
    return { id: null, confidence: 0, candidates: [] };
  }
  try {
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: stripDataUrl(imageBase64) },
            features: [{ type: "TEXT_DETECTION" }],
          },
        ],
      }),
    });
    if (!res.ok) return { id: null, confidence: 0, candidates: [] };
    const json: any = await res.json();
    const text: string = json?.responses?.[0]?.fullTextAnnotation?.text ?? "";
    if (!text) return { id: null, confidence: 0, candidates: [] };
    return matchCatalog(hintsFromOcrText(text));
  } catch {
    return { id: null, confidence: 0, candidates: [] };
  }
}

/** Pull the likely card name (first non-numeric line) + collector number. */
export function hintsFromOcrText(text: string): RecognitionHints {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const number = text.match(/\b(\d{1,3}\s*\/\s*\d{1,3})\b/)?.[1]?.replace(/\s+/g, "");
  const name = lines.find((l) => /[a-zA-Z]{3,}/.test(l) && !/^(hp|basic|stage|trainer|energy)\b/i.test(l));
  return { name, number };
}

// --- Mock: keeps the scan flow working with zero keys -------------------------
function recognizeMock(): RecognizeResult {
  const cards = db.cards();
  const pick = cards[Math.floor(Math.random() * cards.length)];
  return {
    id: pick.id,
    confidence: 0.9,
    candidates: cards.slice(0, 3).map((c) => ({ id: c.id, confidence: 0.5 })),
  };
}

function stripDataUrl(s: string): string {
  const i = s.indexOf("base64,");
  return i >= 0 ? s.slice(i + 7) : s;
}
