// First launch: Age Check → Privacy → Photo Tips. Plus Help Train.

import { html, header, wordmark, icon } from "../ui.js";
import { settings, saveSettings, PRIVACY_NOTICE_VERSION } from "../state.js";
import { api } from "../api.js";
import { go } from "../router.js";

// 34 · Age Check — shown once, no default year, no hint of the cutoff.
export async function ageScreen() {
  const year = new Date().getFullYear();
  const years = [];
  for (let y = year; y >= year - 100; y--) years.push(y);
  return {
    html: html`<div class="screen pad center-col">
      <h1 class="serif big">What year were you born?</h1>
      <p class="muted">We ask everyone. It sets which features are on; we don't send your age anywhere.</p>
      <label class="label" for="by">BIRTH YEAR</label>
      <select id="by" class="field"><option value="" selected disabled>Select year</option>${years.map((y) => html`<option>${y}</option>`)}</select>
      <div class="spacer"></div>
      <button type="button" class="btn primary" id="go" disabled>Continue</button>
    </div>`,
    mount(el) {
      const sel = el.querySelector("#by"), btn = el.querySelector("#go");
      sel.onchange = () => { btn.disabled = !sel.value; };
      btn.onclick = () => {
        const by = Number(sel.value);
        // Born this year − 12 or later may still be 12 → treat as under 13.
        const under13 = year - by < 13 || (year - by === 13 && new Date().getMonth() < 11);
        saveSettings({ ageChecked: true, under13, improve: under13 ? false : settings().improve, alerts: under13 ? false : settings().alerts });
        // Only tell the server if a sign-in already exists (COPPA: no new
        // persistent identifier is ever created for under-13 users).
        if (settings().token) api.setUnder13(under13).catch(() => {});
        go("#/privacy");
      };
    },
  };
}

// 27 · Privacy (first launch)
export async function privacyScreen() {
  const s = settings();
  const bullets = (items, ok) => html`<ul class="checks">${items.map((t) => html`<li class="${ok ? "good" : "muted"}">${ok ? icon.check() : "×"} <span>${t}</span></li>`)}</ul>`;
  return {
    html: html`<div class="screen pad">
      <h1 class="serif big">Your slabs help grading get better</h1>
      <p class="muted">When you add a slab result, we learn from the real grade. It's anonymous by design: nothing we keep can be traced back to you. You choose.</p>
      ${s.under13 ? html`<p class="card-box small">Photo uploads and price alerts are off for this account.</p>` : ""}
      <p class="eyebrow">WHAT WE KEEP</p>
      ${bullets(["Cropped photos of the card itself", "The grade it got, and which grader"], true)}
      <p class="eyebrow">NEVER KEPT</p>
      ${bullets(["Your name, email or account", "Location, phone model or when the photo was taken", "Anything around the card, like your hands or room", "Cards with a signature or writing on them"], false)}
      <p class="muted small">Change this anytime in Settings → Privacy. <a class="link" href="legal/privacy.html" target="_blank" rel="noopener">Privacy policy</a></p>
      <p class="muted small">Your choice. The app works the same either way.</p>
      <div class="spacer"></div>
      ${s.under13 ? html`<button type="button" class="btn primary" data-v="off">Continue</button>`
        : html`<div class="row2"><button type="button" class="btn primary" data-v="on">Keep It On</button><button type="button" class="btn" data-v="off">Turn It Off</button></div>`}
    </div>`,
    mount(el) {
      el.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => {
        saveSettings({ privacySeen: PRIVACY_NOTICE_VERSION, improve: b.dataset.v === "on" && !settings().under13 });
        go(settings().tipsSeen ? "#/scan" : "#/tips");
      }));
    },
  };
}

// 13 · First Scan Tip
export async function tipsScreen() {
  const steps = [
    "Out of the sleeve, flat on a plain surface that contrasts with the border.",
    "Even light from above. Glare hides surface scratches.",
    "Brackets turn green when the edges lock. Shoot the full front.",
    "Add up to 8 close-ups per side, flip and repeat. Grade anytime, even with 1 photo, or upload from your camera roll.",
  ];
  return {
    html: html`<div class="screen pad">
      <header class="brand-bar">${wordmark()}<span class="mono muted small">FIRST SCAN</span></header>
      <section class="card-box gold-border">
        <h1 class="serif h2">Fill the brackets with the card.</h1>
        <ol class="steps-list">${steps.map((t, i) => html`<li><span class="mono gold">${i + 1}</span><span>${t}</span></li>`)}</ol>
      </section>
      <div class="spacer"></div>
      <p class="fine center">Grades and prices in GemReady are estimates, not certified results. Not affiliated with PSA, BGS, CGC or TAG.</p>
      <button type="button" class="btn primary" id="go">Got It</button>
    </div>`,
    mount(el) { el.querySelector("#go").onclick = () => { saveSettings({ tipsSeen: true }); go("#/scan"); }; },
  };
}

// 38 · Help Train GemReady
export async function helpTrainScreen() {
  const steps = [
    ["Scan the whole card", "Front, back, all 8 corners and edges, then a few tilt shots."],
    ["Save it to Collection", "Keeps the photos on your phone until the grade comes back."],
    ["Send it to any grader", "PSA, BGS, CGC or TAG, any tier. Log it under Submissions."],
    ["Add the slab result", "Open the card when it's back and enter the cert or grade."],
  ];
  return {
    html: html`<div class="screen pad">
      ${header("Help Train GemReady", "#/settings")}
      <h2 class="serif">Every slab you report trains grading</h2>
      <p class="muted small">Grade odds switch on once the model beats a simple guess on real slabs. 8s and 9s help as much as 10s.</p>
      <ol class="steps-list">${steps.map(([t, d], i) => html`<li><span class="mono gold">${i + 1}</span><span><b>${t}</b><br><span class="muted small">${d}</span></span></li>`)}</ol>
      <p class="muted small">Only cropped card photos and the grade are saved, with nothing that identifies you. Turn it off in Settings.</p>
      <div class="spacer"></div>
      <a class="btn primary" href="#/scan">Start Scanning</a>
    </div>`,
  };
}
