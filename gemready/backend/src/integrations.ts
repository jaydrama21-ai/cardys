// Optional third-party integrations. Each one is off until its env key is set,
// and every call fails safe (returns null) so a provider outage never breaks
// the app.

// ---- PSA cert lookup ("PSA certs fill in the grade and card for you") -------
// PSA Public API: https://www.psacard.com/publicapi (free token, rate limited).
export async function psaCert(cert: string): Promise<{ grade: string; subject: string; year: string; brand: string; cardNumber: string } | null> {
  const token = process.env.PSA_API_TOKEN;
  if (!token || !/^\d{6,10}$/.test(cert)) return null;
  try {
    const r = await fetch(`https://api.psacard.com/publicapi/cert/GetByCertNumber/${cert}`, {
      headers: { Authorization: `bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const c = j?.PSACert;
    if (!c) return null;
    return {
      grade: String(c.CardGrade ?? "").replace(/[^\d.]/g, ""),
      subject: String(c.Subject ?? ""),
      year: String(c.Year ?? ""),
      brand: String(c.Brand ?? ""),
      cardNumber: String(c.CardNumber ?? ""),
    };
  } catch {
    return null;
  }
}

// ---- Web Push (price alerts) -------------------------------------------------
// Needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT. Generate once
// with `npx web-push generate-vapid-keys`.
let webpush: any = null;
export async function pushReady(): Promise<boolean> {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  if (!webpush) {
    try {
      webpush = (await import("web-push")).default;
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    } catch {
      return false;
    }
  }
  return true;
}

export async function sendPush(sub: any, payload: { title: string; body: string; url: string }): Promise<boolean> {
  if (!sub || !(await pushReady())) return false;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
