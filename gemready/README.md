# GemReady

**Is it gem ready?** Condition estimates, centering and grading outcomes for
trading cards. Design: the GemReady canvas (38 screens, dark + light).

```
gemready/
  shared/     the math, used by app + server + tests (one copy)
    analysis.js   photo checks (blur, exposure, glare) + centering measurement
    grading.js    centering limits per grader, grade scales, gem route
    outcomes.js   eBay fee, net vs raw, cheapest open tier, batches
    model.js      grade-odds features + inference (JSON logistic model)
    fees.json     grader + eBay fees, dated, with sources  ← refresh monthly
  backend/    API (Node/Express/TypeScript). Reuses RipReport's catalog + prices.
  web/        the app (installable web app; wrapped by Capacitor for iOS)
  model/      train.py + the launch gate that turns odds on; manifest.json
  ios/        Capacitor notes, privacy manifest, icon, native SwiftUI starter
  docs/       App Store kit
  scripts/    sync, icons, end-to-end click-through
```

## Run it

```bash
cd gemready/backend && npm install && cd ..
npm start            # http://localhost:8790 — app + API, sample data, zero keys
npm test             # shared math, API, model gate (Python + numpy)
```

Open http://localhost:8790 on your phone (same Wi-Fi: `http://<your-ip>:8790`)
or in a desktop browser with a phone-sized window. The camera needs HTTPS on
a phone, so for real phone testing deploy first (below) or use a tunnel.

## How it behaves at launch

- **Odds are off** until `model/train.py` passes the gate on real slab
  results: beats "guess the average" by 10%+ (mean absolute grade error) and
  lands within one grade on 75%+ of held-out cards, per grader. Until then the
  estimate screen is the beta version: measured centering on the grader's
  scale, photo checks, outcomes. The app flips on its own when the manifest's
  `enabled` turns true.
- **Photos stay on the phone.** The server only receives card IDs, OCR text,
  anonymous slab results, and (opt-in, 13+) cropped card photos.
- **Prices:** raw from TCGplayer via tcgcsv.com (free, daily). Graded prices
  need `PRICECHARTING_API_TOKEN`; without it graded rows say "No recent sales"
  in live mode. The 3-sale rule hides nets with too few sales.
- **Under 13:** no server identifier is ever created; photo uploads, price
  alerts and free-text feedback are off.

## Deploy

Render: New → Blueprint → `gemready/render.yaml` (web service + Postgres +
disk for training crops). Any Node host works: `npm run sync && cd backend &&
npm ci && npm start`, with `DATABASE_URL` set (the JSON file store is for dev).

## Train the model (when slab results come in)

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://YOUR_HOST/api/admin/slab-results > slabs.json
python3 model/train.py slabs.json        # prints the gate result, writes model/manifest.json
```

Commit the new `manifest.json` and deploy. It needs 150+ results with photo
features per grader before it will even try.

## Keep fees current

`shared/fees.json` has every tier with price, value limit, status and source.
Check each grader's site monthly, update, bump `verifiedAt`, run `npm test`.
CGC and BGS don't publish per-tier value limits we could verify; fill those
in (`maxValue`) from their submission forms.
