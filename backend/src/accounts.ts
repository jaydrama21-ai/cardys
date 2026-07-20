// Accounts + holdings sync (feed 4). Email/password auth with scrypt hashes
// and bearer-token sessions; holdings move off the device's localStorage so a
// collection follows the user across devices.
//
// Storage follows the catalog pattern: works fully in-memory with zero config,
// and persists through Postgres (users/sessions/holdings in schema.sql) when
// DATABASE_URL is set. Every path is fallback-safe and never throws.

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export interface User {
  id: string;
  email: string;
}

export interface Holding {
  id: string;
  cardId: string;
  lang: string;
  grade: string | null;   // null = raw
  cost: number | null;    // acquisition cost basis, USD
  acquired: string;       // ISO timestamp
  soldAt: string | null;
  soldPrice: number | null;
}

// ---- password hashing --------------------------------------------------------

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---- in-memory store (always the fast path; PG mirrors it when configured) ---

const usersByEmail = new Map<string, User & { passwordHash: string }>();
const usersById = new Map<string, User & { passwordHash: string }>();
const sessions = new Map<string, string>(); // token -> userId
const holdingsByUser = new Map<string, Holding[]>();

// ---- optional Postgres mirror ------------------------------------------------

async function pgPool(): Promise<any | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { default: pg } = await import("pg");
    // Reuse one pool via a module-global on the function.
    const self = pgPool as any;
    if (!self._pool) self._pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    return self._pool;
  } catch {
    return null;
  }
}

/** Warm the in-memory maps from Postgres on boot. */
export async function warmAccounts(): Promise<void> {
  const p = await pgPool();
  if (!p) return;
  try {
    const users = await p.query(
      `select id, email, password_hash, scan_month, scans_used from users where email is not null`
    );
    for (const r of users.rows) {
      const u = { id: r.id, email: r.email, passwordHash: r.password_hash ?? "" };
      usersByEmail.set(u.email, u);
      usersById.set(u.id, u);
      if (r.scan_month) scanMonths.set(r.id, { month: r.scan_month, used: r.scans_used ?? 0 });
    }
    const sess = await p.query(`select token, user_id from sessions`);
    for (const r of sess.rows) sessions.set(r.token, r.user_id);
    const holds = await p.query(
      `select id, user_id, card_id, lang, grade, cost, acquired, sold_at, sold_price from holdings`
    );
    for (const r of holds.rows) {
      const list = holdingsByUser.get(r.user_id) ?? [];
      list.push({
        id: r.id,
        cardId: r.card_id,
        lang: r.lang,
        grade: r.grade,
        cost: r.cost,
        acquired: new Date(r.acquired).toISOString(),
        soldAt: r.sold_at ? new Date(r.sold_at).toISOString() : null,
        soldPrice: r.sold_price,
      });
      holdingsByUser.set(r.user_id, list);
    }
    if (users.rows.length) console.log(`Accounts warmed: ${users.rows.length} users.`);
  } catch (e) {
    console.error("accounts warm failed:", e);
  }
}

// ---- auth --------------------------------------------------------------------

export async function register(email: string, password: string): Promise<{ token: string; user: User } | { error: string }> {
  const em = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { error: "invalid email" };
  if (password.length < 8) return { error: "password must be at least 8 characters" };
  if (usersByEmail.has(em)) return { error: "account already exists" };
  const user = { id: randomUUID(), email: em, passwordHash: hashPassword(password) };
  usersByEmail.set(em, user);
  usersById.set(user.id, user);
  const p = await pgPool();
  if (p) {
    await p
      .query(`insert into users (id, email, password_hash) values ($1,$2,$3) on conflict (email) do nothing`, [
        user.id,
        em,
        user.passwordHash,
      ])
      .catch((e: unknown) => console.error("user persist failed:", e));
  }
  const token = await issueToken(user.id);
  return { token, user: { id: user.id, email: em } };
}

