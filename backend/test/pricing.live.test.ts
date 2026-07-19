// Offline check of live pricing: seeds the comp cache the way the refresh job
// does (PriceCharting payload → comp rows, values from the real ShinyExport
// CSV), then asserts the live adapters serve cached comps and fall back to the
// modelled math when no comp exists.
// Run: npx tsx test/pricing.live.test.ts

process.env.DATA_MODE = "live"; // must be set before pricing.ts binds it

const assert = (await import("node:assert")).default;
const { priceRaw, priceGraded, gradedAbs, histFor } = await import("../src/pricing.js");
const { setComp, setHistorySeries, compMeta } = await import("../src/priceCache.js");
const { compRowsFromPriceCharting, matchCatalogCard } = await import("../src/jobs/refreshPrices.js");
const { loadShinyRows, shinyPricingTargets } = await import("../src/shiny.js");

// --- the CSV loads and carries the ID map -----------------------------------
const rows = loadShinyRows();
assert.ok(rows.length >= 60, `CSV loads (got ${rows.length} rows)`);
const targets = shinyPricingTargets();
assert.ok(targets.length >= 50, `singles carry pricecharting_id (got ${targets.length})`);
assert.ok(targets.every((t) => t.pcId && !t.sealed));

// --- PriceCharting payload → comp rows (values in cents) ---------------------
const ampharos = targets.find((t) => t.name === "Ampharos")!;
const card = { id: "cr-ampharos-ir", name: "Ampharos", set: "Chaos Rising", num: "212/159", rarity: "IR", variant: "Illustration Rare", tier: "C" as const, langs: ["EN" as const], raw: 5, chg: 0 };
assert.equal(matchCatalogCard(ampharos, [card]), card, "shiny row matches catalog card by name");

const payload = {
  "loose-price": Math.round(ampharos.valuePerUnit * 100), // 8.68 → 868¢
  "manual-only-price": 12300,                              // PSA 10 $123
  "graded-price": 3400,                                    // grade 9 $34
  "sales-volume": 17,
};
const comps = compRowsFromPriceCharting(card.id, payload);
assert.deepEqual(
  comps.map((r) => [r.kind, r.value]),
  [["raw", 9], ["psa9", 34], ["psa10", 123]],
  "cents→USD and field→kind mapping"
);
comps.forEach(setComp);

// --- live adapters read the cache --------------------------------------------
assert.equal(priceRaw(card, "EN"), 9, "raw comes from cached comp, not card.raw");
assert.equal(priceRaw(card, "JP"), Math.round(9 * 0.9), "language multiplier applies");
assert.equal(gradedAbs(card, 10), 123, "PSA 10 exact comp");
assert.equal(gradedAbs(card, 9), 34, "PSA 9 exact comp");
assert.equal(gradedAbs(card, 9.5), Math.round(123 * (3.4 / 5)), "9.5 scales from real PSA 10");
assert.equal(priceGraded(card, "PSA", 10, "EN"), 123);
assert.equal(priceGraded(card, "BGS", 10, "EN"), Math.round(123 * 1.15), "no BGS comp → factor model");

const meta = compMeta(card.id, "raw");
assert.ok(meta && meta.source === "PriceCharting" && meta.comps === 17, "provenance meta");

// --- history: real series when stored, modelled otherwise --------------------
setHistorySeries(card.id, "raw", [5, 6, 7, 8, 9]);
assert.deepEqual(histFor(9, 0, card), [5, 6, 7, 8, 9], "real stored series served");
const modelled = histFor(100, 10, { ...card, id: "no-history" });
assert.equal(modelled.length, 14);
assert.equal(modelled[modelled.length - 1], 100, "modelled fallback ends at current");

// --- no comp at all → modelled fallback, never throws ------------------------
const unknown = { ...card, id: "unknown-card", raw: 50, psa10: undefined };
assert.equal(priceRaw(unknown, "EN"), 50, "falls back to seeded raw");
assert.equal(gradedAbs(unknown, 10), 250, "falls back to raw × GRADE_BASE");

console.log("pricing.live.test: OK — cached comps served, modelled fallback intact, CSV id map loads");
