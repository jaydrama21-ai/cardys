// Condition Estimate (beta and odds modes), Gem Candidate, Weak Candidate,
// Our Accuracy, Grade Key.

import { html, raw, header, pct, DISCLAIMER, segmented } from "../ui.js";
import { settings, get, put, photoCount } from "../state.js";
import { centeringGrade, ratioLabel, candidateClass, gemChecks, GRADE_SCALES, CENTERING_LIMITS, GRADERS } from "../../shared/grading.js";
import { predict, featuresFromScan } from "../../shared/model.js";
import { OUTCOME_GRADES } from "../../shared/outcomes.js";
import { manifest, api } from "../api.js";
import { go } from "../router.js";

const HOLO = /holo|rare|ex\b|gx\b|v\b|vmax|vstar|illustration|secret|hyper|sir|ar\b/i;

/** Everything the estimate screens need, from on-device analysis + model. */
export async function computeEstimate(scan, grader = settings().grader) {
  const f = scan.analysis.front?.centering ?? null, b = scan.analysis.back?.centering ?? null;
  const cap = centeringGrade(grader, f, b);
  const counts = photoCount(scan);
  const feat = featuresFromScan({
    front: { centering: f, checks: scan.analysis.front?.checks },
    back: { centering: b, checks: scan.analysis.back?.checks },
    closeups: counts.closeups, tilt: counts.tilt, holo: HOLO.test(scan.card?.rarity || ""),
  });
  const m = await manifest();
  const odds = predict(m, grader, feat);
  // Centering can only lower a grade: drop mass above the centering cap.
  if (odds && cap && !String(cap.grade).startsWith("<")) {
    const capN = parseFloat(cap.grade);
    let moved = 0;
    for (const g of Object.keys(odds.probs)) if (parseFloat(g.replace("≤", "")) > capN && !g.startsWith("≤")) { moved += odds.probs[g]; odds.probs[g] = 0; }
    const ladder = OUTCOME_GRADES[grader];
    const capKey = ladder.find((g) => !g.startsWith("≤") && parseFloat(g) <= capN) ?? ladder.at(-1);
    odds.probs[capKey] += moved;
    const order = ladder.map((g) => [g, odds.probs[g]]).sort((a, b2) => b2[1] - a[1]);
    odds.mostLikely = order[0][0]; odds.chance = order[0][1]; odds.next = order[1]?.[0] ?? null;
  }
  const gem = odds ? gemChecks({ grader, photos: counts, front: f, back: b, flags: [] }) : null;
  const cls = candidateClass({ mostLikely: odds?.mostLikely ?? null, centeringCap: cap?.grade ?? null, threshold: settings().threshold });
  return {
    grader, cap, front: f, back: b, counts, features: feat, odds, gem, cls,
    modelVersion: m.enabled ? m.version : null,
    holo: HOLO.test(scan.card?.rarity || ""),
  };
}

const clsBadge = { strong: ["STRONG CANDIDATE", "good"], maybe: ["MAYBE", "gold"], weak: ["WEAK CANDIDATE", "muted"], unknown: ["ODDS IN TRAINING", "muted"] };

