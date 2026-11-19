// Scan → check photos → analyze → (fix card) → estimate.

import { html, raw, esc, icon, header, tabs, wordmark, sheet, toast } from "../ui.js";
import { settings, saveSettings, get, put, del, newScan, nextSlot, photoCount, CLOSEUP_SLOTS, SLOT_NAMES, unfinishedScan } from "../state.js";
import { Camera, edgeLock, savePhoto, fileToCanvas, photoUrl, analyzeFull, readCardText } from "../capture.js";
import { ISSUE_COPY } from "../../shared/analysis.js";
import { api, Offline } from "../api.js";
import { go } from "../router.js";

const slotLabel = (n) => (n.slot === "full" ? `${n.side === "front" ? "Front" : "Back"}, full card` : `${n.side === "front" ? "Front" : "Back"} · ${SLOT_NAMES[n.slot]}`);

async function currentScan(id) {
  if (id) { const s = await get("scans", id); if (s) return s; }
  const s = newScan();
  await put("scans", s);
  return s;
}

/** Ask to retake when a photo fails a check. Returns true to keep it. */
async function confirmPhoto(checks, n) {
  if (checks.ok) return true;
  const issue = checks.issues[0];
  const copy = ISSUE_COPY[issue.kind];
  const title = issue.kind === "glare" && issue.where ? `Glare on the ${issue.where}` : copy.title;
  const v = await sheet(
    html`<p class="eyebrow">${slotLabel(n)}</p><h2 class="serif">${title}</h2><p class="muted">${copy.body}</p>`,
    [{ label: "Retake", value: "retake", primary: true }, { label: "Use Anyway", value: "use" }]
  );
  return v === "use";
}

function assign(scan, n, photoId, checks) {
  if (n.slot === "full") {
    scan.photos[n.side] = photoId;
    scan.analysis[n.side] = { ...(scan.analysis[n.side] || {}), checks };
  } else {
    scan.photos.closeups[n.side][n.slot] = photoId;
  }
}

