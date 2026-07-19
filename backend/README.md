# RipReport backend

The service behind the app's **`RipDataService`** seam. It turns the prototype's
sample data into live catalog + pricing + scan recognition, without touching any
screen — every screen already reads through the seam.

It **runs with zero keys**, serving mock data in the exact live shape. Each env
key you add flips one feed from mock → real.

```bash
cd backend
cp .env.example .env
npm install
npm run dev          # → http://localhost:8787  (mode=mock)
curl localhost:8787/health
curl "localhost:8787/search?q=umbreon&lang=EN"
```

## The three feeds

| Feed | Endpoint(s) | Source to wire | Where |
|------|-------------|----------------|-------|
| **Catalog** | `/cards` `/sets` `/products` `/search` | Pokémon TCG API (free) | `src/jobs/ingestCatalog.ts` |
| **Pricing** | `/price/raw/:id` `/price/graded/:id` `/price/history/:id` | PriceCharting / TCGplayer / eBay sold | `src/pricing.ts` + `src/jobs/refreshPrices.ts` |
| **Recognition** | `POST /recognize` | Ximilar, or OCR + catalog match | `src/recognize.ts` |

## How it plugs into the app

The client half is `client/RipDataClient.js`. In `RipReport.dc.html`:

1. `constructor`: `this.rip = new RipDataClient('https://your-backend')`
2. `componentDidMount`: `await this.rip.bootstrap(); this.forceUpdate()` (preloads the catalog once so the app's **synchronous** seam keeps working)
3. Replace the **DATA SEAM** method bodies (marked in the app) to delegate to `this.rip` — `cardById`, `priceRaw`, `priceGraded`, `gradedAbs`, `histFor`, and the search screen's `searchCards`.
4. Swap the scan's simulated pick for `await this.rip.recognize(base64Frame)`.

Pricing is cache-first with a modelled fallback: the UI never blocks — a card shows the modelled price on first paint, then the real comp on the next render once `/price` returns.

## Bring-up order (matches the 4-week plan)

1. **Catalog** — set `POKEMONTCG_API_KEY`, flesh out `ingestCatalog.ts`, persist to Postgres (`src/schema.sql`). Real cards + search live.
2. **Pricing** — set `PRICECHARTING_API_TOKEN` (or eBay/TCGplayer), implement the adapter in `refreshPrices.ts`, run it on a nightly cron. Real comps + freshness dots.
3. **Recognition** — set `XIMILAR_API_TOKEN` (or `RECOGNIZE_MODE=ocr`), finish the mapping in `recognize.ts`. Real scanning.
4. **Accounts/sync** — add auth + move holdings from device `localStorage` into the `users`/`holdings` tables so a collection follows the user across devices.

## Files

```
backend/
  src/
    server.ts            HTTP surface (the seam over HTTP)
    types.ts             entity schema + pricing constants
    db.ts                in-memory catalog store (swap for Postgres)
    mock.ts              sample data in the live shape (zero-key run)
    pricing.ts           pricing engine (mock math ↔ live comps)
    recognize.ts         photo → card id (ximilar | ocr | mock)
    schema.sql           Postgres schema (catalog + price cache + holdings)
    jobs/
      ingestCatalog.ts   Pokémon TCG API → catalog
      refreshPrices.ts   nightly sold-comp refresh
  client/
    RipDataClient.js     browser seam impl (drop into the app)
  .env.example
```

## Deploy

Any Node host — Vercel, Railway, Render, Fly, a container. Add Postgres (Supabase/
Neon) when you move off the in-memory store. Schedule `refresh:prices` as a cron.
Set the app's `RipDataClient` base URL to the deployed origin (enable CORS — it's
already `app.use(cors())`).

## Legal / ToS note

Pricing and recognition sources have terms — TCGplayer/eBay need partner/app
approval, PriceCharting and Ximilar are paid. Check each provider's ToS for
caching + redistribution limits before shipping publicly.
