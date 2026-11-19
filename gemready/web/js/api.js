// Talks to the GemReady backend. Same origin on the web; Capacitor builds set
// window.GEMREADY_API (see capacitor.config.json / index.html).

import { settings, saveSettings } from "./state.js";

const BASE = (window.GEMREADY_API || "") + "/api";
export const VERSION = "1.0.0";

export class Offline extends Error {}

async function call(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) {
    const token = await ensureToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  let r;
  try {
    r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Offline("offline");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || `Request failed (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return data;
}

/** Anonymous sign-in: a random token, nothing else. */
export async function ensureToken() {
  const s = settings();
  if (s.token) return s.token;
  if (s.under13) return null; // COPPA: never create a persistent identifier
  try {
    const r = await fetch(BASE + "/anon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ under13: !!s.under13 }) });
    if (!r.ok) return null;
    const { token } = await r.json();
    saveSettings({ token });
    return token;
  } catch {
    return null;
  }
}

let configCache = null;
export async function config() {
  if (configCache) return configCache;
  try { configCache = await call("/config"); } catch { configCache = { modelEnabled: false, offline: true }; }
  return configCache;
}
let manifestCache = null;
export async function manifest() {
  if (manifestCache) return manifestCache;
  try { manifestCache = await call("/model/manifest"); } catch { manifestCache = { enabled: false }; }
  return manifestCache;
}

export const api = {
  search: (q) => call(`/search?q=${encodeURIComponent(q)}`),
  card: (id) => call(`/card/${encodeURIComponent(id)}`),
  match: (payload) => call("/match", { method: "POST", body: payload }),
  outcomes: (id, grader, { shippingIn = 0, minNet = 0 } = {}) =>
    call(`/outcomes/${encodeURIComponent(id)}?grader=${grader}&shippingIn=${shippingIn}&minNet=${minNet}`),
  compare: (id, { shippingIn = 0, minNet = 0 } = {}) => call(`/compare/${encodeURIComponent(id)}?shippingIn=${shippingIn}&minNet=${minNet}`),
  fees: () => call("/fees"),
  accuracy: () => call("/accuracy"),
  turnaround: () => call("/turnaround"),
  psaCert: (cert) => call(`/psa-cert/${encodeURIComponent(cert)}`),
  slabResult: (r) => call("/slab-results", { method: "POST", body: r }),
  feedback: (f) => call("/feedback", { method: "POST", body: { ...f, version: VERSION } }),
  helpful: (screen, yes) => call("/helpful", { method: "POST", body: { screen, yes } }),
  training: (t) => call("/training", { method: "POST", body: t, auth: true }),
  setAlert: (cardId) => call(`/alerts/${encodeURIComponent(cardId)}`, { method: "PUT", auth: true }),
  clearAlert: (cardId) => call(`/alerts/${encodeURIComponent(cardId)}`, { method: "DELETE", auth: true }),
  setPush: (subscription) => call("/push", { method: "POST", body: { subscription }, auth: true }),
  setUnder13: (under13) => call("/me", { method: "PATCH", body: { under13 }, auth: true }),
  deleteMe: () => call("/me", { method: "DELETE", auth: true }),
};
