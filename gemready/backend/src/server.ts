// GemReady backend entry point. `npm run dev` — runs with zero keys on sample
// data; each env key turns one feed real (see .env.example).

import "dotenv/config";
import { createApp } from "./app.js";
import { makeStore, today } from "./store.js";
import { db, loadCatalog } from "./catalog/db.js";
import { loadLiveCatalog } from "./catalog/live.js";
import { applyTcgcsvPrices } from "./catalog/tcgcsv.js";
import { PRODUCTS } from "./catalog/mock.js";
import { sendPush } from "./integrations.js";

const store = makeStore();
await store.init();
const app = createApp(store);
const port = Number(process.env.PORT || 8790);

app.listen(port, () => {
  console.log(`GemReady on :${port} (mode=${process.env.DATA_MODE || "mock"}, cards=${db.cards().length})`);
});

const DAY = 24 * 60 * 60 * 1000;

async function refreshCatalog() {
  try {
    const cat = await loadLiveCatalog(Number(process.env.CATALOG_SET_LIMIT || 0));
    if (!cat.cards.length) throw new Error("no cards");
    await applyTcgcsvPrices(cat.cards);
    loadCatalog({ cards: cat.cards, sets: cat.sets, products: PRODUCTS });
    console.log(`Live catalog: ${cat.cards.length} cards.`);
    setTimeout(refreshCatalog, DAY);
  } catch (e) {
    console.error("Catalog refresh failed, retrying in 10 min:", (e as Error).message);
    setTimeout(refreshCatalog, 10 * 60 * 1000);
  }
}

/** Daily: raw price moved ±20% from when the alert was set → one push. */
export async function checkAlerts() {
  const users = new Map((await store.users()).map((u) => [u.id, u]));
  let sent = 0;
  for (const a of await store.allAlerts()) {
    const card = db.cardById(a.cardId);
    const u = users.get(a.userId);
    if (!card || !u?.push || a.lastNotifiedDay === today()) continue;
    const chg = (card.raw - a.base) / a.base;
    if (Math.abs(chg) < 0.2) continue;
    const dir = chg > 0 ? "up" : "down";
    const ok = await sendPush(u.push, {
      title: `${card.name} is ${dir} ${Math.round(Math.abs(chg) * 100)}%`,
      body: `Raw price now about $${card.raw.toLocaleString("en-US")}. Prices are estimates.`,
      url: `/#/card/${encodeURIComponent(card.id)}`,
    });
    if (ok) { await store.markNotified(a.userId, a.cardId, today()); sent++; }
  }
  if (sent) console.log(`Price alerts sent: ${sent}`);
}

if (process.env.DATA_MODE === "live") refreshCatalog();
setInterval(() => checkAlerts().catch((e) => console.error("alerts:", e)), 6 * 60 * 60 * 1000);
