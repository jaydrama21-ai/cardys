// Collection, Card Detail, Add Slab Result, Submissions, Log a Submission,
// Plan a Submission, CSV import.

import { html, raw, esc, header, tabs, money, pct, shortDate, icon, toast, sheet, segmented } from "../ui.js";
import { settings, get, put, all, del, uid, photoCount } from "../state.js";
import { photoUrl, cardCrop } from "../capture.js";
import { planBatches, pickTier } from "../../shared/outcomes.js";
import { GRADERS } from "../../shared/grading.js";
import { api, Offline, manifest } from "../api.js";
import { go } from "../router.js";
import { enablePush } from "../push.js";

const CLS = { strong: ["STRONG", "good"], maybe: ["MAYBE", "gold"], weak: ["WEAK", "muted"], unknown: ["—", "muted"] };

export async function collectionScreen({ filter = "all" } = {}) {
  const scans = (await all("scans")).filter((s) => s.inCollection && s.card).sort((a, b) => (b.savedAt || b.createdAt).localeCompare(a.savedAt || a.createdAt));
  if (!scans.length) {
    return {
      html: html`<div class="screen pad tabbed">
        <h1 class="serif big">Collection</h1>
        <section class="empty">
          <div class="empty-art" aria-hidden="true"><i></i><i>${icon.plus()}</i></div>
          <p class="serif h2">No cards yet. Scan your first.</p>
          <p class="muted small">Every scan saves here with its estimate and live value.</p>
          <a class="btn primary" href="#/scan">Scan Card</a>
          <label class="link"><input type="file" accept=".csv,text/csv" id="csv" hidden>Import CSV</label>
          <span class="mono muted small">NAME, NUMBER, PAID</span>
        </section>
        ${tabs("collection")}
      </div>`,
      mount: bindCsv,
    };
  }
  const urls = {};
  for (const s of scans) if (s.photos.front && !s.card.img) urls[s.id] = await photoUrl(s.photos.front);
  const paid = scans.reduce((a, s) => a + (s.paid || 0), 0);
  const rawTotal = scans.reduce((a, s) => a + (s.card.raw || 0), 0);
  const strong = scans.filter((s) => s.estimate?.cls === "strong").length;
  const oddsOn = scans.some((s) => s.estimate?.mostLikely != null);
  const subs = await all("submissions");
  const atGrader = subs.filter((x) => !x.returnedOn).length;
  const shown = filter === "all" ? scans : scans.filter((s) => (s.estimate?.cls || "unknown") === filter);
  return {
    html: html`<div class="screen pad tabbed">
      <h1 class="serif big">Collection</h1>
      <section class="summary">
        <div><span class="eyebrow">RAW VALUE</span><span class="mono">${money(rawTotal)}</span></div>
        <div><span class="eyebrow">PAID</span><span class="mono">${paid ? money(paid) : "—"}</span></div>
        ${oddsOn ? html`<div><span class="eyebrow">STRONG</span><span class="mono good">${strong} of ${scans.length}</span></div>`
          : html`<div><span class="eyebrow">AT GRADERS</span><span class="mono">${atGrader}</span></div>`}
      </section>
      ${segmented("filter", [{ value: "all", label: "All" }, { value: "strong", label: "Strong" }, { value: "maybe", label: "Maybe" }, { value: "weak", label: "Weak" }], filter, "Filter by candidate")}
      <div class="split"><span class="eyebrow">${shown.length} CARD${shown.length === 1 ? "" : "S"} · NEWEST FIRST</span>
        <span><a class="link" href="#/submissions">Submissions${atGrader ? ` · ${atGrader}` : ""}</a> <label class="link"><input type="file" accept=".csv,text/csv" id="csv" hidden>Import CSV</label></span></div>
      <ul class="cards">${shown.map((s) => {
        const [label, kind] = CLS[s.estimate?.cls || "unknown"];
        const img = s.card.img || urls[s.id];
        return html`<li><a href="#/card/${s.id}" class="card-row">
          ${img ? html`<img class="mini" src="${img}" alt="" loading="lazy">` : html`<span class="mini"></span>`}
          <span class="grow"><b>${s.card.name} · ${s.card.num}</b>
            <span class="mono muted small">${s.estimate?.mostLikely ? `MOST LIKELY ${s.estimate.grader} ${s.estimate.mostLikely}` : s.estimate?.centeringCap ? `CENTERING ≤ ${s.estimate.grader} ${s.estimate.centeringCap}` : "NOT GRADED YET"} · ${shortDate(s.savedAt || s.createdAt).toUpperCase()}</span>
            <span class="mono muted small">${s.paid ? `PAID ${money(s.paid, { cents: s.paid < 10 })} RAW` : ""}</span></span>
          <span class="right"><span class="mono">${money(s.card.raw)}</span><span class="mono small ${kind}">${label}</span></span>
        </a></li>`;
      })}</ul>
      <div class="spacer"></div>
      <a class="btn primary" href="#/scan">Scan Card</a>
      ${tabs("collection")}
    </div>`,
    mount(el) {
      el.querySelectorAll('[data-seg="filter"]').forEach((b) => b.addEventListener("click", async () => {
        const v = await collectionScreen({ filter: b.dataset.v });
        el.innerHTML = String(v.html); v.mount?.(el);
      }));
      bindCsv(el);
      return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    },
  };
}