/** Google sign-in: verify the GIS id_token, then find-or-create by email. */
export async function loginWithGoogle(credential: string): Promise<{ token: string; user: User } | { error: string }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return { error: "google sign-in not configured" };
  try {
    const r = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!r.ok) return { error: "invalid google credential" };
    const info: any = await r.json();
    if (info.aud !== clientId) return { error: "credential is for a different app" };
    if (info.email_verified !== "true" && info.email_verified !== true) return { error: "google email not verified" };
    const em = String(info.email || "").toLowerCase();
    if (!em) return { error: "no email in credential" };
    let u = usersByEmail.get(em);
    if (!u) {
      u = { id: randomUUID(), email: em, passwordHash: "" }; // OAuth-only account
      usersByEmail.set(em, u);
      usersById.set(u.id, u);
      const p = await pgPool();
      if (p) {
        await p
          .query(`insert into users (id, email, password_hash) values ($1,$2,null) on conflict (email) do nothing`, [u.id, em])
          .catch((e: unknown) => console.error("google user persist failed:", e));
      }
    }
    const token = await issueToken(u.id);
    return { token, user: { id: u.id, email: em } };
  } catch {
    return { error: "could not verify google credential" };
  }
}

export async function login(email: string, password: string): Promise<{ token: string; user: User } | { error: string }> {
  const u = usersByEmail.get(email.trim().toLowerCase());
  if (!u || !u.passwordHash || !verifyPassword(password, u.passwordHash)) {
    return { error: "invalid email or password" };
  }
  const token = await issueToken(u.id);
  return { token, user: { id: u.id, email: u.email } };
}

async function issueToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, userId);
  const p = await pgPool();
  if (p) {
    await p
      .query(`insert into sessions (token, user_id) values ($1,$2)`, [token, userId])
      .catch((e: unknown) => console.error("session persist failed:", e));
  }
  return token;
}

/** Resolve a Bearer token to a user, or null. */
export function userForToken(authHeader: string | undefined): User | null {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const userId = sessions.get(token);
  const u = userId ? usersById.get(userId) : null;
  return u ? { id: u.id, email: u.email } : null;
}

/** Delete a user and everything attached — sessions, holdings, counters. */
export async function deleteUser(userId: string): Promise<boolean> {
  const u = usersById.get(userId);
  if (!u) return false;
  usersById.delete(userId);
  usersByEmail.delete(u.email);
  holdingsByUser.delete(userId);
  scanMonths.delete(userId);
  for (const [token, uid] of sessions) if (uid === userId) sessions.delete(token);
  const p = await pgPool();
  if (p) {
    try {
      await p.query(`delete from holdings where user_id = $1`, [userId]);
      await p.query(`delete from sessions where user_id = $1`, [userId]);
      await p.query(`delete from users where id = $1`, [userId]);
    } catch (e) {
      console.error("user delete persist failed:", e);
    }
  }
  return true;
}

// ---- scan metering -----------------------------------------------------------
// Free plan: FREE_SCANS per calendar month per account. Anonymous devices get
// TRIAL_SCANS (in-memory — resets on restart, which only ever helps the user).
// A global daily cap backstops the provider bill regardless of who's asking.

const FREE_SCANS = Number(process.env.FREE_SCANS || 25);
const TRIAL_SCANS = Number(process.env.TRIAL_SCANS || 3);
const SCAN_DAILY_CAP = Number(process.env.SCAN_DAILY_CAP || 2000);

const scanMonths = new Map<string, { month: string; used: number }>(); // userId -> counter
const trialScans = new Map<string, number>(); // deviceId -> used
let dayUsed = { day: "", used: 0 };

const monthKey = () => new Date().toISOString().slice(0, 7);
const dayKey = () => new Date().toISOString().slice(0, 10);

export interface ScanGate {
  allowed: boolean;
  scansLeft: number;
  reason?: "scan_limit" | "trial_limit" | "daily_cap";
}

