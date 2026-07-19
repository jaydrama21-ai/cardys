// Offline check of the live-catalog mapping: stubs the Pokémon TCG API with a
// real-shaped fixture and asserts cards come out with images + valid schema.
// Run: npx tsx test/catalog.map.test.ts

import assert from "node:assert";
import { loadLiveCatalog } from "../src/catalog.js";

const FIXTURE_SETS = {
  data: [
    { id: "sv8pt5", ptcgoCode: "PRE", name: "Prismatic Evolutions", releaseDate: "2025/01/17", printedTotal: 131 },
  ],
};

const FIXTURE_CARDS = {
  data: [
    {
      id: "sv8pt5-161",
      name: "Umbreon ex",
      number: "161",
      rarity: "Special Illustration Rare",
      set: { id: "sv8pt5", name: "Prismatic Evolutions", printedTotal: 131 },
      images: {
        small: "https://images.pokemontcg.io/sv8pt5/161.png",
        large: "https://images.pokemontcg.io/sv8pt5/161_hires.png",
      },
      tcgplayer: { prices: { holofoil: { market: 1348.55 } } },
    },
    {
      id: "sv8pt5-1",
      name: "Exeggcute",
      number: "1",
      rarity: "Common",
      set: { id: "sv8pt5", name: "Prismatic Evolutions", printedTotal: 131 },
      images: { small: "https://images.pokemontcg.io/sv8pt5/1.png" },
    },
  ],
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any) => {
  const u = String(url);
  const body = u.includes("/sets") ? FIXTURE_SETS : FIXTURE_CARDS;
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const cat = await loadLiveCatalog(1);
globalThis.fetch = realFetch;

assert.equal(cat.sets.length, 1);
assert.equal(cat.sets[0].code, "PRE");
assert.equal(cat.cards.length, 2);

const umbreon = cat.cards[0];
assert.equal(umbreon.id, "sv8pt5-161");
assert.equal(umbreon.img, "https://images.pokemontcg.io/sv8pt5/161_hires.png", "maps images.large → img");
assert.equal(umbreon.num, "161/131");
assert.equal(umbreon.raw, 1349, "seeds raw from tcgplayer market");
assert.equal(umbreon.tier, "A");
assert.equal(umbreon.chase, true);

const commonCard = cat.cards[1];
assert.equal(commonCard.img, "https://images.pokemontcg.io/sv8pt5/1.png", "falls back to images.small");
assert.equal(commonCard.raw, 1, "no price data seeds $1");
assert.equal(commonCard.tier, "D");

console.log("catalog.map.test: OK — live mapping produces cards with images in the app schema");