/** CSV with name, number, paid columns (Shiny / TCGplayer / spreadsheet). */
function bindCsv(el) {
  el.querySelector("#csv")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const head = lines.shift().toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));
    const col = (...names) => head.findIndex((h) => names.some((n) => h.includes(n)));
    const iName = col("name", "product"), iNum = col("number", "num", "#"), iPaid = col("paid", "price paid", "cost");
    if (iName < 0) return toast("Couldn't find a name column.");
    let added = 0;
    for (const line of lines.slice(0, 500)) {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim());
      try {
        const m = await api.match({ name: cells[iName], number: iNum >= 0 ? cells[iNum] : undefined });
        const c = m.candidates[0];
        if (!c || m.confidence < 0.45) continue;
        const { newScan } = await import("../state.js");
        const s = newScan();
        Object.assign(s, { status: "done", inCollection: true, savedAt: new Date().toISOString(), card: { id: c.id, name: c.name, set: c.set, num: c.num, img: c.img ?? null, raw: c.raw, rarity: c.rarity }, paid: iPaid >= 0 ? parseFloat(cells[iPaid].replace(/[^\d.]/g, "")) || null : null, imported: true });
        await put("scans", s);
        added++;
      } catch (err) { if (err instanceof Offline) { toast("You're offline. Import needs a connection."); break; } }
    }
    toast(`Imported ${added} card${added === 1 ? "" : "s"}.`);
    go("#/collection");
  });
}