/** Check-and-consume one scan for a user or anonymous device. */
export async function consumeScan(userId: string | null, deviceId: string | null): Promise<ScanGate> {
  if (dayUsed.day !== dayKey()) dayUsed = { day: dayKey(), used: 0 };
  if (dayUsed.used >= SCAN_DAILY_CAP) return { allowed: false, scansLeft: 0, reason: "daily_cap" };

  if (userId) {
    let c = scanMonths.get(userId);
    if (!c || c.month !== monthKey()) c = { month: monthKey(), used: 0 };
    if (c.used >= FREE_SCANS) {
      scanMonths.set(userId, c);
      return { allowed: false, scansLeft: 0, reason: "scan_limit" };
    }
    c.used += 1;
    scanMonths.set(userId, c);
    dayUsed.used += 1;
    persistScanCount(userId, c).catch(() => {});
    return { allowed: true, scansLeft: FREE_SCANS - c.used };
  }

  const key = deviceId || "unknown";
  const used = trialScans.get(key) ?? 0;
  if (used >= TRIAL_SCANS) return { allowed: false, scansLeft: 0, reason: "trial_limit" };
  trialScans.set(key, used + 1);
  dayUsed.used += 1;
  return { allowed: true, scansLeft: TRIAL_SCANS - used - 1 };
}

export function scansLeftFor(userId: string | null, deviceId: string | null): number {
  if (userId) {
    const c = scanMonths.get(userId);
    return !c || c.month !== monthKey() ? FREE_SCANS : Math.max(0, FREE_SCANS - c.used);
  }
  return Math.max(0, TRIAL_SCANS - (trialScans.get(deviceId || "unknown") ?? 0));
}

async function persistScanCount(userId: string, c: { month: string; used: number }): Promise<void> {
  const p = await pgPool();
  if (!p) return;
  await p.query(`update users set scan_month = $2, scans_used = $3 where id = $1`, [userId, c.month, c.used]);
}

// ---- holdings sync -----------------------------------------------------------

export function getHoldings(userId: string): Holding[] {
  return holdingsByUser.get(userId) ?? [];
}

/** Replace the user's holdings wholesale — the app pushes its full collection
 *  (from localStorage) and the server becomes the source of truth. */
export async function putHoldings(userId: string, incoming: unknown): Promise<Holding[] | { error: string }> {
  if (!Array.isArray(incoming)) return { error: "expected an array of holdings" };
  const clean: Holding[] = [];
  for (const h of incoming) {
    if (!h || typeof h !== "object" || typeof (h as any).cardId !== "string") continue;
    const x = h as any;
    const isUuid = typeof x.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.id);
    clean.push({
      id: isUuid ? x.id : randomUUID(), // app-local ids aren't uuids; mint one
      cardId: x.cardId,
      lang: typeof x.lang === "string" ? x.lang : "EN",
      grade: typeof x.grade === "string" ? x.grade : null,
      cost: Number.isFinite(x.cost) ? Math.round(x.cost) : null,
      acquired: typeof x.acquired === "string" ? x.acquired : new Date().toISOString(),
      soldAt: typeof x.soldAt === "string" ? x.soldAt : null,
      soldPrice: Number.isFinite(x.soldPrice) ? Math.round(x.soldPrice) : null,
    });
  }
  holdingsByUser.set(userId, clean);
  const p = await pgPool();
  if (p) {
    const client = await p.connect().catch(() => null);
    if (client) {
      try {
        await client.query("begin");
        await client.query(`delete from holdings where user_id = $1`, [userId]);
        for (const h of clean) {
          await client.query(
            `insert into holdings (id, user_id, card_id, lang, grade, cost, acquired, sold_at, sold_price)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [h.id, userId, h.cardId, h.lang, h.grade, h.cost, h.acquired, h.soldAt, h.soldPrice]
          );
        }
        await client.query("commit");
      } catch (e) {
        await client.query("rollback").catch(() => {});
        console.error("holdings persist failed:", e);
      } finally {
        client.release();
      }
    }
  }
  return clean;
}