// ------------------------------------------------------------------ scan
export async function scanScreen({ id } = {}) {
  if (!id) {
    const open = await unfinishedScan();
    if (open && !sessionStorage.getItem("resumeAsked")) {
      sessionStorage.setItem("resumeAsked", "1");
      return go(`#/resume/${open.id}`);
    }
  }
  const scan = await currentScan(id);
  if (!id) history.replaceState(null, "", `#/scan/${scan.id}`);
  let target = nextSlot(scan) ?? { side: "back", slot: "tilt" };

  const view = () => {
    const c = photoCount(scan);
    const fc = Object.keys(scan.photos.closeups.front).length, bc = Object.keys(scan.photos.closeups.back).length;
    const chip = (label, val, key, on) => html`<button type="button" class="chip ${on ? "now" : ""}" data-target="${key}">${label}<span class="mono ${val === "Done" || val === "8/8" ? "good" : on ? "gold" : "muted"}">${val}</span></button>`;
    const isFull = target.slot === "full", isTilt = target.slot === "tilt";
    return html`
      <div class="screen scan">
        <header class="brand-bar">${wordmark()}<span class="mono muted small">Is it gem ready?</span></header>
        <section class="viewfinder" aria-label="Camera viewfinder">
          <video id="video" playsinline muted></video>
          <div class="brackets ${isFull || isTilt ? "full" : "close"}" id="brackets"><i></i><i></i><i></i><i></i></div>
          <p class="lock" id="lock" role="status">${isTilt ? "Tilt slowly toward you" : isFull ? "Fill the brackets with the card" : "Fill the box with the " + SLOT_NAMES[target.slot]}</p>
          <div class="cam-off" id="camoff" hidden><p>Camera isn't available. Allow camera access in Settings, or upload photos instead.</p></div>
        </section>
        <p class="now"><span class="mono gold">NOW</span> ${isTilt ? "Tilt shot · " + (target.side === "front" ? "front" : "back") : slotLabel(target)}
          ${!isFull && !isTilt ? html`<button type="button" class="link" id="skip">Skip spot</button>` : ""}</p>
        <div class="chips">
          ${chip("Front", scan.photos.front ? "Done" : "—", "front:full", target.side === "front" && isFull)}
          ${chip("Front close-ups", `${fc}/8`, "front:close", target.side === "front" && !isFull && !isTilt)}
          ${chip("Back", scan.photos.back ? "Done" : "—", "back:full", target.side === "back" && isFull)}
          ${chip("Back close-ups", `${bc}/8`, "back:close", target.side === "back" && !isFull && !isTilt)}
          ${chip("Tilt shots", String(c.tilt), "tilt", isTilt)}
        </div>
        <div class="shutter-row">
          <label class="side-btn"><input type="file" accept="image/*" multiple id="upload" hidden><span class="sq">${icon.photo()}</span><span>Upload</span></label>
          <button type="button" class="shutter" id="shutter" aria-label="${isTilt ? "Record tilt shot" : "Take photo"}"><span></span></button>
          <a class="side-btn ${c.total ? "" : "disabled"}" href="${c.total ? `#/check/${scan.id}` : "#"}" ${c.total ? "" : raw('aria-disabled="true"')}><span class="sq gold mono">${c.total}</span><span>Grade now</span></a>
        </div>
        ${tabs("scan")}
      </div>`;
  };

  let cam = null, timer = null, busy = false;
  const mount = (el) => {
    const video = el.querySelector("#video");
    cam = new Camera(video);
    cam.start().catch(() => { el.querySelector("#camoff").hidden = false; });
    timer = setInterval(() => {
      if (!cam.ready() || busy) return;
      const lock = target.slot === "full" ? edgeLock(cam.smallFrame()).locked : true;
      el.querySelector("#brackets")?.classList.toggle("locked", lock);
      const l = el.querySelector("#lock");
      if (l && target.slot === "full") l.textContent = lock ? "Edges locked. Hold still." : "Fill the brackets with the card";
    }, 450);

    const rerender = () => { el.innerHTML = String(view()); bind(); cam.video = el.querySelector("#video"); cam.video.srcObject = cam.stream; cam.video.play().catch(() => {}); };

    const shoot = async () => {
      if (busy) return;
      if (!cam.ready()) return toast("Camera isn't ready yet.");
      busy = true;
      try {
        if (target.slot === "tilt") {
          toast("Tilt slowly toward you…");
          for (let i = 0; i < 4; i++) {
            await new Promise((r) => setTimeout(r, 650));
            const { photoId } = await savePhoto(cam.frame(), { side: target.side, slot: "tilt" });
            scan.photos.tilt[target.side].push(photoId);
          }
          await put("scans", scan);
          toast("Tilt shot saved");
        } else {
          const n = target;
          const { photoId, checks } = await savePhoto(cam.frame(), n);
          if (!(await confirmPhoto(checks, n))) { await del("photos", photoId); return; }
          assign(scan, n, photoId, checks);
          await put("scans", scan);
          target = nextSlot(scan) ?? { side: "back", slot: "tilt" };
        }
        rerender();
      } finally { busy = false; }
    };

    const bind = () => {
      el.querySelector("#shutter").onclick = shoot;
      el.querySelector("#skip")?.addEventListener("click", async () => {
        scan.skipped = { ...(scan.skipped || {}), [`${target.side}:${target.slot}`]: true };
        await put("scans", scan);
        target = nextSlot(scan) ?? { side: "back", slot: "tilt" };
        rerender();
      });
      el.querySelectorAll("[data-target]").forEach((b) => b.addEventListener("click", () => {
        const t = b.dataset.target;
        if (t === "tilt") target = { side: scan.photos.back ? "back" : "front", slot: "tilt" };
        else {
          const [side, kind] = t.split(":");
          if (kind === "full") target = { side, slot: "full" };
          else target = { side, slot: CLOSEUP_SLOTS.find((s) => !scan.photos.closeups[side][s]) ?? "TL" };
        }
        rerender();
      }));
      el.querySelector("#upload").addEventListener("change", async (e) => {
        const files = [...e.target.files].slice(0, 18);
        if (!files.length) return;
        busy = true;
        try {
          // Camera-roll order: first photo = front, second = back, the rest
          // fill close-ups in order (canvas 17 "sorts them" by position).
          for (const [i, f] of files.entries()) {
            let n = nextSlot(scan);
            if (i === 0 && !scan.photos.front) n = { side: "front", slot: "full" };
            else if (i === 1 && files.length > 1 && !scan.photos.back) n = { side: "back", slot: "full" };
            if (!n) break;
            const canvas = await fileToCanvas(f);
            const { photoId, checks } = await savePhoto(canvas, n);
            assign(scan, n, photoId, checks);
          }
          await put("scans", scan);
          go(`#/check/${scan.id}`);
        } catch {
          toast("Couldn't read that photo.");
        } finally { busy = false; }
      });
    };
    bind();
    return () => { clearInterval(timer); cam?.stop(); };
  };
  return { html: view(), mount };
}

