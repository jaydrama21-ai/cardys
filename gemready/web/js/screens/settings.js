// Settings, Delete My Data, Send Feedback.

import { html, raw, header, tabs, icon, segmented, money, toast, sheet } from "../ui.js";
import { settings, saveSettings, wipeEverything } from "../state.js";
import { GRADERS } from "../../shared/grading.js";
import { api, VERSION, Offline, config } from "../api.js";
import { enablePush, disablePush } from "../push.js";
import { applyTheme } from "../theme.js";
import { go } from "../router.js";

const sw = (id, on, labelId, disabled = false) =>
  html`<button type="button" role="switch" class="switch" id="${id}" aria-checked="${on ? "true" : "false"}" aria-labelledby="${labelId}" ${disabled ? raw("disabled") : ""}><span></span></button>`;
const navRow = (href, label, cls = "") => html`<a class="nav-row ${cls}" href="${href}"><span>${label}</span>${icon.chevron()}</a>`;

export async function settingsScreen() {
  const s = settings();
  const cfg = await config();
  return {
    html: html`<div class="screen pad tabbed">
      <h1 class="serif big">Settings</h1>
      <p class="eyebrow">PREFERRED GRADER</p>${segmented("grader", GRADERS, s.grader, "Preferred grader")}
      <p class="eyebrow">WHEN TO SUGGEST GRADING</p>
      <div class="list-box">
        <div class="kv"><label for="th">Grade threshold</label><select id="th" class="inline">${["10", "9.5", "9", "8.5", "8"].map((g) => html`<option ${g === s.threshold ? raw("selected") : ""}>${g}</option>`)}</select></div>
        <div class="kv"><label for="mn">Minimum net vs raw</label><input id="mn" class="money-in" inputmode="decimal" value="${s.minNet}"></div>
      </div>
      <p class="muted small">"Worth sending" on Outcomes uses both of these.</p>
      <p class="eyebrow">ACCURACY &amp; HELP</p>
      <div class="list-box">${navRow("#/accuracy", "How accurate are we?")}${navRow("#/gradekey", "Grade key")}${navRow("#/tips", "Photo tips")}${navRow("#/help-train", "Help train GemReady")}</div>
      <p class="eyebrow">CARD MATCHING</p>
      <div class="card-box small"><b>Recognized on your phone</b><br><span class="muted">We read the name and number printed on the card. No account or API key needed.</span></div>
      <p class="eyebrow">WATCHLIST</p>
      <div class="kv card-box"><span><span id="al">Price alerts</span><br><span class="muted small">${s.under13 ? "Off for this account" : "Notify when a starred card moves ±20%"}</span></span>${sw("alerts", s.alerts && !s.under13, "al", s.under13)}</div>
      <p class="eyebrow">PRIVACY</p>
      <div class="kv card-box"><span><span id="il">Improve grading with my card photos</span><br><span class="muted small">${s.under13 ? "Off for this account" : "Anonymous. Cropped card and grade only, never your name, account or location."}</span></span>${sw("improve", s.improve && !s.under13, "il", s.under13)}</div>
      <div class="list-box">${navRow("#/delete", "Delete My Data", "danger")}</div>
      <p class="eyebrow">APPEARANCE</p>${segmented("appearance", [{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }], s.appearance, "Appearance")}
      ${(s.beta || cfg.sampleData) && !s.under13 ? html`<p class="eyebrow">BETA</p><div class="list-box">${navRow("#/feedback/settings", "Send Feedback")}</div>` : ""}
      <p class="eyebrow">ABOUT</p>
      <div class="list-box">
        <div class="kv"><span>GemReady ${VERSION}</span><span class="mono muted small">${cfg.modelEnabled ? `MODEL ${cfg.modelVersion}` : "ODDS IN TRAINING"}</span></div>
        ${navRow("legal/privacy.html", "Privacy Policy")}${navRow("legal/terms.html", "Terms of Use")}${navRow("legal/licenses.html", "Open-Source Licenses")}
      </div>
      <p class="fine">Estimates, not grades. Not affiliated with PSA, Beckett, CGC, TAG, The Pokémon Company or Nintendo.</p>
      ${tabs("settings")}
    </div>`,
    mount(el) {
      el.addEventListener("click", async (e) => {
        const seg = e.target.closest("[data-seg]");
        if (seg?.dataset.seg === "grader") saveSettings({ grader: seg.dataset.v });
        if (seg?.dataset.seg === "appearance") { saveSettings({ appearance: seg.dataset.v }); applyTheme(); }
        if (seg) { el.querySelectorAll(`[data-seg="${seg.dataset.seg}"]`).forEach((b) => b.setAttribute("aria-pressed", b === seg ? "true" : "false")); return; }
        const sw = e.target.closest('[role="switch"]');
        if (!sw || sw.disabled) return;
        const on = sw.getAttribute("aria-checked") !== "true";
        sw.setAttribute("aria-checked", on ? "true" : "false");
        if (sw.id === "improve") saveSettings({ improve: on });
        if (sw.id === "alerts") { saveSettings({ alerts: on }); if (on) enablePush(); else disablePush(); }
      });
      el.querySelector("#th").onchange = (e) => saveSettings({ threshold: e.target.value });
      el.querySelector("#mn").onchange = (e) => {
        const v = Math.max(0, parseFloat(String(e.target.value).replace(/[^\d.]/g, "")) || 0);
        saveSettings({ minNet: v });
        e.target.value = v;
        toast(`Minimum set to ${money(v)}`);
      };
    },
  };
}

