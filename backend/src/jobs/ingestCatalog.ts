// Standalone catalog ingest (optional). The SERVER already loads the live catalog
// on boot in live mode (see server.ts), so you don't need to run this for the app
// to work. Use it when you move to Postgres: fetch → persist to the `cards`/`sets`
// tables (schema.sql) instead of the in-memory store.
//
// Run: `npm run ingest:catalog`  (needs POKEMONTCG_API_KEY)

import "dotenv/config";
import { loadLiveCatalog } from "../catalog.js";
import { loadCatalog } from "../db.js";
import { PRODUCTS } from "../mock.js";
import { pgAvailable, initSchema, saveCatalogToPg } from "../store/pg.js";

async function main() {
  if (!process.env.POKEMONTCG_API_KEY) {
    console.log("No POKEMONTCG_API_KEY set — fetching keyless (lower rate limits).");
  }
  const setLimit = Number(process.env.CATALOG_SET_LIMIT || 8);
  console.log(`Fetching latest ${setLimit} sets from the Pokémon TCG API…`);
  const cat = await loadLiveCatalog(setLimit);
  loadCatalog({ cards: cat.cards, sets: cat.sets, products: PRODUCTS });
  console.log(`Ingested ${cat.cards.length} cards across ${cat.sets.length} sets.`);
  if (pgAvailable()) {
    await initSchema();
    if (await saveCatalogToPg(cat.cards, cat.sets)) {
      console.log("Catalog persisted to Postgres.");
    }
  } else {
    console.log("DATABASE_URL not set — catalog held in memory only.");
  }
}

main().catch((e) => {
  console.error("ingest failed:", e);
  process.exit(1);
});
