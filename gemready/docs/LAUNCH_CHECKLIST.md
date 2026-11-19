# GemReady launch checklist

Status as of Nov 19, 2026. ✅ done in branch `claude/gemready-launch` · ⬜ to do.
"You" = needs your accounts, money, signature or a Mac. The live checklist
with owners and status is the GemReady Launch Checklist artifact.

## Built (this branch)

- ✅ Design: 38 screens, dark + light (canvas)
- ✅ Shared math with tests: centering measurement, photo checks, grader centering limits, eBay fee, net vs raw, cheapest open tier, batches, model inference
- ✅ Backend API: catalog + TCGplayer raw prices (reused from RipReport), graded prices (PriceCharting adapter), outcomes, compare, anonymous sign-in, price alerts + Web Push, anonymous slab results, accuracy stats (30-result rule), turnaround stats, PSA cert lookup, feedback, opt-in training uploads (13+, JPEG without EXIF), Delete My Data, Postgres or file store
- ✅ Web app (installable, offline shell): age check, privacy notice, photo tips, camera scan with live edge lock + close-ups + tilt, upload, retake prompts, check photos, analyze, OCR + card match, fix card, condition estimate (beta and odds modes), gem candidate, outcomes, costs, compare graders, collection + CSV import, card detail + watch, add slab result, submissions, plan a batch, accuracy, grade key, settings, delete data, feedback, help train, resume scan, offline state, helpful prompt
- ✅ Model pipeline + launch gate (odds stay off until it passes)
- ✅ SwiftUI native starter (uncompiled) + Capacitor config + privacy manifest + icons
- ✅ Draft Terms of Use and Privacy Policy, App Store kit, Render deploy blueprint
- ✅ Tests: 24 shared, 10 API, 4 model gate; end-to-end click-through of every screen (odds off, odds on, offline)

## Business & legal — start now (You)

- ⬜ Trademark search "GemReady" (USPTO classes 9 and 42) and App Store search; buy the domain
- ⬜ Form an LLC, get an EIN
- ⬜ Apple Developer Program as an organization ($99/yr; needs a D-U-N-S number, allow 1–2 weeks)
- ⬜ Lawyer review of `web/legal/terms.html` and `privacy.html` — liability cap, arbitration, under-13 handling, training-photo license
- ⬜ Fill every [bracket] in the legal pages (company, address, email, hosting provider, retention)

## Data access (You)

- ⬜ PriceCharting API subscription → `PRICECHARTING_API_TOKEN` (graded prices; without it graded rows say "No recent sales")
- ⬜ Optional: apply for eBay Marketplace Insights (real per-grade sale counts)
- ⬜ PSA Public API token → `PSA_API_TOKEN` (cert lookup)
- ⬜ Verify `shared/fees.json` on each grader's site: PSA tier names and prices (sources conflict on Regular vs Standard), BGS and CGC per-tier value limits, return shipping

## Deploy (You, ~1 hour)

- ⬜ Render → New Blueprint → `gemready/render.yaml`; set secrets; generate VAPID keys (`npx web-push generate-vapid-keys`)
- ⬜ Check `/api/health` shows `mode: live` and thousands of cards
- ⬜ Point your domain at it (HTTPS is required for the camera on phones)
- ⬜ Set the API host for the iOS build in `web/index.html`

## Real-world testing (You — most important)

- ⬜ Scan 30+ real cards (holo, full art, vintage, backs) and compare centering against a ruler or a known centering tool; send me the misses to tune
- ⬜ Measure OCR hit rate on real cards (Fix Card is the fallback)
- ⬜ Test on iPhone Safari + Add to Home Screen, and Android Chrome
- ⬜ Rotated or tilted photos: the web version expects the card roughly square to the camera (the native starter squares it up with Vision)

## iOS app (You, Mac + Xcode)

- ⬜ `npm run cap:ios`, add Info.plist camera/photo keys, privacy manifest, icon, signing (see `ios/README.md`)
- ⬜ Price alerts in the app: add `@capacitor/push-notifications` + APNs key (backend sends via APNs), or ship v1 without alerts
- ⬜ TestFlight internal, then external beta

## App Store (You)

- ⬜ Screenshots with live data (not "Sample prices")
- ⬜ Listing, privacy label answers, review notes from `docs/APP_STORE.md`
- ⬜ Submit for review

## Beta → grade odds

- ⬜ Recruit testers who grade cards; aim for 150+ slab results per grader with photos
- ⬜ Run `model/train.py` monthly; deploy the manifest when the gate passes
- ⬜ Build corner/edge/surface scoring from close-ups (a vision model). Today's model only sees centering and photo quality, so its odds mostly reflect centering

## Not built yet

- Return reminders (setting exists; needs native local notifications)
- Edge Zoom close-up review screen (needs corner/edge flags from the vision model)
- Admin dashboard for feedback and helpful answers (query the database for now)
