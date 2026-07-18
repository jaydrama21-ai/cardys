// Recognition: photo -> catalog id. Three strategies, chosen by env.
//   RECOGNIZE_MODE=ximilar  -> Ximilar card-recognition API
//   RECOGNIZE_MODE=ocr      -> OCR the name/number, fuzzy-match the catalog
//   (mock, default)         -> returns a plausible candidate so the scan flow works
//
// Input is a base64 image (data URL or raw). Output is RecognizeResult.

import type { RecognizeResult } from "./types.js";
import { db } from "./db.js";

const MODE = process.env.RECOGNIZE_MODE || "mock";

export async function recognize(imageBase64: string): Promise<RecognizeResult> {
  if (MODE === "ximilar" && process.env.XIMILAR_API_TOKEN) return recognizeXimilar(imageBase64);
  if (MODE === "ocr") return recognizeOcr(imageBase64);
  return recognizeMock();
}

// --- Ximilar: image -> {card name, set, number} -> match to catalog id --------
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
    const json: any = await res.json();
    // TODO: map Ximilar's returned name/set/number to your catalog id. Shape
    // varies by plan — inspect `json.records[0]` and match on name + number.
    const guess = json?.records?.[0]?.["_identification"]?.best_match;
    if (guess?.name) {
      const card = db.cards().find(
        (c) => c.name.toLowerCase() === String(guess.name).toLowerCase()
      );
      if (card) return { id: card.id, confidence: guess?.score ?? 0.8 };
    }
    return { id: null, confidence: 0 };
  } catch {
    return { id: null, confidence: 0 };
  }
}

// --- OCR fallback: cheap + surprisingly good for a v1 -------------------------
async function recognizeOcr(_imageBase64: string): Promise<RecognizeResult> {
  // TODO: run OCR (Google Vision / Tesseract) to read the card NAME + collector
  // NUMBER, then fuzzy-match against db.cards() on (name, num). The number is the
  // strongest signal — "161/131" is nearly unique across the catalog.
  return { id: null, confidence: 0 };
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
