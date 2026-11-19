// Everything the app keeps lives on the phone: settings in localStorage,
// scans, photos, collection and submissions in IndexedDB.

const SETTINGS_KEY = "gemready.settings.v1";
export const PRIVACY_NOTICE_VERSION = 1;

const DEFAULTS = {
  ageChecked: false,
  under13: false,
  privacySeen: 0,
  tipsSeen: false,
  improve: true,          // "Improve grading with my card photos"
  grader: "PSA",
  threshold: "9",
  minNet: 100,
  alerts: true,
  remind: true,
  appearance: "system",
  shippingIn: 0,
  token: null,
  helpfulCount: 0,
  helpfulLastDay: null,
  outcomesLeaves: 0,
  beta: false,
};

let mem = null;
export function settings() {
  if (mem) return mem;
  try { mem = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { mem = { ...DEFAULTS }; }
  return mem;
}
export function saveSettings(patch) {
  mem = { ...settings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(mem)); } catch { /* private mode: keep in memory */ }
  return mem;
}
export function resetSettings() {
  mem = { ...DEFAULTS };
  try { localStorage.removeItem(SETTINGS_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- IndexedDB
const DB_NAME = "gemready";
const STORES = ["scans", "photos", "submissions"];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export const put = (store, v) => tx(store, "readwrite", (s) => s.put(v)).then(() => v);
export const get = (store, id) => tx(store, "readonly", (s) => s.get(id));
export const del = (store, id) => tx(store, "readwrite", (s) => s.delete(id));
export const all = (store) => tx(store, "readonly", (s) => s.getAll());

export async function wipeEverything() {
  for (const s of STORES) await tx(s, "readwrite", (st) => st.clear());
  resetSettings();
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------------------------------------------------------------- scans
// Slots: 2 full photos + 8 close-ups per side + tilt frames.
export const CLOSEUP_SLOTS = ["TL", "TOP", "TR", "RIGHT", "BR", "BTM", "BL", "LEFT"];
export const SLOT_NAMES = {
  TL: "top-left corner", TOP: "top edge", TR: "top-right corner", RIGHT: "right edge",
  BR: "bottom-right corner", BTM: "bottom edge", BL: "bottom-left corner", LEFT: "left edge",
};

export function newScan() {
  return {
    id: uid(), createdAt: new Date().toISOString(), status: "capturing",
    photos: { front: null, back: null, closeups: { front: {}, back: {} }, tilt: { front: [], back: [] } },
    analysis: { front: null, back: null },
    card: null, matchConfidence: null,
    estimate: null, inCollection: false, paid: null, watching: false, decision: null,
  };
}

export function photoCount(scan) {
  const p = scan.photos;
  const close = Object.keys(p.closeups.front).length + Object.keys(p.closeups.back).length;
  return { full: (p.front ? 1 : 0) + (p.back ? 1 : 0), closeups: close, tilt: p.tilt.front.length + p.tilt.back.length, total: (p.front ? 1 : 0) + (p.back ? 1 : 0) + close };
}

/** Next empty slot in capture order: front, front close-ups, back, back close-ups. */
export function nextSlot(scan) {
  const p = scan.photos;
  if (!p.front) return { side: "front", slot: "full" };
  for (const s of CLOSEUP_SLOTS) if (!p.closeups.front[s] && !scan.skipped?.[`front:${s}`]) return { side: "front", slot: s };
  if (!p.back) return { side: "back", slot: "full" };
  for (const s of CLOSEUP_SLOTS) if (!p.closeups.back[s] && !scan.skipped?.[`back:${s}`]) return { side: "back", slot: s };
  return null;
}

export async function unfinishedScan() {
  const scans = await all("scans");
  const cutoff = Date.now() - 24 * 3600 * 1000;
  return scans.filter((s) => s.status === "capturing" && Date.parse(s.createdAt) > cutoff && photoCount(s).total > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