// ------------------------------------------------------------- resume
export async function resumeScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan) return go("#/scan");
  const c = photoCount(scan);
  const taken = [scan.photos.front && "FRONT", scan.photos.back && "BACK", c.closeups && `${c.closeups} CLOSE-UPS`].filter(Boolean).join(" · ");
  return {
    html: html`<div class="screen pad center-col">
      <h1 class="serif big">Pick up where you left off?</h1>
      <p class="muted">You took ${c.total} of 18 photos${scan.card ? ` of ${scan.card.name}` : ""} before the app closed.</p>
      <div class="card-box"><p class="eyebrow">PHOTOS TAKEN</p><p class="mono">${taken}</p><p class="mono gold">${18 - c.total} TO GO</p></div>
      <p class="muted small">Corners and edges matter most for a 10. More photos make the estimate more reliable, but you can grade with what you have.</p>
      <div class="spacer"></div>
      <a class="btn primary" href="#/scan/${scan.id}">Keep Going</a>
      <a class="btn" href="#/check/${scan.id}">Grade With ${c.total} Photo${c.total === 1 ? "" : "s"}</a>
      <button type="button" class="btn ghost" id="restart">Start Over</button>
    </div>`,
    mount(el) {
      el.querySelector("#restart").onclick = async () => { await del("scans", scan.id); go("#/scan"); };
    },
  };
}

