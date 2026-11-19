// Persistence. Postgres when DATABASE_URL is set, else a JSON file (dev, tests).
//
// Privacy by design (matches "Privacy" and "Delete My Data" on the canvas):
//   - anon_users / alerts are the ONLY rows tied to a person (a random token).
//     Delete My Data removes both.
//   - slab_results, feedback, helpful, training rows carry NO user id, device
//     id, IP, location or timestamp finer than the day. They can't be traced
//     back, so they can't be deleted per person — the app says so.

import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export type AnonUser = { id: string; tokenHash: string; createdDay: string; under13: boolean; push: any | null };
export type Alert = { userId: string; cardId: string; base: number; lastNotifiedDay: string | null };
export type SlabResult = {
  day: string;              // YYYY-MM-DD the result was saved
  grader: string; grade: string; tier: string | null;
  cardId: string | null; holo: boolean;
  estimate: { mostLikely: string | null; probs: Record<string, number> | null; centeringCap: string | null } | null;
  features: number[] | null; // shared/model.js FEATURE_NAMES order
  sentOn: string | null; returnedOn: string | null; // YYYY-MM-DD
  soldFor: number | null;
  modelVersion: string | null;
};
export type Feedback = { day: string; kind: string; text: string; screen: string; version: string };
export type Helpful = { day: string; screen: string; yes: boolean };
export type TrainingRow = { day: string; file: string; grader: string; grade: string; side: string; slot: string };

export interface Store {
  init(): Promise<void>;
  createAnon(under13: boolean): Promise<{ user: AnonUser; token: string }>;
  userForToken(token: string | undefined): Promise<AnonUser | null>;
  setUnder13(id: string, under13: boolean): Promise<void>;
  setPush(id: string, sub: any | null): Promise<void>;
  deleteUser(id: string): Promise<void>;
  putAlert(a: Alert): Promise<void>;
  deleteAlert(userId: string, cardId: string): Promise<void>;
  alertsFor(userId: string): Promise<Alert[]>;
  allAlerts(): Promise<Alert[]>;
  markNotified(userId: string, cardId: string, day: string): Promise<void>;
  users(): Promise<AnonUser[]>;
  addSlabResult(r: SlabResult): Promise<void>;
  slabResults(): Promise<SlabResult[]>;
  addFeedback(f: Feedback): Promise<void>;
  addHelpful(h: Helpful): Promise<void>;
  addTraining(t: TrainingRow): Promise<void>;
  counts(): Promise<Record<string, number>>;
}

export const today = () => new Date().toISOString().slice(0, 10);
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const bearer = (h?: string) => (h && h.startsWith("Bearer ") ? h.slice(7) : h || "");

// ---------------------------------------------------------------- file store
type FileShape = {
  users: AnonUser[]; alerts: Alert[]; slabResults: SlabResult[];
  feedback: Feedback[]; helpful: Helpful[]; training: TrainingRow[];
};

export class FileStore implements Store {
  private d: FileShape = { users: [], alerts: [], slabResults: [], feedback: [], helpful: [], training: [] };
  constructor(private path: string) {}
  async init() {
    if (existsSync(this.path)) this.d = { ...this.d, ...JSON.parse(readFileSync(this.path, "utf8")) };
    else { mkdirSync(dirname(this.path), { recursive: true }); this.save(); }
  }
  private save() {
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.d));
    renameSync(tmp, this.path);
  }
  async createAnon(under13: boolean) {
    const token = randomBytes(24).toString("base64url");
    const user: AnonUser = { id: randomBytes(9).toString("hex"), tokenHash: hash(token), createdDay: today(), under13, push: null };
    this.d.users.push(user); this.save();
    return { user, token };
  }
  async userForToken(h: string | undefined) {
    const t = bearer(h); if (!t) return null;
    const th = hash(t);
    return this.d.users.find((u) => u.tokenHash === th) ?? null;
  }
  async setUnder13(id: string, v: boolean) { const u = this.d.users.find((x) => x.id === id); if (u) { u.under13 = v; this.save(); } }
  async setPush(id: string, sub: any) { const u = this.d.users.find((x) => x.id === id); if (u) { u.push = sub; this.save(); } }
  async deleteUser(id: string) {
    this.d.users = this.d.users.filter((u) => u.id !== id);
    this.d.alerts = this.d.alerts.filter((a) => a.userId !== id);
    this.save();
  }
  async putAlert(a: Alert) {
    this.d.alerts = this.d.alerts.filter((x) => !(x.userId === a.userId && x.cardId === a.cardId));
    this.d.alerts.push(a); this.save();
  }
  async deleteAlert(userId: string, cardId: string) {
    this.d.alerts = this.d.alerts.filter((x) => !(x.userId === userId && x.cardId === cardId)); this.save();
  }
  async alertsFor(userId: string) { return this.d.alerts.filter((a) => a.userId === userId); }
  async allAlerts() { return [...this.d.alerts]; }
  async markNotified(userId: string, cardId: string, day: string) {
    const a = this.d.alerts.find((x) => x.userId === userId && x.cardId === cardId); if (a) { a.lastNotifiedDay = day; this.save(); }
  }
  async users() { return [...this.d.users]; }
  async addSlabResult(r: SlabResult) { this.d.slabResults.push(r); this.save(); }
  async slabResults() { return [...this.d.slabResults]; }
  async addFeedback(f: Feedback) { this.d.feedback.push(f); this.save(); }
  async addHelpful(h: Helpful) { this.d.helpful.push(h); this.save(); }
  async addTraining(t: TrainingRow) { this.d.training.push(t); this.save(); }
  async counts() {
    return Object.fromEntries(Object.entries(this.d).map(([k, v]) => [k, (v as unknown[]).length]));
  }
}