// ------------------------------------------------------------ card detail
export async function cardScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan?.card) return go("#/collection");
  const s = settings();
  const img = scan.card.img || (scan.photos.front ? await photoUrl(scan.photos.front) : null);
  const subs = (await all("submissions")).filter((x) => x.scanId === scan.id);
  const e = scan.estimate;
  const watching = !!scan.watching;
  return {
    html: html`<div class="screen pad">
      ${header("Collection", "#/collection", html`<button type="button" class="icon-btn" id="watch" aria-pressed="${watching ? "true" : "false"}" aria-label="Watch price">${icon.star(22, watching ? "currentColor" : "none")}</button>`)}
      <section class="detail">
        ${img ? html`<img class="art" src="${img}" alt="${scan.card.name}">` : html`<span class="art"></span>`}
        <div><p class="serif h2">${scan.card.name}</p><p class="muted small">${scan.card.set} · #${scan.card.num}</p>
          ${e?.mostLikely ? html`<p class="eyebrow">MOST LIKELY · ${e.grader}</p><p class="grade-num sm">${e.mostLikely}</p>`
            : e?.centeringCap ? html`<p class="eyebrow">CENTERING ALLOWS · ${e.grader}</p><p class="grade-num sm">${e.centeringCap}</p><p class="mono muted small">ODDS IN TRAINING</p>` : ""}</div>
      </section>
      <section class="list-box">
        <div class="kv"><span>Raw value today</span><span class="mono">${money(scan.card.raw)}</span></div>
        <div class="kv"><span>You paid</span><span><label class="sr" for="paid">You paid</label><input id="paid" class="money-in" inputmode="decimal" value="${scan.paid ?? ""}" placeholder="Add"></span></div>
        ${scan.analysis.front?.centering ? html`<div class="kv"><span>Centering (measured)</span><span class="mono">${Math.round(Math.max(scan.analysis.front.centering.lr, 1 - scan.analysis.front.centering.lr) * 100)}/${100 - Math.round(Math.max(scan.analysis.front.centering.lr, 1 - scan.analysis.front.centering.lr) * 100)}</span></div>` : ""}
      </section>
      ${watching && !s.under13 ? html`<p class="muted small">Watching raw price. Alert below <span class="mono">${money(scan.card.raw * 0.8)}</span> or above <span class="mono">${money(scan.card.raw * 1.2)}</span> (±20%).</p>` : ""}
      <p class="eyebrow">SCAN HISTORY</p>
      <div class="list-box">
        ${scan.imported ? html`<div class="kv"><span>Imported from CSV</span><a class="link" href="#/scan">Scan it</a></div>` : html`<div class="kv"><span>${shortDate(scan.createdAt)} · ${photoCount(scan).total} photos</span><span class="mono gold">${e?.mostLikely ? `${e.grader} ${e.mostLikely}` : e?.centeringCap ? `≤ ${e.grader} ${e.centeringCap}` : "—"}</span></div>`}
        ${subs.map((x) => html`<div class="kv"><span>${x.returnedOn ? `${x.grader} ${x.slabGrade ?? ""} · back ${shortDate(x.returnedOn)}` : `At ${x.grader} since ${shortDate(x.sentOn)}`}</span>${x.returnedOn ? "" : html`<a class="link" href="#/slab/${scan.id}?sub=${x.id}">Add result</a>`}</div>`)}
      </div>
      <div class="spacer"></div>
      <a class="link block" href="#/slab/${scan.id}">Add Slab Result</a>
      <div class="row2"><a class="btn" href="#/scan">Re-scan</a><a class="btn primary" href="#/outcomes/${scan.id}">Outcomes</a></div>
      <button type="button" class="btn ghost danger" id="remove">Remove from Collection</button>
    </div>`,
    mount(el) {
      el.querySelector("#paid").addEventListener("change", async (ev) => {
        scan.paid = parseFloat(String(ev.target.value).replace(/[^\d.]/g, "")) || null;
        await put("scans", scan);
        toast("Saved");
      });
      el.querySelector("#watch").onclick = async () => {
        if (settings().under13) return toast("Price alerts are off for this account.");
        scan.watching = !scan.watching;
        await put("scans", scan);
        try {
          if (scan.watching) { await api.setAlert(scan.card.id); if (settings().alerts) await enablePush(); }
          else await api.clearAlert(scan.card.id);
        } catch (err) { if (err instanceof Offline) toast("Saved here. Alerts start when you're back online."); }
        go(`#/card/${scan.id}`);
      };
      el.querySelector("#remove").onclick = async () => {
        const v = await sheet(html`<h2 class="serif">Remove ${scan.card.name}?</h2><p class="muted small">Its photos and estimate are deleted from this phone.</p>`, [{ label: "Remove", value: "yes", primary: true }, { label: "Cancel", value: "no" }]);
        if (v !== "yes") return;
        for (const pid of [scan.photos.front, scan.photos.back, ...Object.values(scan.photos.closeups.front), ...Object.values(scan.photos.closeups.back), ...scan.photos.tilt.front, ...scan.photos.tilt.back]) if (pid) await del("photos", pid);
        await del("scans", scan.id);
        go("#/collection");
      };
      return () => img && img.startsWith("blob:") && URL.revokeObjectURL(img);
    },
  };
}