// --------------------------------------------------------- check photos
export async function checkScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan) return go("#/scan");
  const c = photoCount(scan);
  const urls = {};
  const ids = [["front:full", scan.photos.front], ["back:full", scan.photos.back],
    ...CLOSEUP_SLOTS.map((s) => [`front:${s}`, scan.photos.closeups.front[s]]),
    ...CLOSEUP_SLOTS.map((s) => [`back:${s}`, scan.photos.closeups.back[s]])];
  for (const [k, pid] of ids) if (pid) urls[k] = await photoUrl(pid);
  const level = (n, hi, mid) => (n >= hi ? "HIGH" : n >= mid ? "MEDIUM" : "LOW");
  const blurry = (side) => scan.analysis[side]?.checks?.issues?.some((i) => i.kind === "blur");
  const grid = (side) => html`<div class="thumbs">
    ${[["full", "FULL"], ...CLOSEUP_SLOTS.map((s) => [s, s])].map(([slot, label]) => {
      const u = urls[`${side}:${slot}`];
      return u ? html`<div class="thumb"><img src="${u}" alt="${side} ${label}"><span>${slot === "full" && blurry(side) ? "BLUR" : label}</span></div>`
        : html`<a class="thumb empty" href="#/scan/${scan.id}">+ ${label}</a>`;
    })}
  </div>`;
  const sideCount = (side) => (scan.photos[side] ? 1 : 0) + Object.keys(scan.photos.closeups[side]).length;
  return {
    html: html`<div class="screen pad">
      ${header("Check Photos", `#/scan/${scan.id}`, html`<span class="mono muted small">${c.total} OF 18</span>`)}
      <h2 class="serif">${c.total} photo${c.total === 1 ? "" : "s"}. Ready to grade.</h2>
      <p class="muted small">Grade now, or fill empty spots for higher confidence. Even 1 photo works.</p>
      <p class="eyebrow">FRONT · ${sideCount("front")} OF 9</p>${grid("front")}
      <p class="eyebrow">BACK · ${sideCount("back")} OF 9</p>${grid("back")}
      <div class="card-box">
        <p class="eyebrow">CONFIDENCE BY SUB-GRADE</p>
        <div class="kv"><span>Centering <span class="muted">· ${c.full} of 2 full photos</span></span><span class="mono">${level(c.full, 2, 1)}</span></div>
        <div class="kv"><span>Corners <span class="muted">· ${c.closeups} of 16 close</span></span><span class="mono">${level(c.closeups, 14, 6)}</span></div>
        <div class="kv"><span>Edges <span class="muted">· ${c.closeups} of 16 close</span></span><span class="mono">${level(c.closeups, 14, 6)}</span></div>
        <div class="kv"><span>Surface <span class="muted">· ${c.tilt ? `${c.tilt} tilt frames` : "no tilt shot"}</span></span><span class="mono">${c.tilt ? "MEDIUM" : "LOW"}</span></div>
      </div>
      <div class="spacer"></div>
      <div class="row2">
        <a class="btn" href="#/scan/${scan.id}">Add Photos</a>
        <a class="btn primary ${c.total ? "" : "disabled"}" href="#/analyze/${scan.id}">Grade with ${c.total}</a>
      </div>
    </div>`,
    mount() { return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)); },
  };
}

// ------------------------------------------------------------ analyzing
export async function analyzeScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan) return go("#/scan");
  const step = (key, label) => html`<div class="kv step" data-step="${key}"><span>${label}</span><span class="mono muted">…</span></div>`;
  return {
    html: html`<div class="screen pad">
      ${header("Analyzing", `#/check/${scan.id}`)}
      <p class="muted">Everything here runs on your phone. Your photos don't leave it.</p>
      <div class="card-box steps">
        ${step("front", "Front · centering")}
        ${step("back", "Back · centering")}
        ${step("read", "Reading the card")}
        ${step("match", "Matching the card")}
      </div>
    </div>`,
    async mount(el) {
      const mark = (k, text, cls = "good") => { const s = el.querySelector(`[data-step="${k}"] .mono`); if (s) { s.textContent = text; s.className = `mono ${cls}`; } };
      for (const side of ["front", "back"]) {
        if (!scan.photos[side]) { mark(side, "NO PHOTO", "muted"); continue; }
        const a = await analyzeFull(scan.photos[side]);
        scan.analysis[side] = { ...(scan.analysis[side] || {}), ...a };
        mark(side, a?.centering ? `${Math.round(Math.max(a.centering.lr, 1 - a.centering.lr) * 100)}/${100 - Math.round(Math.max(a.centering.lr, 1 - a.centering.lr) * 100)}` : "COULDN'T MEASURE", a?.centering ? "good" : "gold");
      }
      await put("scans", scan);
      if (scan.card) { mark("read", "KNOWN"); mark("match", scan.card.name); return setTimeout(() => go(`#/estimate/${scan.id}`), 500); }
      let text = "";
      if (scan.photos.front) {
        const f = scan.analysis.front;
        text = await readCardText(scan.photos.front, f?.bounds, f?.scale ?? 1);
      }
      mark("read", text.trim() ? "DONE" : "COULDN'T READ", text.trim() ? "good" : "gold");
      try {
        const m = text.trim() ? await api.match({ text }) : { id: null, candidates: [], hints: {} };
        scan.ocrHints = m.hints;
        scan.candidates = m.candidates.slice(0, 5);
        if (m.id) {
          const c = m.candidates[0];
          scan.card = { id: c.id, name: c.name, set: c.set, num: c.num, img: c.img ?? null, raw: c.raw, rarity: c.rarity };
          scan.matchConfidence = m.confidence;
        }
        await put("scans", scan);
        mark("match", m.id ? scan.card.name : "PICK THE CARD", m.id ? "good" : "gold");
        setTimeout(() => go(m.id ? `#/estimate/${scan.id}` : `#/fix/${scan.id}`), 600);
      } catch (e) {
        mark("match", e instanceof Offline ? "OFFLINE" : "PICK THE CARD", "gold");
        setTimeout(() => go(`#/fix/${scan.id}`), 600);
      }
    },
  };
}

