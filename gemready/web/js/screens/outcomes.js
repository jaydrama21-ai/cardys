// Outcomes If You Grade, Costs If You Grade, Compare Graders, offline state,
// and the "Was this helpful?" prompt.

import { html, raw, header, money, pct, timeOf, shortDate, MONEY_DISCLAIMER, sheet, toast, segmented } from "../ui.js";
import { settings, saveSettings, get, put, all } from "../state.js";
import { ebayFee, expectedNet, OUTCOME_GRADES } from "../../shared/outcomes.js";
import { api, Offline } from "../api.js";
import { go } from "../router.js";
import { computeEstimate } from "./estimate.js";

const reasonText = { NO_RECENT_SALES: "NO RECENT SALES", TOO_FEW_SALES: "TOO FEW SALES", NO_OPEN_TIER: "NO OPEN TIER" };

async function offlineView(scan) {
  const waiting = (await all("scans")).filter((s) => s.card && s.pendingPrices).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  scan.pendingPrices = true;
  await put("scans", scan);
  if (!waiting.find((w) => w.id === scan.id)) waiting.unshift(scan);
  return {
    html: html`<div class="screen pad">
      ${header("Outcomes If You Grade", `#/estimate/${scan.id}`)}
      <h2 class="serif">You're offline</h2>
      <p class="muted">We saved ${scan.card.name}. Its prices and outcomes fill in on their own when you're back online, so you can keep scanning.</p>
      <p class="eyebrow">WAITING FOR PRICES · ${waiting.length} CARD${waiting.length === 1 ? "" : "S"}</p>
      ${waiting.map((w) => html`<div class="kv"><span>${w.card.name}</span><span class="mono muted small">SCANNED ${timeOf(w.createdAt)}</span></div>`)}
      <div class="spacer"></div>
      <div class="row2"><a class="btn" href="#/collection">Go to Collection</a><button type="button" class="btn primary" id="retry">Try Again</button></div>
    </div>`,
    mount(el) { el.querySelector("#retry").onclick = () => go(`#/outcomes/${scan.id}`); },
  };
}

