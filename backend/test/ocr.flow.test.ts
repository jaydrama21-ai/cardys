// End-to-end OCR flow with a stubbed Google Vision response: /recognize in
// ocr mode -> Vision text -> hints -> catalog match.
// Run: npx tsx test/ocr.flow.test.ts

process.env.RECOGNIZE_MODE = "ocr";
process.env.GOOGLE_VISION_API_KEY = "stub-key";

const assert = (await import("node:assert")).default;

const VISION_TEXT = "Basic\nUmbreon ex\nHP 210\nDarkness\nQuick Attack 30\nMoonlight Blade 160\nIllus. Keiichiro Ito\n161/131\nPRISMATIC EVOLUTIONS";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url);
  if (u.includes("vision.googleapis.com")) {
    const body = JSON.parse(init.body);
    assert.ok(body.requests[0].image.content === "ZmFrZWZyYW1l", "data-url prefix stripped before sending");
    return new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text: VISION_TEXT } }] }), { status: 200 });
  }
  throw new Error("unexpected fetch: " + u);
}) as typeof fetch;

const { recognize } = await import("../src/recognize.js");
const res = await recognize("data:image/jpeg;base64,ZmFrZWZyYW1l");
globalThis.fetch = realFetch;

assert.equal(res.id, "pre-umbreon-ex-sir", `matched Umbreon (got ${res.id})`);
assert.ok(res.confidence >= 0.9, `confident (${res.confidence})`);
assert.ok(res.candidates && res.candidates.length >= 1);

// Vision failure → clean no-match, never a throw
globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
const fail = await recognize("ZmFrZWZyYW1l");
globalThis.fetch = realFetch;
assert.deepEqual({ id: fail.id, c: fail.confidence }, { id: null, c: 0 }, "500 → null result");

console.log("ocr.flow.test: OK — Vision text → Umbreon ex identified at", res.confidence.toFixed(2), "confidence; API failure degrades cleanly");