// ------------------------------------------------------------- fix card
export async function fixScreen({ id }) {
  const scan = await get("scans", id);
  if (!scan) return go("#/scan");
  const seed = [scan.ocrHints?.name, scan.ocrHints?.number?.split("/")[0]].filter(Boolean).join(" ") || scan.card?.name || "";
  let results = scan.candidates || [];
  let pick = scan.card?.id ?? results[0]?.id ?? null;
  const list = () => results.length
    ? html`${results.map((c) => html`<button type="button" class="row-btn ${c.id === pick ? "on" : ""}" role="radio" aria-checked="${c.id === pick ? "true" : "false"}" data-id="${c.id}">
        ${c.img ? html`<img class="mini" src="${c.img}" alt="" loading="lazy">` : html`<span class="mini"></span>`}
        <span class="grow"><b>${c.name}</b><span class="mono muted small">${c.set} · ${c.num}</span></span><span class="dot"></span></button>`)}`
    : html`<p class="muted">No matches yet. Type the name or the number printed at the bottom of the card.</p>`;
  return {
    html: html`<div class="screen pad">
      ${header("Fix Card", `#/check/${scan.id}`)}
      <p class="muted small">${scan.ocrHints?.name ? raw(`Read as <b>${esc(scan.ocrHints.name)}${scan.ocrHints.number ? " · " + esc(scan.ocrHints.number) : ""}</b>. `) : ""}Wrong set or printing? Pick the right one — prices reload once you confirm.</p>
      <label for="q" class="label">Card name or number</label>
      <div class="search"><span>${icon.search()}</span><input id="q" type="search" value="${seed}" autocomplete="off" enterkeyhint="search"></div>
      <p class="eyebrow">MATCHES</p>
      <div role="radiogroup" aria-label="Matching cards" id="list">${list()}</div>
      <div class="spacer"></div>
      <button type="button" class="btn primary" id="confirm" ${pick ? "" : "disabled"}>Confirm Card</button>
    </div>`,
    mount(el) {
      const listEl = el.querySelector("#list"), q = el.querySelector("#q"), confirm = el.querySelector("#confirm");
      const draw = () => { listEl.innerHTML = String(list()); confirm.disabled = !pick; };
      listEl.addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) { pick = b.dataset.id; draw(); } });
      let t;
      const search = async () => {
        const v = q.value.trim();
        if (v.length < 2) return;
        try { results = await api.search(v); pick = results[0]?.id ?? null; draw(); }
        catch (e) { if (e instanceof Offline) toast("You're offline. Try again when you're back online."); }
      };
      q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(search, 300); });
      if (!results.length && seed) search();
      confirm.onclick = async () => {
        const c = results.find((x) => x.id === pick);
        if (!c) return;
        scan.card = { id: c.id, name: c.name, set: c.set, num: c.num, img: c.img ?? null, raw: c.raw, rarity: c.rarity };
        scan.matchConfidence = 1;
        scan.estimate = null;
        await put("scans", scan);
        go(`#/estimate/${scan.id}`);
      };
    },
  };
}

export { slotLabel };
