// Tiny view helpers: escaped HTML templates, icons, shared chrome.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Raw (already-safe) HTML marker so nested templates aren't re-escaped. */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

/** Tagged template: interpolations are escaped unless they're raw()/arrays of raw. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (v instanceof Raw) out += v.s;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join("");
    else if (v === false || v == null) out += "";
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

const svg = (d, w = 24, extra = "") =>
  raw(`<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`);

export const icon = {
  back: (w = 22) => svg('<path d="M15 5l-7 7 7 7"/>', w),
  chevron: (w = 16) => svg('<path d="M9 5l7 7-7 7"/>', w),
  check: (w = 16) => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', w),
  warn: (w = 16) => svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>', w),
  info: (w = 18) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>', w),
  scan: (w = 24) => svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8.5" y="7" width="7" height="10" rx="1"/>', w),
  stack: (w = 24) => svg('<rect x="7" y="3" width="12" height="16" rx="1.5"/><path d="M4 7v12a2 2 0 0 0 2 2h10"/>', w),
  sliders: (w = 24) => svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', w),
  photo: (w = 20) => svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>', w),
  star: (w = 22, fill = "none") => svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>', w, `style="fill:${fill}"`),
  search: (w = 18) => svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>', w),
  plus: (w = 28) => svg('<path d="M12 6v12M6 12h12"/>', w),
  flip: (w = 20) => svg('<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>', w),
};

export const money = (n, { cents = false, sign = false } = {}) => {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const pre = n < 0 ? "−" : sign ? "+" : "";
  return `${pre}$${s}`;
};
export const pct = (p) => (p == null ? "—" : `${Math.round(p * 100)}%`);
export const shortDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
export const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function header(title, backHref = null, right = "") {
  return html`<header class="bar">
    ${backHref ? html`<a class="icon-btn" href="${backHref}" aria-label="Back">${icon.back()}</a>` : ""}
    <h1 class="bar-title">${title}</h1>
    <span class="bar-right">${raw(String(right))}</span>
  </header>`;
}

export function tabs(active) {
  const t = (href, label, ic, key) =>
    html`<a href="${href}" class="tab ${active === key ? "on" : ""}" ${active === key ? raw('aria-current="page"') : ""}>${ic}<span>${label}</span></a>`;
  return html`<nav class="tabs" aria-label="Tabs">
    ${t("#/scan", "Scan", icon.scan(), "scan")}
    ${t("#/collection", "Collection", icon.stack(), "collection")}
    ${t("#/settings", "Settings", icon.sliders(), "settings")}
  </nav>`;
}

export const wordmark = () => html`<div class="wordmark">Gem<em>Ready</em></div>`;

export const DISCLAIMER = "A condition estimate from photos, not a grade. Graders can and do differ. Not affiliated with PSA, BGS, CGC or TAG.";
export const MONEY_DISCLAIMER = "These are estimates, not financial advice. Actual grades, prices and fees can differ.";

export function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2600);
}

/** Bottom sheet; resolves with the value of the button pressed (or null). */
export function sheet(content, buttons) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "sheet-wrap";
    wrap.innerHTML = String(html`<div class="sheet" role="dialog" aria-modal="true">
      ${raw(String(content))}
      <div class="sheet-actions">${buttons.map((b) => html`<button type="button" class="btn ${b.primary ? "primary" : ""}" data-v="${b.value}">${b.label}</button>`)}</div>
    </div>`);
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (b) done(b.dataset.v);
      else if (e.target === wrap) done(null);
    });
    document.body.appendChild(wrap);
    wrap.querySelector("button")?.focus();
  });
}

export function switchHtml(id, on, labelledBy) {
  return html`<button type="button" role="switch" class="switch" id="${id}" aria-checked="${on ? "true" : "false"}" aria-labelledby="${labelledBy}"><span></span></button>`;
}

export function segmented(name, options, value, label) {
  return html`<div class="seg" role="group" aria-label="${label}">${options.map((o) => {
    const v = typeof o === "string" ? o : o.value, l = typeof o === "string" ? o : o.label;
    return html`<button type="button" data-seg="${name}" data-v="${v}" aria-pressed="${v === value ? "true" : "false"}">${l}</button>`;
  })}</div>`;
}
