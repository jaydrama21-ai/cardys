// Accounts + holdings sync (feed 4). Email/password auth with scrypt hashes
// and bearer-token sessions; holdings move off the device's localStorage so a
// collection follows the user across devices.
//
// Storage follows the catalog pattern: works fully in-memory with zero config,
// and persists through Postgres (users/sessions/holdings in schema.sql) when
// DATABASE_URL is set. Every path is fallback-safe and never throws.
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
// ---- password hashing --------------------------------------------------------
function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash)
        return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
// ---- in-memory store (always the fast path; PG mirrors it when configured) ---
const usersByEmail = new Map();
const usersById = new Map();
const sessions = new Map(); // token -> userId
const holdingsByUser = new Map();
// ---- optional Postgres mirror ------------------------------------------------
async function pgPool() {
    if (!process.env.DATABASE_URL)
        return null;
    try {
        const { default: pg } = await import("pg");
        // Reuse one pool via a module-global on the function.
        const self = pgPool;
        if (!self._pool)
            self._pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
        return self._pool;
    }
    catch {
        return null;
    }
}
/** Warm the in-memory maps from Postgres on boot. */
export async function warmAccounts() {
    const p = await pgPool();
    if (!p)
        return;
    try {
        const users = await p.query(`select id, email, password_hash from users where email is not null`);
        for (const r of users.rows) {
            const u = { id: r.id, email: r.email, passwordHash: r.password_hash ?? "" };
            usersByEmail.set(u.email, u);
            usersById.set(u.id, u);
        }
        const sess = await p.query(`select token, user_id from sessions`);
        for (const r of sess.rows)
            sessions.set(r.token, r.user_id);
        const holds = await p.query(`select id, user_id, card_id, lang, grade, cost, acquired, sold_at, sold_price from holdings`);
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
        if (users.rows.length)
            console.log(`Accounts warmed: ${users.rows.length} users.`);
    }
    catch (e) {
        console.error("accounts warm failed:", e);
    }
}
// ---- auth --------------------------------------------------------------------
export async function register(email, password) {
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))
        return { error: "invalid email" };
    if (password.length < 8)
        return { error: "password must be at least 8 characters" };
    if (usersByEmail.has(em))
        return { error: "account already exists" };
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
            .catch((e) => console.error("user persist failed:", e));
    }
    const token = await issueToken(user.id);
    return { token, user: { id: user.id, email: em } };
}
export async function login(email, password) {
    const u = usersByEmail.get(email.trim().toLowerCase());
    if (!u || !u.passwordHash || !verifyPassword(password, u.passwordHash)) {
        return { error: "invalid email or password" };
    }
    const token = await issueToken(u.id);
    return { token, user: { id: u.id, email: u.email } };
}
async function issueToken(userId) {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, userId);
    const p = await pgPool();
    if (p) {
        await p
            .query(`insert into sessions (token, user_id) values ($1,$2)`, [token, userId])
            .catch((e) => console.error("session persist failed:", e));
    }
    return token;
}
/** Resolve a Bearer token to a user, or null. */
export function userForToken(authHeader) {
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token)
        return null;
    const userId = sessions.get(token);
    const u = userId ? usersById.get(userId) : null;
    return u ? { id: u.id, email: u.email } : null;
}
// ---- holdings sync -----------------------------------------------------------
export function getHoldings(userId) {
    return holdingsByUser.get(userId) ?? [];
}
/** Replace the user's holdings wholesale — the app pushes its full collection
 *  (from localStorage) and the server becomes the source of truth. */
export async function putHoldings(userId, incoming) {
    if (!Array.isArray(incoming))
        return { error: "expected an array of holdings" };
    const clean = [];
    for (const h of incoming) {
        if (!h || typeof h !== "object" || typeof h.cardId !== "string")
            continue;
        const x = h;
        clean.push({
            id: typeof x.id === "string" && x.id ? x.id : randomUUID(),
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
                    await client.query(`insert into holdings (id, user_id, card_id, lang, grade, cost, acquired, sold_at, sold_price)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [h.id, userId, h.cardId, h.lang, h.grade, h.cost, h.acquired, h.soldAt, h.soldPrice]);
                }
                await client.query("commit");
            }
            catch (e) {
                await client.query("rollback").catch(() => { });
                console.error("holdings persist failed:", e);
            }
            finally {
                client.release();
            }
        }
    }
    return clean;
}