export async function outcomesScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan?.card) return go("#/scan");
  const s = settings();
  const grader = scan.estimate?.grader || s.grader;
  let o;
  try { o = await api.outcomes(scan.card.id, grader, { shippingIn: s.shippingIn, minNet: s.minNet }); }
  catch (e) { if (e instanceof Offline) return offlineView(scan); throw e; }
  if (scan.pendingPrices) { scan.pendingPrices = false; await put("scans", scan); }
  const est = scan.estimate?.grader === grader ? scan.estimate : await computeEstimate(scan, grader).then((x) => ({ probs: x.odds?.probs ?? null }));
  const probs = est?.probs ?? null;
  const rows = o.rows.map((r) => ({ ...r, prob: probs ? probs[r.grade] ?? 0 : null }));
  const exp = probs ? expectedNet(rows) : null;
  const priced = rows.some((r) => r.net != null);
  const v = o.verdict;
  const sampleNote = o.rawSource === "Sample data" ? html`<p class="tag gold">SAMPLE PRICES — connect live data before launch</p>` : "";

  const rowHtml = (r) => html`<div class="out-row">
    <span class="mono big">${r.grade}</span>
    <span class="mono muted small">${r.prob != null ? pct(r.prob) + " · " : ""}${r.sale != null ? "~" + money(r.sale) : ""}${r.sales ? ` · ${r.sales} sale${r.sales === 1 ? "" : "s"}` : r.sale != null && r.sales === null ? " · " + (r.source || "estimate") : ""}</span>
    ${r.net != null ? html`<span class="mono ${r.net >= 0 ? "good" : "bad"}">${money(r.net, { sign: true })}</span>` : html`<span class="mono muted small">${reasonText[r.reason] ?? "—"}</span>`}
  </div>`;

  const verdictBox = !priced
    ? html`<section class="callout"><p class="serif h3">Why no numbers?</p><p class="muted small">This card rarely sells graded on ${grader}'s scale. We only show what you would net when there are at least 3 recent sales, so we don't guess.</p></section>`
    : v.kind === "worth"
      ? html`<section class="callout"><p class="serif h3">Worth sending if it gets a ${v.worthAt} or better.</p>
          <p class="muted small">${exp != null ? `Weighted by the odds, you'd net about ${money(exp, { sign: true })}. ` : ""}Uses your minimum of ${money(s.minNet)} over selling raw. The choice is yours.</p></section>`
      : html`<section class="callout"><p class="serif h3">Not worth sending at today's prices.</p><p class="muted small">No grade clears your ${money(s.minNet)} minimum after fees. The choice is yours.</p></section>`;

  return {
    html: html`<div class="screen pad">
      ${header("Outcomes If You Grade", `#/estimate/${scan.id}`)}
      ${sampleNote}
      <section class="split">
        <div><p class="eyebrow">SELL RAW TODAY</p><p class="mono huge">${money(o.raw)}</p></div>
        <p class="muted small right">${scan.card.name}<br>${scan.card.set}</p>
      </section>
      <div class="split">
        <p class="eyebrow">${o.tier ? `${grader} ${o.tier.name.toUpperCase()} · ~${o.tier.days} DAYS` : `${grader} · NO OPEN TIER`}</p>
        <span><a class="link" href="#/costs/${scan.id}">Costs</a> <a class="link" href="#/compare/${scan.id}">Change</a></span>
      </div>
      ${o.tier?.valueLimitUnknown ? html`<p class="muted small">${grader} doesn't publish a value limit for this tier. Check before you declare a value.</p>` : ""}
      <section class="list-box">${rows.map(rowHtml)}</section>
      ${verdictBox}
      <a class="link block" href="#/compare/${scan.id}">Compare PSA, BGS, CGC and TAG</a>
      <div class="spacer"></div>
      <p class="fine"><span class="mono">PRICES UPDATED ${o.pricesUpdatedAt ? shortDate(o.pricesUpdatedAt).toUpperCase() + " " + timeOf(o.pricesUpdatedAt) : "—"} · FEES AS OF ${shortDate(o.feesAsOf).toUpperCase()}</span><br>
        Each amount is what you'd keep after grading and selling, compared with selling raw today. eBay's fee is taken out of both. Raw price: ${o.rawSource}. ${MONEY_DISCLAIMER}</p>
      <div class="row2"><button type="button" class="btn" id="keep">Keep Raw</button><a class="btn" href="#/submit/${scan.id}">Plan to Grade</a></div>
    </div>`,
    mount(el) {
      el.querySelector("#keep").onclick = async () => { scan.decision = "keep"; await put("scans", scan); go("#/collection"); };
      // Ask only when they actually leave Outcomes, not for its sub-screens.
      return () => { if (!/^#\/(costs|compare|outcomes)\//.test(location.hash)) maybeAskHelpful("outcomes"); };
    },
  };
}

/** 1st, 3rd and 10th time someone leaves Outcomes; never twice in a day. */
export async function maybeAskHelpful(screen) {
  const s = settings();
  const n = s.outcomesLeaves + 1;
  saveSettings({ outcomesLeaves: n });
  const day = new Date().toISOString().slice(0, 10);
  if (![1, 3, 10].includes(n) || s.helpfulLastDay === day) return;
  saveSettings({ helpfulLastDay: day });
  setTimeout(async () => {
    const v = await sheet(
      html`<h2 class="serif">Was this estimate helpful?</h2><p class="muted small">One tap tells us which screens to fix. Only your answer is sent.</p>`,
      [{ label: "Yes", value: "yes", primary: true }, { label: "Not really", value: "no" }, { label: "Not Now", value: "later" }]
    );
    if (v === "yes" || v === "no") { api.helpful(screen, v === "yes").catch(() => {}); toast("Thanks — that helps."); }
  }, 350);
}

// ------------------------------------------------------------ costs
export async function costsScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan?.card) return go("#/scan");
  const s = settings();
  const grader = scan.estimate?.grader || s.grader;
  let o, fees;
  try { [o, fees] = await Promise.all([api.outcomes(scan.card.id, grader, { shippingIn: s.shippingIn }), api.fees()]); }
  catch (e) { if (e instanceof Offline) return offlineView(scan); throw e; }
  const likely = o.rows.find((r) => r.grade === scan.estimate?.mostLikely && r.sale) || o.rows.find((r) => r.sale);
  const sale = likely?.sale ?? null;
  const line = (label, amt, sub, tag) => html`<div class="cost"><div><p>${label}</p><p class="muted small">${sub}</p></div><div class="right"><p class="mono">${amt}</p><span class="tag ${tag === "EXACT" || tag === "EXACT RATE" ? "good" : tag === "YOURS" ? "gold" : "muted"}">${tag}</span></div></div>`;
  return {
    html: html`<div class="screen pad">
      ${header("Costs If You Grade", `#/outcomes/${scan.id}`)}
      <p class="h3">${scan.card.name} · ${grader} ${o.tier?.name ?? ""}</p>
      <p class="muted small">Each number says how sure we are.${sale ? ` Selling fee shown at the most likely sale, ~${money(sale)}.` : ""}</p>
      ${o.tier ? line("Grading fee", money(o.tier.price, { cents: true }), `${grader} ${o.tier.name} · fees as of ${shortDate(o.feesAsOf)}`, "EXACT") : line("Grading fee", "—", "No open tier covers this card's value", "NOT INCLUDED")}
      ${line("Return shipping and insurance", o.returnShipping.amount != null ? money(o.returnShipping.amount, { cents: true }) : "At checkout", o.returnShipping.note || "", o.returnShipping.amount != null ? "ESTIMATE" : "NOT INCLUDED")}
      <div class="cost"><div><p>Your shipping to ${grader}</p><p class="muted small">You entered this</p></div>
        <div class="right"><label class="sr" for="ship">Your shipping cost</label><input id="ship" class="money-in" inputmode="decimal" value="${s.shippingIn || ""}" placeholder="$0.00"><span class="tag gold">YOURS</span></div></div>
      ${line("Total to grade", money(o.cost?.total ?? null, { cents: true }), o.cost?.complete ? "" : "Excludes costs graders set at checkout", "")}
      ${sale ? line(`eBay selling fee at ~${money(sale)}`, money(ebayFee(sale, fees.ebay), { cents: true }), `${(fees.ebay.rateUpTo * 100).toFixed(2)}% to ${money(fees.ebay.threshold)}, ${(fees.ebay.rateAbove * 100).toFixed(2)}% above, + $${fees.ebay.perOrderLarge.toFixed(2)}`, "EXACT RATE") : ""}
      ${line("Sales tax and upcharges", "—", "Can't be known in advance, so left out", "NOT INCLUDED")}
      <p class="muted small">Selling raw also costs an eBay fee (${money(o.rawEbayFee, { cents: true })} at ${money(o.raw)}), so we take it off both sides. eBay charges on shipping and tax too, so its real fee runs a little higher.</p>
      <div class="spacer"></div>
      <a class="btn" href="#/outcomes/${scan.id}">Back to Outcomes</a>
    </div>`,
    mount(el) {
      el.querySelector("#ship").addEventListener("change", (e) => {
        const v = Math.max(0, Math.min(500, parseFloat(String(e.target.value).replace(/[^\d.]/g, "")) || 0));
        saveSettings({ shippingIn: v });
        go(`#/costs/${scan.id}`);
      });
    },
  };
}

