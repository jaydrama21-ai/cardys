// Offline check of the tcgcsv price overlay: stubbed groups/products/prices
// match sets by name-tail, cards by collector number (zeros stripped), and
// update raw/tier from the market price. Failures leave prices untouched.
// Run: npx tsx test/tcgcsv.test.ts

import assert from "node:assert";
import { applyTcgcsvPrices } from "../src/tcgcsvPrices.js";
import type { Card } from "../src/types.js";

const GROUPS = { results: [
  { groupId: 555, name: "ME04: Chaos Rising" },
  { groupId: 7, name: "SV08: Surging Sparks" },
  { groupId: 22873, name: "SV01: Scarlet & Violet Base Set" },
  { groupId: 604, name: "Base Set" },
  { groupId: 23237, name: "SV: Scarlet & Violet 151" },
] };
const PRODUCTS = { results: [
  { productId: 901, name: "Chespin", extendedData: [{ name: "Number", value: "087/086" }] },
  { productId: 902, name: "Cobalion ex", extendedData: [{ name: "Number", value: "099/086" }] },
] };
const PRICES = { results: [
  { productId: 901, subTypeName: "Normal", marketPrice: 5.64 },
  { productId: 901, subTypeName: "Reverse Holofoil", marketPrice: 9.1 },
  { productId: 902, subTypeName: "Holofoil", marketPrice: 42.5 },
] };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any) => {
  const u = String(url);
  if (u.endsWith("/groups")) return new Response(JSON.stringify(GROUPS), { status: 200 });
  if (u.includes("/555/products")) return new Response(JSON.stringify(PRODUCTS), { status: 200 });
  if (u.includes("/555/prices")) return new Response(JSON.stringify(PRICES), { status: 200 });
  return new Response("nope", { status: 404 });
}) as typeof fetch;

const mk = (id: string, name: string, set: string, num: string): Card => ({
  id, name, set, num, rarity: "IR", variant: "IR", tier: "D", langs: ["EN"], raw: 1, chg: 0,
});

const cards = [
  mk("me4-87", "Chespin", "Chaos Rising", "87/86"),
  mk("me4-99", "Cobalion ex", "Chaos Rising", "99/86"),
  mk("me4-1", "Unpriced", "Chaos Rising", "1/86"),
  mk("zz-1", "NoGroup", "Imaginary Set", "1/1"),
  mk("base1-4", "Charizard", "Base", "4/102"), // must hit "Base Set" (tail+' set'), never SV01
];
const res = await applyTcgcsvPrices(cards);
globalThis.fetch = realFetch;

assert.equal(res.setsMatched, 1, "one set matched");
assert.equal(res.cardsPriced, 2, "two cards priced");
assert.equal(cards[0].raw, 6, "Chespin: Normal market 5.64 → $6, zeros-stripped number match");
assert.equal(cards[1].raw, 43, "Cobalion: Holofoil fallback → $43");
assert.equal(cards[1].tier, "A", "tier recomputed from real price");
assert.equal(cards[2].raw, 1, "unpriced card keeps seed");
assert.equal(cards[3].raw, 1, "unmatched set untouched");
assert.equal(cards[4].raw, 1, "Base resolves to 'Base Set' (no stub data) — never mispriced via SV01");

// total outage → clean no-op
globalThis.fetch = (async () => { throw new Error("down"); }) as typeof fetch;
const res2 = await applyTcgcsvPrices([mk("a", "A", "B", "1/1")]);
globalThis.fetch = realFetch;
assert.deepEqual(res2, { setsMatched: 0, cardsPriced: 0 }, "outage → no-op");

console.log("tcgcsv.test: OK — market overlay matches by set+number, recomputes tiers, fails safe");