// ------------------------------------------------------------ slab result
export async function slabScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan?.card) return go("#/collection");
  const subId = new URLSearchParams(location.hash.split("?")[1] || "").get("sub");
  const sub = subId ? await get("submissions", subId) : (await all("submissions")).find((x) => x.scanId === scan.id && !x.returnedOn);
  const s = settings();
  let grader = sub?.grader || scan.estimate?.grader || s.grader;
  const view = () => html`<div class="screen pad">
    ${header("Add Slab Result", `#/card/${scan.id}`)}
    <h2 class="serif">How did ${scan.card.name} grade?</h2>
    <p class="muted small">Your real grade is how we check and publish our accuracy.</p>
    <p class="eyebrow">GRADER</p>${segmented("grader", GRADERS, grader, "Grader")}
    <label class="label" for="grade">GRADE</label>
    <input id="grade" class="field" inputmode="decimal" placeholder="e.g. 9" autocomplete="off">
    <label class="label" for="cert">CERT NUMBER</label>
    <div class="row-in"><input id="cert" class="field" inputmode="numeric" autocomplete="off" placeholder="Optional"><button type="button" class="btn small" id="lookup" ${grader === "PSA" ? "" : "hidden"}>Look up</button></div>
    <p class="muted small">${grader === "PSA" ? "PSA certs fill in the grade for you." : "Type the grade from the slab label."}</p>
    <div class="row2"><div><label class="label" for="sent">SENT ON</label><input id="sent" type="date" class="field" value="${sub?.sentOn || ""}"></div>
      <div><label class="label" for="back">BACK ON</label><input id="back" type="date" class="field" value="${new Date().toISOString().slice(0, 10)}"></div></div>
    <label class="label" for="sold">SOLD FOR (OPTIONAL)</label><input id="sold" class="field" inputmode="decimal" placeholder="$">
    ${scan.estimate?.mostLikely ? html`<div class="split card-box"><span><span class="eyebrow">OUR MOST LIKELY</span><span class="grade-num sm">${scan.estimate.mostLikely}</span></span><span id="match" class="muted small"></span></div>` : ""}
    <p class="small">${s.improve && !s.under13 ? "Saved anonymously to improve grading — only the grade and cropped card photos. No name, account or location." : "Saved anonymously: only the grade, never your name, account or location."} <a class="link" href="#/settings">Turn off in Settings</a></p>
    <div class="spacer"></div>
    <button type="button" class="btn primary" id="save">Save Result</button>
  </div>`;
  return {
    html: view(),
    mount(el) {
      const bind = () => {
        el.querySelectorAll('[data-seg="grader"]').forEach((b) => b.addEventListener("click", () => { grader = b.dataset.v; el.innerHTML = String(view()); bind(); }));
        el.querySelector("#lookup")?.addEventListener("click", async () => {
          try {
            const c = await api.psaCert(el.querySelector("#cert").value.trim());
            el.querySelector("#grade").value = c.grade;
            toast(`PSA ${c.grade} · ${c.subject}`);
          } catch { toast("Couldn't look that cert up. Type the grade instead."); }
        });
        el.querySelector("#grade").addEventListener("input", (e) => {
          const m = el.querySelector("#match");
          if (m && scan.estimate?.mostLikely) {
            const d = Math.abs(parseFloat(e.target.value) - parseFloat(String(scan.estimate.mostLikely).replace("≤", "")));
            m.textContent = isNaN(d) ? "" : d === 0 ? "Matched our most likely grade." : d <= 1 ? "Within one grade of our estimate." : "We missed this one. Thanks — it trains the next version.";
          }
        });
        el.querySelector("#save").onclick = async () => {
          const grade = el.querySelector("#grade").value.trim();
          if (!/^(10|[1-9](\.5)?)$/.test(grade)) return toast("Enter the grade from the label, like 9 or 9.5.");
          const sentOn = el.querySelector("#sent").value || null, returnedOn = el.querySelector("#back").value || null;
          const soldFor = parseFloat(String(el.querySelector("#sold").value).replace(/[^\d.]/g, "")) || null;
          const m = await manifest();
          const tier = sub?.tier ?? null;
          try {
            await api.slabResult({
              grader, grade, tier, cardId: scan.card.id, holo: !!scan.estimate?.holo,
              estimate: scan.estimate?.grader === grader ? { mostLikely: scan.estimate.mostLikely, probs: scan.estimate.probs, centeringCap: scan.estimate.centeringCap } : null,
              features: scan.estimate?.features ?? null, sentOn, returnedOn, soldFor, modelVersion: m.enabled ? m.version : null,
            });
          } catch (err) {
            if (err instanceof Offline) return toast("You're offline. Try saving again when you're back online.");
            return toast(err.message);
          }
          // Training crops: opt-in, 13+, full-card photos only, skipped when
          // there's writing on the border (canvas note "retakeWhen").
          if (settings().improve && !settings().under13) {
            for (const side of ["front", "back"]) {
              const a = scan.analysis[side];
              if (!scan.photos[side] || !a?.bounds || a.marks) continue;
              const image = await cardCrop(scan.photos[side], a.bounds, a.scale ?? 1);
              if (image) api.training({ image, grader, grade, side, slot: "full" }).catch(() => {});
            }
          }
          if (sub) { sub.returnedOn = returnedOn; sub.slabGrade = grade; await put("submissions", sub); }
          scan.slab = { grader, grade, returnedOn };
          await put("scans", scan);
          toast("Saved. Thank you.");
          go(`#/card/${scan.id}`);
        };
      };
      bind();
    },
  };
}

