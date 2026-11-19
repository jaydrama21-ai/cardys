// Web Push for price alerts. Works in installed PWAs (iOS 16.4+ home-screen
// apps, Android, desktop). In the App Store build, swap this for native
// push (APNs) — see docs/LAUNCH_CHECKLIST.md.

import { api, config } from "./api.js";

const b64ToBytes = (b64) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function enablePush() {
  try {
    const { pushPublicKey } = await config();
    if (!pushPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    if (Notification.permission === "denied") return false;
    if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(pushPublicKey) }));
    await api.setPush(sub.toJSON());
    return true;
  } catch {
    return false;
  }
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
    await api.setPush(null);
  } catch { /* ignore */ }
}