// ---------------------------------------------------------- compare
export async function compareScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan?.card) return go("#/scan");
  const s = settings();
  let c;
  try { c = await api.compare(scan.card.id, { shippingIn: s.shippingIn, minNet: s.minNet }); }
  catch (e) { if (e instanceof Offline) return offlineView(scan); throw e; }
  const ests = {};
  for (const g of ["PSA", "BGS", "CGC", "TAG"]) ests[g] = await computeEstimate(scan, g);
  const cards = c.graders.map((g) => {
    const e = ests[g.grader];
    const ml = e.odds ? `${e.odds.mostLikely} · ${pct(e.odds.chance)}` : e.cap ? `up to ${e.cap.grade}` : "—";
    const at = e.odds ? g.rows.find((r) => r.grade === e.odds.mostLikely) : null;
    return html`<button type="button" class="grader ${g.grader === (scan.estimate?.grader || s.grader) ? "on" : ""}" data-g="${g.grader}">
      <span class="split"><b>${g.grader}</b><span class="mono muted small">${g.tier ? `${g.tier.name.toUpperCase()} · ~${g.tier.days} DAYS · ${money(g.tier.price, { cents: true })}` : "NO OPEN TIER"}</span></span>
      <span class="grid3"><span><span class="eyebrow">${e.odds ? "MOST LIKELY" : "CENTERING ALLOWS"}</span><span class="mono">${ml}</span></span>
        <span><span class="eyebrow">NET AT THAT</span><span class="mono ${at?.net >= 0 ? "good" : at?.net < 0 ? "bad" : "muted"}">${at?.net != null ? money(at.net, { sign: true }) : "—"}</span></span>
        <span><span class="eyebrow">WORTH IT AT</span><span class="mono">${g.worthAt ? g.worthAt + "+" : g.rows.some((r) => r.net != null) ? "never" : "—"}</span></span></span>
    </button>`;
  });
  const paused = Object.entries(c.status).flatMap(([g, tiers]) => tiers.filter((t) => t.status === "paused").map((t) => `${g} ${t.name}`));
  return {
    html: html`<div class="screen pad">
      ${header("Compare Graders", `#/outcomes/${scan.id}`)}
      <p class="h3">${scan.card.name} on each grader's scale</p>
      <p class="muted small">Each company grades differently, so the most likely grade changes too. Each grader's cheapest open tier that covers this card's value. Nets include fees, vs selling raw at ${money(scan.card.raw)} with eBay's fee off both sides.</p>
      ${cards}
      <p class="fine">Fees as of ${shortDate(c.feesAsOf)}.${paused.length ? ` Paused right now: ${paused.join(", ")}.` : ""} Fees exclude return shipping graders set at checkout.</p>
      <a class="link block" href="#/gradekey">How the grade scales line up</a>
    </div>`,
    mount(el) {
      el.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", async () => {
        const g = b.dataset.g;
        saveSettings({ grader: g });
        scan.estimate = { ...(scan.estimate || {}), grader: g, probs: ests[g].odds?.probs ?? null, mostLikely: ests[g].odds?.mostLikely ?? null, centeringCap: ests[g].cap?.grade ?? null };
        await put("scans", scan);
        go(`#/outcomes/${scan.id}`);
      }));
    },
  };
}
export { raw, segmented, OUTCOME_GRADES };