export async function estimateScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan) return go("#/scan");
  if (!scan.card) return go(`#/fix/${id}`);
  const s = settings();
  const e = await computeEstimate(scan, s.grader);
  scan.estimate = { grader: e.grader, centeringCap: e.cap?.grade ?? null, mostLikely: e.odds?.mostLikely ?? null, probs: e.odds?.probs ?? null, cls: e.cls, features: e.features, modelVersion: e.modelVersion, holo: e.holo };
  scan.status = "done";
  if (!scan.inCollection) { scan.inCollection = true; scan.savedAt = new Date().toISOString(); }
  await put("scans", scan);

  const card = scan.card;
  const centerRow = (label, c) => c
    ? html`<div class="kv"><span>${label}</span><span class="mono">${ratioLabel(c.lr)} left-right, ${ratioLabel(c.tb)} top-bottom</span></div>`
    : html`<div class="kv"><span>${label}</span><span class="mono muted">${label === "Back" ? "No back photo" : "Couldn't measure"}</span></div>`;
  const checksOk = ["front", "back"].every((side) => !scan.photos[side] || scan.analysis[side]?.checks?.ok !== false);
  const approx = CENTERING_LIMITS[e.grader].approximate;
  const graderSeg = segmented("grader", GRADERS, e.grader, "Grader scale");

  let body;
  if (!e.odds) {
    // ---- Beta: odds still training (canvas 36) ----
    body = html`
      <section class="hero">
        <p class="serif title">${card.name}</p>
        <p class="muted small">${card.set} · #${card.num} <a class="link" href="#/fix/${scan.id}">Not this card?</a></p>
      </section>
      <section class="card-box">
        <p class="h3">Grade odds are still being trained</p>
        <p class="muted small">They switch on once the model beats a simple guess on real slabs. Centering, photo checks, prices and outcomes all work now.</p>
      </section>
      ${graderSeg}
      <section class="card-box">
        <p class="eyebrow">CENTERING · ${e.grader} LIMITS${approx ? " (APPROXIMATE)" : ""}</p>
        ${centerRow("Front", e.front)}${centerRow("Back", e.back)}
        <div class="kv"><span>Best centering grade</span><span class="mono ${e.cap ? "gold" : "muted"}"><span class="tag good">MEASURED</span> ${e.cap ? e.cap.grade : "—"}</span></div>
        ${e.cap?.backUnknown ? html`<p class="muted small">Add a back photo — the back has its own limit.</p>` : ""}
        ${e.cls === "weak" ? html`<p class="small">Centering alone usually holds this card to ${e.grader} ${e.cap.grade} or lower.</p>` : ""}
      </section>
      <section class="card-box">
        <p class="eyebrow">WHAT WE CHECKED</p>
        <div class="kv"><span>Full card photos</span><span class="mono">${e.counts.full} of 2</span></div>
        <div class="kv"><span>Corner and edge close-ups</span><span class="mono">${e.counts.closeups} of 16</span></div>
        <div class="kv"><span>Tilt shots (surface)</span><span class="mono">${e.counts.tilt}</span></div>
        <div class="kv"><span>Photo checks</span><span class="mono ${checksOk ? "good" : "gold"}">${checksOk ? "All passed" : "Some issues"}</span></div>
      </section>`;
  } else if (e.gem?.gem) {
    // ---- Gem candidate (canvas 19) ----
    body = html`
      <section class="hero center">
        <p class="eyebrow gold">LIKELY GRADE · ${e.grader} SCALE</p>
        <p class="grade-num">10</p>
        <span class="tag good">GEM CANDIDATE</span>
        <p class="h3">${card.name} · ${card.num}</p>
      </section>
      ${graderSeg}
      <section class="card-box">
        <p class="eyebrow">WHY 10, NOT A RANGE</p>
        <p class="small">All ${e.counts.total} photos plus tilt shots · centering in ${e.grader} 10 limits (${ratioLabel(e.front.lr)} · ${ratioLabel(e.front.tb)}) · no corner, edge or surface flags.</p>
        <p class="muted small">Photos can't catch faint dents or lines that only show under moving light, so check it in hand before sending.</p>
      </section>`;
  } else {
    // ---- Odds (canvas 03) / Weak candidate (09) ----
    const ladder = OUTCOME_GRADES[e.grader];
    const [label, kind] = clsBadge[e.cls];
    body = html`
      <section class="hero center">
        <p class="eyebrow gold">MOST LIKELY · ${e.grader} SCALE</p>
        <p class="grade-num ${e.cls === "weak" ? "dim" : ""}">${e.odds.mostLikely}</p>
        <p class="mono muted small">${pct(e.odds.chance)} CHANCE${e.odds.next ? ` · NEXT MOST LIKELY: ${e.odds.next}` : ""}</p>
        <span class="tag ${kind}">${label}</span>
        <p class="h3">${card.name} <a class="link" href="#/fix/${scan.id}">Not this card?</a></p>
      </section>
      ${graderSeg}
      <section class="card-box" aria-label="Chance of each grade">
        <p class="eyebrow">CHANCE OF EACH GRADE</p>
        ${ladder.map((g) => html`<div class="bar-row"><span class="mono">${g}</span><span class="track"><span style="width:${Math.round(e.odds.probs[g] * 100)}%"></span></span><span class="mono">${pct(e.odds.probs[g])}</span></div>`)}
      </section>
      <section class="card-box"><div class="kv"><span>Centering</span><span class="mono">${e.front ? ratioLabel(e.front.lr) : "—"} <span class="tag good">MEASURED</span></span></div>
        ${e.cap ? html`<div class="kv"><span>Centering allows up to</span><span class="mono">${e.grader} ${e.cap.grade}</span></div>` : ""}</section>`;
  }

  return {
    html: html`<div class="screen pad">
      ${header("Condition Estimate", "#/collection")}
      ${body}
      <div class="links"><span class="muted small">${e.counts.total} photos</span><a class="link" href="#/accuracy">How accurate?</a><a class="link" href="#/gradekey">Grade key</a>${settings().under13 ? "" : html`<a class="link" href="#/feedback/estimate">Something off?</a>`}</div>
      <div class="spacer"></div>
      <p class="fine">${DISCLAIMER}</p>
      <a class="btn primary" href="#/outcomes/${scan.id}">See Outcomes If You Grade</a>
    </div>`,
    mount(el) {
      el.querySelectorAll('[data-seg="grader"]').forEach((b) => b.addEventListener("click", async () => {
        const { saveSettings } = await import("../state.js");
        saveSettings({ grader: b.dataset.v });
        go(`#/estimate/${scan.id}`);
      }));
    },
  };
}

