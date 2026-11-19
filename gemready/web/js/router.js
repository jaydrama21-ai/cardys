// Hash router: "#/estimate/abc" → routes["estimate"]({ id: "abc" }).

const routes = new Map();
let cleanup = null;
let guard = null;
let token = 0;

export function route(name, handler, params = []) { routes.set(name, { handler, params }); }
export function setGuard(fn) { guard = fn; }
export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
  return null;
}

export async function render() {
  const mine = ++token;
  const [name = "scan", ...rest] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const redirect = guard?.(name);
  if (redirect && redirect !== location.hash) return go(redirect);
  const r = routes.get(name) ?? routes.get("scan");
  const params = Object.fromEntries(r.params.map((p, i) => [p, rest[i]]).filter(([, v]) => v));
  let view;
  try { view = await r.handler(params); }
  catch (e) { console.error(e); view = { html: `<div class="screen pad"><h1 class="serif">Something went wrong</h1><p class="muted">${String(e.message || e).replace(/[<>&]/g, "")}</p><a class="btn" href="#/scan">Back to Scan</a></div>` }; }
  if (mine !== token || !view) return; // a newer navigation won
  if (typeof cleanup === "function") { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  const app = document.getElementById("app");
  app.innerHTML = String(view.html);
  window.scrollTo(0, 0);
  const h = app.querySelector("h1, h2");
  if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  if (view.mount) cleanup = await view.mount(app);
}

window.addEventListener("hashchange", render);