// ------------------------------------------------------------ submissions
export async function submissionsScreen() {
  const subs = (await all("submissions")).sort((a, b) => (b.sentOn || "").localeCompare(a.sentOn || ""));
  const scans = Object.fromEntries((await all("scans")).map((s) => [s.id, s]));
  let turn = {};
  try { turn = await api.turnaround(); } catch { /* offline */ }
  const s = settings();
  const today = new Date().toISOString().slice(0, 10);
  const items = subs.map((x) => {
    const name = scans[x.scanId]?.card?.name ?? "Card";
    const t = turn[`${x.grader}|${x.tier ?? ""}`];
    const days = t?.median ?? x.days ?? null;
    const due = x.sentOn && days ? new Date(Date.parse(x.sentOn) + days * 864e5).toISOString().slice(0, 10) : null;
    const state = x.returnedOn ? "BACK" : due && due < today ? "RUNNING LATE" : due ? `DUE IN ~${Math.max(0, Math.round((Date.parse(due) - Date.now()) / 864e5))} DAYS` : "AT GRADER";
    return html`<div class="card-box"><div class="split"><b>${name}</b><span class="mono small ${x.returnedOn ? "good" : state === "RUNNING LATE" ? "bad" : "gold"}">${state}</span></div>
      <p class="mono muted small">${x.grader} ${String(x.tier || "").toUpperCase()} · SENT ${shortDate(x.sentOn).toUpperCase()}${x.returnedOn ? ` · BACK ${shortDate(x.returnedOn).toUpperCase()}` : due ? ` · EXPECTED BY ${shortDate(due).toUpperCase()}` : ""}</p>
      ${!x.returnedOn && t ? html`<p class="muted small">Expected date comes from ${t.n} real ${x.grader} returns users added.</p>` : ""}
      ${!x.returnedOn && !t && days ? html`<p class="muted small">Expected date uses ${x.grader}'s published estimate. Graders run slow during backlogs.</p>` : ""}
      ${!x.returnedOn ? html`<a class="link" href="#/slab/${x.scanId}?sub=${x.id}">Add the Slab Result</a>` : ""}</div>`;
  });
  return {
    html: html`<div class="screen pad">
      ${header("Submissions", "#/collection")}
      <p class="eyebrow">${subs.filter((x) => !x.returnedOn).length} AT GRADERS</p>
      ${items.length ? items : html`<p class="muted">Nothing logged yet. Open a card's Outcomes and tap Plan to Grade.</p>`}
      <div class="kv card-box"><span><span id="rl">Return reminders</span><br><span class="muted small">A nudge near each expected date</span></span>
        <button type="button" role="switch" class="switch" id="remind" aria-checked="${s.remind ? "true" : "false"}" aria-labelledby="rl"><span></span></button></div>
      <a class="link block" href="#/plan">Plan a batch to share return shipping</a>
    </div>`,
    mount(el) {
      el.querySelector("#remind").onclick = async (e) => {
        const { saveSettings } = await import("../state.js");
        const on = e.currentTarget.getAttribute("aria-checked") !== "true";
        saveSettings({ remind: on });
        e.currentTarget.setAttribute("aria-checked", on ? "true" : "false");
      };
    },
  };
}

export async function submitScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan?.card) return go("#/collection");
  let fees;
  try { fees = await api.fees(); } catch { return go(`#/outcomes/${id}`); }
  let grader = scan.estimate?.grader || settings().grader;
  const view = () => {
    const tiers = fees.graders[grader].tiers.filter((t) => t.status !== "paused" && t.price != null);
    const best = pickTier(fees, grader, scan.card.raw);
    return html`<div class="screen pad">
      ${header("Log a Submission", `#/outcomes/${scan.id}`)}
      <p class="h3">${scan.card.name}</p>
      <p class="eyebrow">GRADER</p>${segmented("grader", GRADERS, grader, "Grader")}
      <label class="label" for="tier">TIER</label>
      <select id="tier" class="field">${tiers.map((t) => html`<option value="${t.id}" ${t.id === best?.id ? raw("selected") : ""}>${t.name} · ${money(t.price, { cents: true })} · ~${t.days} days${t.maxValue ? ` · up to ${money(t.maxValue)}` : ""}</option>`)}</select>
      <label class="label" for="sent">SENT ON</label><input id="sent" type="date" class="field" value="${new Date().toISOString().slice(0, 10)}">
      <p class="muted small">We'll remind you near the expected date so you can add the slab result.</p>
      <div class="spacer"></div>
      <button type="button" class="btn primary" id="log">Log Submission</button>
    </div>`;
  };
  return {
    html: view(),
    mount(el) {
      const bind = () => {
        el.querySelectorAll('[data-seg="grader"]').forEach((b) => b.addEventListener("click", () => { grader = b.dataset.v; el.innerHTML = String(view()); bind(); }));
        el.querySelector("#log").onclick = async () => {
          const t = fees.graders[grader].tiers.find((x) => x.id === el.querySelector("#tier").value);
          await put("submissions", { id: uid(), scanId: scan.id, grader, tier: t?.name ?? null, days: t?.days ?? null, sentOn: el.querySelector("#sent").value, returnedOn: null });
          scan.decision = "plan";
          await put("scans", scan);
          go("#/submissions");
        };
      };
      bind();
    },
  };
}

export async function planScreen() {
  let fees;
  try { fees = await api.fees(); } catch { return { html: html`<div class="screen pad">${header("Plan a Submission", "#/submissions")}<p class="muted">You're offline. Planning needs current fees.</p></div>` }; }
  const scans = (await all("scans")).filter((s) => s.inCollection && s.card && s.decision === "plan");
  const subs = await all("submissions");
  const planned = scans.filter((s) => !subs.some((x) => x.scanId === s.id)).map((s) => ({ id: s.id, name: s.card.name, grader: s.estimate?.grader || settings().grader, value: s.card.raw }));
  const batches = planBatches(planned, fees);
  return {
    html: html`<div class="screen pad">
      ${header("Plan a Submission", "#/submissions")}
      <p class="muted small">Cards going to the same grader and tier ship back in one package, so the shipping is shared.</p>
      ${batches.length ? batches.map((b) => html`<section class="card-box">
        <p class="h3">${b.grader} ${b.tier.name} · ${b.cards.length} card${b.cards.length === 1 ? "" : "s"}</p>
        <p class="mono muted small">${b.cards.map((c) => c.name.toUpperCase()).join(" · ")}</p>
        <div class="kv"><span>Grading</span><span class="mono">${money(b.grading, { cents: true })}</span></div>
        <div class="kv"><span>Return shipping</span><span class="mono">${b.shipping != null ? money(b.shipping, { cents: true }) : "Set at checkout"}</span></div>
        <div class="kv"><span>Per card</span><span class="mono">${money(b.perCard, { cents: true })}${b.shipping == null ? " + shipping" : ""}</span></div>
        ${b.needMore ? html`<p class="small gold">${b.grader} ${b.tier.name} needs ${b.tier.min} cards. Add ${b.needMore} more to use it.</p>` : ""}
      </section>`) : html`<p class="muted">Tap Plan to Grade on a card's Outcomes to add it here.</p>`}
      <p class="fine">Fees as of ${shortDate(fees.verifiedAt)} · tax and upcharges not included</p>
    </div>`,
  };
}
export { esc, pct };
