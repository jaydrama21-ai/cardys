// Offline check of the Japanese catalog builder: stubbed JP groups/products
// map to Card entries with JP lang, art, numbers, and market prices; sealed
// (number-less) and art-less products are excluded; outage yields [].
// Run: npx tsx test/jpcatalog.test.ts

import assert from "node:assert";
import { fetchJapaneseCatalog } from "../src/tcgcsvPrices.js";

const GROUPS = { results: [{ groupId: 9001, name: "SM-P Promotional Cards", publishedOn: "2017-01-01T00:00:00" }] };
const PRODUCTS = { results: [
  { productId: 71, name: "Pikachu (Poncho o Kita Pikachu)", imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/71_in_1000x1000.jpg",
    extendedData: [{ name: "Number", value: "208/SM-P" }, { name: "Rarity", value: "Promo" }] },
  { productId: 72, name: "SM Booster Box", extendedData: [] },
  { productId: 73, name: "No Art Card", extendedData: [{ name: "Number", value: "1/SM-P" }] },
] };
const PRICES = { results: [{ productId: 71, subTypeName: "Normal", marketPrice: 449.99 }] };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any) => {
  const u = String(url);
  if (u.includes("/85/groups") || u.endsWith("/groups")) return new Response(JSON.stringify(GROUPS), { status: 200 });
  if (u.includes("/9001/products")) return new Response(JSON.stringify(PRODUCTS), { status: 200 });
  if (u.includes("/9001/prices")) return new Response(JSON.stringify(PRICES), { status: 200 });
  return new Response("x", { status: 404 });
}) as typeof fetch;

const jp = await fetchJapaneseCatalog();
globalThis.fetch = realFetch;

assert.equal(jp.sets.length, 1);
assert.equal(jp.cards.length, 1, "only number+art products become cards");
const pika = jp.cards[0];
assert.equal(pika.id, "jp-71");
assert.equal(pika.name, "Pikachu · Poncho o Kita Pikachu", "full identity kept, parens folded");
assert.equal(pika.num, "208/SM-P");
assert.deepEqual(pika.langs, ["JP"]);
assert.equal(pika.raw, 450);
assert.equal(pika.tier, "A");
assert.ok(pika.chase, "high-value JP promo flagged chase");

globalThis.fetch = (async () => { throw new Error("down"); }) as typeof fetch;
const empty = await fetchJapaneseCatalog();
globalThis.fetch = realFetch;
assert.deepEqual(empty, { cards: [], sets: [] }, "outage → empty, never throws");

console.log("jpcatalog.test: OK — JP promos become priced JP-lang cards with art; sealed/artless excluded; fails safe");
