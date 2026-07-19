# Claude Code handoff — flip RipReport's data layer from mock to live

You are working in the RipReport repo. The mobile app (`RipReport.dc.html`, plus the deployed PWA in `deploy/`) reads all catalog, pricing and scan data through one seam: `backend/client/RipDataClient.js`, backed by the Node/TypeScript service in `backend/`. It already runs on mock data with zero keys and returns everything in the live shape. Your job is to flip each feed mock→real without changing any app screen — the seam stays identical.

Read first so you match the contract exactly:

- `backend/README.md` — 4-step bring-up + file map
- `backend/src/types.ts` — entity schema + pricing constants (don't change shapes)
- `backend/src/server.ts` — HTTP surface (keep every route + response shape)
- `design_handoff_data_layer/` — the interface contract the app expects

There's a real portfolio export at `uploads/ShinyExport-*.csv` (63 rows). Every single carries a real `tcgplayer_id` and `pricecharting_id`, and every row a real current `value_per_unit`. Use it as (a) seed/fixture data and (b) the ID map your pricing job polls. The same IDs are already on the app's catalog cards as `tcgId`/`pcId`.

Do these in order — one feed at a time, verify each before the next.

1. **Catalog (real cards + images)** — `backend/src/catalog.ts` already fetches latest sets from the free Pokémon TCG API and maps `images.large`→`card.img`. Set `DATA_MODE=live` + `POKEMONTCG_API_KEY`, confirm `server.ts` swaps the live catalog in on boot, persist to Postgres (`schema.sql`) instead of the in-memory `db.ts`. Accept: `curl "$BASE/search?q=umbreon"` returns real cards with images.

2. **Pricing (real comps + freshness)** — implement the four `live*` adapters in `pricing.ts` (read cached comps from DB, never throw, fall back to modelled). Build `jobs/refreshPrices.ts` as a nightly cron writing a price-cache row per `(cardId, kind, grade, lang)` with `source`, `n`, `lastSoldAt`, `price` — that powers the app's provenance UI. Keep RAW and each graded pool separate. Source cheapest-first: PriceCharting (keyed by `pricecharting_id`), then eBay sold/TCGplayer with partner access. Smoke-test against the CSV's `value_per_unit`.

3. **Recognition (photo→id)** — finish `recognize.ts`: `RECOGNIZE_MODE=ximilar` (map best-match name/set/number to catalog id) or `=ocr` (OCR name + collector number, fuzzy-match — the number is nearly unique). Return `{id,confidence,candidates[]}` as today.

4. **Accounts/sync (last)** — auth + move holdings from the app's `localStorage` into `users`/`holdings` tables (stub in `schema.sql`) so collections follow the user across devices.

**Wiring the app:** point the client at the deployed origin via `window.__RIPREPORT_API__` (see `connectBackend()` in `RipReport.dc.html`). CORS is already open. The app is fallback-safe — paints modelled value first, upgrades on the next render once `/price` returns; don't block the UI.

**Rules:** never change seam function names/routes/shapes; every `live*` path falls back and never throws; check each provider's ToS before shipping publicly; commit per feed with a green `curl` smoke test.
