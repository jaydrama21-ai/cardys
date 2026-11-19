# App Store submission kit

Everything App Store Connect asks for, filled in. Replace [brackets].

## Listing

- **Name (30):** GemReady: Card Grade Check
- **Subtitle (30):** Centering & grading outcomes
- **Category:** Utilities (primary), Shopping (secondary)
- **Age rating:** 4+ (no objectionable content; answer "No" to every content question; "Unrestricted web access": No)
- **Price:** Free
- **Keywords (100):** pokemon,card,grading,psa,centering,bgs,cgc,tag,slab,gem mint,tcg,collector,pregrade,condition
  - Using grader names as keywords is common, but Apple can reject trademarked keywords. If rejected, drop psa/bgs/cgc/tag.
- **Support URL:** https://[your domain]/support
- **Marketing URL:** https://[your domain]
- **Privacy Policy URL:** https://[your domain]/legal/privacy.html (served by the backend from `web/legal/`)

### Promotional text (170)
Is it gem ready? Measure centering on your phone, check your photos for glare and blur, and see what grading would net you after fees.

### Description
Thinking about sending a card to PSA, BGS, CGC or TAG? GemReady helps you decide before you pay.

• Measure centering on your phone — front and back, on each grader's own scale.
• Photo checks catch blur, glare and bad light before they hide wear.
• Outcomes If You Grade: what you'd keep after grading fees and eBay's selling fee, compared with selling raw today, for every grade.
• Compare graders: each company's cheapest open tier for your card's value.
• Track submissions and add your slab results.
• Your photos stay on your phone. No account needed.

Grade odds are in beta: they switch on once our model beats a simple guess on real slabs. Every slab result you add helps.

GemReady gives estimates, not grades. Graders can and do differ, and prices change. Not affiliated with PSA, Beckett, CGC, TAG, eBay, TCGplayer, The Pokémon Company or Nintendo.

## Screenshots (6.7" and 6.1" required; 1290×2796 and 1179×2556)

Run `npm run e2e` with `SHOTS=…` and a real card photo; the click-through saves every screen. Suggested set:
1. Scan with brackets locked — "Is it gem ready?"
2. Condition Estimate — centering on PSA's scale
3. Outcomes If You Grade — net per grade
4. Compare Graders
5. Collection
6. Privacy — "Your photos stay on your phone"

Screenshots must show the real app UI (no mockup data you can't produce). Use live price data, not the "Sample prices" banner.

## App Privacy ("nutrition label") answers

Data collection: **Yes, we collect data.**

| Data type | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Photos or Videos | Yes (opt-in cropped card photos) | No | No | App Functionality (product improvement) |
| Other User Content (slab grades, feedback text) | Yes | No | No | App Functionality, Product Personalization: No |
| User ID (random anonymous sign-in for alerts) | Yes | Yes | No | App Functionality |
| Device ID, Location, Contact Info, Identifiers for ads | No | — | — | — |

"Used to track you": **No** for everything. No ATT prompt needed.

## Review notes (paste into "Notes for the reviewer")

> GemReady estimates trading-card condition from photos and shows what professional grading would cost and net. No login is required.
> To test: allow the camera, photograph any trading card (or upload a photo), tap "Grade now". If the card isn't recognized, search "Charizard" on the Fix Card screen.
> Grade odds are intentionally hidden in this version ("Grade odds are still being trained") until our model meets an accuracy bar; centering, photo checks and outcomes work.
> Age check on first launch limits features for users under 13 (no photo uploads, no price alerts, no identifiers).
> Account deletion: Settings → Delete My Data.

## Guideline checks

- **5.1.1(v) account deletion:** no accounts; Delete My Data removes the anonymous sign-in. ✔
- **5.1.2 data use:** privacy policy linked in-app and in metadata. ✔
- **4.2 minimum functionality:** native camera via Capacitor, offline shell, local storage — not a thin website. Keep the web build fully functional inside the app.
- **2.3.7 / trademarks:** don't put PSA/BGS logos in screenshots or the icon. ✔ (icon is original)
- **3.1.1 in-app purchase:** none in v1. If you add a paid tier later, it must use Apple IAP.
- **Kids:** not in the Kids category; the age gate only limits features.