// 35 · Delete My Data
export async function deleteScreen() {
  return {
    html: html`<div class="screen pad">
      ${header("Delete My Data", "#/settings")}
      <p class="eyebrow">DELETED RIGHT AWAY</p>
      <ul class="checks"><li>${icon.check()} <span>Your anonymous sign-in and price alerts on our servers</span></li>
        <li>${icon.check()} <span>Your collection, card photos, submissions and settings on this phone</span></li></ul>
      <p class="eyebrow">CAN'T BE DELETED</p>
      <p class="muted small">Slab results, training photos and usage stats you already sent were saved without anything linking them to you, so we can't find them to delete them.</p>
      <p class="small">This can't be undone. The app starts over as if it were just installed.</p>
      <div class="spacer"></div>
      <button type="button" class="btn primary danger-fill" id="del">Delete My Data</button>
      <a class="btn" href="#/settings">Cancel</a>
    </div>`,
    mount(el) {
      el.querySelector("#del").onclick = async () => {
        const v = await sheet(html`<h2 class="serif">Delete everything?</h2><p class="muted small">Your collection and photos on this phone are erased.</p>`, [{ label: "Delete", value: "yes", primary: true }, { label: "Cancel", value: "no" }]);
        if (v !== "yes") return;
        if (settings().token) {
          try { await api.deleteMe(); }
          catch (e) { if (e instanceof Offline) return toast("You're offline. Connect so we can delete your sign-in too."); }
        }
        await disablePush();
        await wipeEverything();
        try { sessionStorage.clear(); } catch { /* ignore */ }
        go("#/age");
        location.reload();
      };
    },
  };
}

// 37 · Send Feedback
export async function feedbackScreen({ from = "app" } = {}) {
  let kind = "bug";
  const kinds = [{ value: "bug", label: "Bug" }, { value: "idea", label: "Idea" }, { value: "wrong-grade", label: "Wrong grade" }, { value: "wrong-card", label: "Wrong card" }, { value: "other", label: "Other" }];
  return {
    html: html`<div class="screen pad">
      ${header("Send Feedback", "#/settings", html`<span class="tag gold">BETA</span>`)}
      <h2 class="serif">Thanks for testing GemReady</h2>
      <p class="eyebrow">WHAT KIND?</p><div class="wrap-seg">${segmented("kind", kinds, kind, "Feedback type")}</div>
      <label class="label" for="t">TELL US WHAT HAPPENED</label>
      <textarea id="t" class="field" rows="6" maxlength="2000" placeholder="The centering said 60/40 but the card looks centered to me…"></textarea>
      <p class="muted small">Sent anonymously with the app version (${VERSION}) and the screen you came from. Please don't include your name, email or anything personal.</p>
      <div class="spacer"></div>
      <button type="button" class="btn primary" id="send">Send Feedback</button>
    </div>`,
    mount(el) {
      el.addEventListener("click", (e) => {
        const b = e.target.closest('[data-seg="kind"]');
        if (b) { kind = b.dataset.v; el.querySelectorAll('[data-seg="kind"]').forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); }
      });
      el.querySelector("#send").onclick = async () => {
        const text = el.querySelector("#t").value.trim();
        if (!text) return toast("Tell us what happened first.");
        try { await api.feedback({ kind, text, screen: from }); toast("Sent. Thank you."); history.back(); }
        catch (e) { toast(e instanceof Offline ? "You're offline. Try again when you're back online." : e.message); }
      };
    },
  };
}