// ------------------------------------------------------------ postgres store
export class PgStore implements Store {
  private pool: any;
  constructor(private url: string) {}
  async init() {
    const pg = await import("pg");
    this.pool = new pg.default.Pool({ connectionString: this.url, ssl: /localhost|127\.0\.0\.1/.test(this.url) ? false : { rejectUnauthorized: false } });
    await this.pool.query(`
      create table if not exists gr_users (id text primary key, token_hash text unique not null, created_day date not null, under13 boolean not null default false, push jsonb);
      create table if not exists gr_alerts (user_id text not null references gr_users(id) on delete cascade, card_id text not null, base numeric not null, last_notified_day date, primary key (user_id, card_id));
      create table if not exists gr_slab_results (id bigserial primary key, day date not null, data jsonb not null);
      create table if not exists gr_feedback (id bigserial primary key, day date not null, kind text, text text, screen text, version text);
      create table if not exists gr_helpful (id bigserial primary key, day date not null, screen text, yes boolean);
      create table if not exists gr_training (id bigserial primary key, day date not null, file text, grader text, grade text, side text, slot text);
    `);
  }
  private q(sql: string, args: unknown[] = []) { return this.pool.query(sql, args); }
  private mapUser = (r: any): AnonUser => ({ id: r.id, tokenHash: r.token_hash, createdDay: String(r.created_day).slice(0, 10), under13: r.under13, push: r.push });
  async createAnon(under13: boolean) {
    const token = randomBytes(24).toString("base64url");
    const user: AnonUser = { id: randomBytes(9).toString("hex"), tokenHash: hash(token), createdDay: today(), under13, push: null };
    await this.q("insert into gr_users (id, token_hash, created_day, under13) values ($1,$2,$3,$4)", [user.id, user.tokenHash, user.createdDay, under13]);
    return { user, token };
  }
  async userForToken(h: string | undefined) {
    const t = bearer(h); if (!t) return null;
    const r = await this.q("select * from gr_users where token_hash = $1", [hash(t)]);
    return r.rows[0] ? this.mapUser(r.rows[0]) : null;
  }
  async setUnder13(id: string, v: boolean) { await this.q("update gr_users set under13 = $2 where id = $1", [id, v]); }
  async setPush(id: string, sub: any) { await this.q("update gr_users set push = $2 where id = $1", [id, sub]); }
  async deleteUser(id: string) { await this.q("delete from gr_users where id = $1", [id]); }
  async putAlert(a: Alert) {
    await this.q(`insert into gr_alerts (user_id, card_id, base, last_notified_day) values ($1,$2,$3,$4)
      on conflict (user_id, card_id) do update set base = excluded.base, last_notified_day = excluded.last_notified_day`,
      [a.userId, a.cardId, a.base, a.lastNotifiedDay]);
  }
  async deleteAlert(u: string, c: string) { await this.q("delete from gr_alerts where user_id = $1 and card_id = $2", [u, c]); }
  private mapAlert = (r: any): Alert => ({ userId: r.user_id, cardId: r.card_id, base: Number(r.base), lastNotifiedDay: r.last_notified_day ? String(r.last_notified_day).slice(0, 10) : null });
  async alertsFor(u: string) { return (await this.q("select * from gr_alerts where user_id = $1", [u])).rows.map(this.mapAlert); }
  async allAlerts() { return (await this.q("select * from gr_alerts")).rows.map(this.mapAlert); }
  async markNotified(u: string, c: string, day: string) { await this.q("update gr_alerts set last_notified_day = $3 where user_id = $1 and card_id = $2", [u, c, day]); }
  async users() { return (await this.q("select * from gr_users")).rows.map(this.mapUser); }
  async addSlabResult(r: SlabResult) { await this.q("insert into gr_slab_results (day, data) values ($1, $2)", [r.day, r]); }
  async slabResults() { return (await this.q("select data from gr_slab_results")).rows.map((r: any) => r.data); }
  async addFeedback(f: Feedback) { await this.q("insert into gr_feedback (day, kind, text, screen, version) values ($1,$2,$3,$4,$5)", [f.day, f.kind, f.text, f.screen, f.version]); }
  async addHelpful(h: Helpful) { await this.q("insert into gr_helpful (day, screen, yes) values ($1,$2,$3)", [h.day, h.screen, h.yes]); }
  async addTraining(t: TrainingRow) { await this.q("insert into gr_training (day, file, grader, grade, side, slot) values ($1,$2,$3,$4,$5,$6)", [t.day, t.file, t.grader, t.grade, t.side, t.slot]); }
  async counts() {
    const out: Record<string, number> = {};
    for (const t of ["gr_users", "gr_alerts", "gr_slab_results", "gr_feedback", "gr_helpful", "gr_training"]) {
      out[t] = Number((await this.q(`select count(*)::int as n from ${t}`)).rows[0].n);
    }
    return out;
  }
}

export function makeStore(): Store {
  if (process.env.DATABASE_URL) return new PgStore(process.env.DATABASE_URL);
  return new FileStore(process.env.STORE_FILE || new URL("../data/store.json", import.meta.url).pathname);
}
