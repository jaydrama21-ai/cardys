// Offline check of the recognition matcher: collector number dominates, name
// similarity tolerates OCR noise, weak evidence yields candidates but no id.
// Run: npx tsx test/recognize.match.test.ts

import assert from "node:assert";
import { matchCatalog, hintsFromOcrText } from "../src/recognize.js";
import { db } from "../src/db.js";

const umbreon = db.cards().find((c) => c.name === "Umbreon ex")!;
assert.ok(umbreon, "mock catalog has Umbreon ex");

// Full collector number + name → confident id
const full = matchCatalog({ name: "Umbreon ex", number: "161/131" });
assert.equal(full.id, umbreon.id);
assert.ok(full.confidence >= 0.9, `high confidence (${full.confidence})`);

// Number alone (the strongest single signal) → still the right card
const numOnly = matchCatalog({ number: "161/131" });
assert.equal(numOnly.id, umbreon.id, "collector number alone identifies");

// OCR-noisy name, no number → right card via token similarity
const noisy = matchCatalog({ name: "UMBREON  ex  HP210" });
assert.equal(noisy.id, umbreon.id, "noisy OCR name still matches");

// Garbage → no id, no throw
const junk = matchCatalog({ name: "zzzz qqqq" });
assert.equal(junk.id, null);
assert.deepEqual(junk.candidates, []);

// OCR text parsing: name line + collector number extraction
const hints = hintsFromOcrText("Basic\nUmbreon ex\nHP 210\nDarkness\n161/131\nIllus. Keiichiro Ito");
assert.equal(hints.number, "161/131");
assert.ok(hints.name?.includes("Umbreon"), `name extracted (${hints.name})`);
const viaOcr = matchCatalog(hints);
assert.equal(viaOcr.id, umbreon.id, "OCR text → hints → correct card");

console.log("recognize.match.test: OK — number-first matching, OCR noise tolerated, safe on junk");