// ---------------------------------------------------------- accuracy
export async function accuracyScreen() {
  let a = null;
  try { a = await api.accuracy(); } catch { /* offline */ }
  if (!a || !a.enough) {
    return {
      html: html`<div class="screen pad">
        ${header("Our Accuracy", "#/settings")}
        <h2 class="serif">How often we get it right</h2>
        <section class="card-box center">
          <p class="h3">Not enough results yet</p>
          <p class="mono gold">${a ? `${a.count} OF ${a.needed}` : "OFFLINE"}</p>
          <p class="muted small">We publish accuracy once ${a?.needed ?? 30} real slabs have been compared with our estimates. Until then we won't show a number.</p>
        </section>
        <a class="btn" href="#/help-train">Help Train GemReady</a>
      </div>`,
    };
  }
  const row = (label, r) => html`<div class="kv"><span>${label}</span><span class="mono">${r?.within1 == null ? "—" : pct(r.within1)} · ${r?.exact == null ? "—" : pct(r.exact)}</span></div>`;
  return {
    html: html`<div class="screen pad">
      ${header("Our Accuracy", "#/settings")}
      <h2 class="serif">How often we get it right</h2>
      <p class="muted small">From ${a.count} real slabs users added. Updated as results come in.</p>
      <section class="hero center"><p class="grade-num">${pct(a.within1)}</p><p class="muted">of our estimates were within one grade of the slab</p><p class="mono">${pct(a.exact)} EXACT MATCH</p></section>
      <section class="card-box"><p class="eyebrow">BY OUR ESTIMATE · WITHIN 1 · EXACT</p>
        ${Object.entries(a.byEstimate).map(([k, r]) => row(`Estimated ${k}`, r))}</section>
      <section class="card-box"><p class="eyebrow">ON EACH GRADER'S SCALE</p>
        ${Object.entries(a.byGrader).map(([g, r]) => r.within1 == null ? html`<div class="kv"><span>${g}</span><span class="muted small">Shown after ${r.needed ?? 30} results</span></div>` : row(g, r))}</section>
      ${a.tooHigh != null ? html`<section class="card-box"><p class="eyebrow">WHEN WE MISS</p><div class="kv"><span>We guessed too high</span><span class="mono">${pct(a.tooHigh)}</span></div><div class="kv"><span>We guessed too low</span><span class="mono">${pct(a.tooLow)}</span></div></section>` : ""}
      ${a.holo ? html`<p class="muted small">Holo and textured cards: ${pct(a.holo.within1)} within one grade. Tilt shots help most.</p>` : ""}
      <a class="btn" href="#/collection">Add Your Slab Result</a>
    </div>`,
  };
}

// ---------------------------------------------------------- grade key
export async function gradeKeyScreen() {
  let g = settings().grader;
  const view = () => html`<div class="screen pad">
    ${header("Grade Key", "#/settings")}
    <h2 class="serif">How the scales line up</h2>
    <p class="muted small">We always estimate on one company's own scale and say which. Their grade names overlap, but the grades don't.</p>
    <section class="card-box"><p class="eyebrow">SAME NAME, DIFFERENT GRADE</p><p class="small">"Gem Mint" is a PSA 10, a BGS 9.5 and a CGC 10. They sell for very different prices.</p></section>
    ${segmented("scale", GRADERS, g, "Scale")}
    <section class="card-box">${GRADE_SCALES[g].map((r) => html`<div class="kv"><span><b class="mono">${r.grade}</b> ${r.name}</span><span class="muted small">${r.note}</span></div>`)}</section>
    <section class="card-box"><p class="eyebrow">CENTERING LIMITS · FRONT / BACK${CENTERING_LIMITS[g].approximate ? " (APPROXIMATE)" : ""}</p>
      ${CENTERING_LIMITS[g].grades.map((r) => html`<div class="kv"><span class="mono">${r.grade}</span><span class="mono">${r.front}/${100 - r.front} · ${r.back}/${100 - r.back}</span></div>`)}</section>
    <p class="fine">Grade names from each company's published scale. Standards change, so check the grader's site before you submit. Not affiliated with PSA, BGS, CGC or TAG.</p>
  </div>`;
  return {
    html: view(),
    mount(el) {
      el.addEventListener("click", (e) => {
        const b = e.target.closest('[data-seg="scale"]');
        if (b) { g = b.dataset.v; el.innerHTML = String(view()); }
      });
    },
  };
}
export { raw };
