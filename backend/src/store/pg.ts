// Optional Postgres persistence for the catalog + price cache (schema.sql).
// Active only when DATABASE_URL is set; every function is fallback-safe and
// never throws — on any failure the app keeps running on the in-memory store.

import type { Card, CardSet } from "../types.js";

export type PriceCompRow = {
  cardId: string;
  kind: string; // 'raw' | 'psa10' | 'psa9' | ...
  value: number; // whole USD
  source: string;
  comps: number;
  lastSoldAt: Date | null;
};

let pool: any = null;

export function pgAvailable(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

async function getPool(): Promise<any | null> {
  if (!pgAvailable()) return null;
  if (pool) return pool;
  try {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    return pool;
  } catch (e) {
    console.error("pg unavailable (is the `pg` package installed?):", e);
    return null;
  }
}

/** Apply schema.sql (idempotent — everything is `create ... if not exists`). */
export async function initSchema(): Promise<boolean> {
  const p = await getPool();
  if (!p) return false;
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    // Running from src/ the schema sits next to us; from dist/ it lives in
    // src/ (tsc doesn't copy .sql, and the build's cp is belt-and-braces).
    const candidates = [
      join(here, "..", "schema.sql"),
      join(here, "..", "..", "src", "schema.sql"),
    ];
    const path = candidates.find((c) => existsSync(c));
    if (!path) throw new Error(`schema.sql not found (tried ${candidates.join(", ")})`);
    await p.query(readFileSync(path, "utf8"));
    return true;
  } catch (e) {
    console.error("schema init failed:", e);
    return false;
  }
}

/** Read the persisted catalog. Returns null when empty or unavailable. */
export async function loadCatalogFromPg(): Promise<{ cards: Card[]; sets: CardSet[] } | null> {
  const p = await getPool();
  if (!p) return null;
  try {
    const setsQ = await p.query(`select code, name, released from sets order by released desc`);
    const cardsQ = await p.query(
      `select id, name, "set", num, rarity, variant, tier, chase, langs, raw, psa10, chg, img, img2 from cards`
    );
    if (!cardsQ.rows.length) return null;
    const cards: Card[] = cardsQ.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      set: r.set,
      num: r.num ?? "",
      rarity: r.rarity ?? "Common",
      variant: r.variant ?? "",
      tier: r.tier,
      chase: r.chase ?? false,
      langs: r.langs ?? ["EN"],
      raw: r.raw,
      psa10: r.psa10 ?? undefined,
      chg: r.chg,
      img: r.img ?? undefined,
      img2: r.img2 ?? undefined,
    }));
    const sets: CardSet[] = setsQ.rows.map((r: any) => ({
      code: r.code,
      name: r.name,
      released: r.released ?? "",
    }));
    return { cards, sets };
  } catch (e) {
    console.error("catalog read from Postgres failed:", e);
    return null;
  }
}

/** Upsert the fetched catalog so it survives restarts. */
export async function saveCatalogToPg(cards: Card[], sets: CardSet[]): Promise<boolean> {
  const p = await getPool();
  if (!p) return false;
  const client = await p.connect().catch(() => null);
  if (!client) return false;
  try {
    await client.query("begin");
    for (const s of sets) {
      await client.query(
        `insert into sets (code, name, released) values ($1, $2, $3)
         on conflict (code) do update set name = excluded.name, released = excluded.released`,
        [s.code, s.name, s.released]
      );
    }
    // Multi-row upserts, 500 cards per statement — the full ~19k-card catalog
    // persists in seconds instead of one round trip per card.
    const CHUNK = 500;
    for (let i = 0; i < cards.length; i += CHUNK) {
      const chunk = cards.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const rows = chunk.map((c, j) => {
        values.push(c.id, c.name, c.set, c.num, c.rarity, c.variant, c.tier, c.chase ?? false, c.langs, c.raw, c.psa10 ?? null, c.chg, c.img ?? null, c.img2 ?? null);
        const o = j * 14;
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12},$${o + 13},$${o + 14})`;
      });
      await client.query(
        `insert into cards (id, name, "set", num, rarity, variant, tier, chase, langs, raw, psa10, chg, img, img2)
         values ${rows.join(",")}
         on conflict (id) do update set
           name = excluded.name, "set" = excluded."set", num = excluded.num,
           rarity = excluded.rarity, variant = excluded.variant, tier = excluded.tier,
           chase = excluded.chase, langs = excluded.langs, raw = excluded.raw,
           psa10 = coalesce(excluded.psa10, cards.psa10), chg = excluded.chg,
           img = coalesce(excluded.img, cards.img), img2 = coalesce(excluded.img2, cards.img2)`,
        values
      );
    }
    await client.query("commit");
    return true;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("catalog save to Postgres failed:", e);
    return false;
  } finally {
    client.release();
  }
}

/** Upsert one price-comp row (feeds the app's provenance UI). */
export async function savePriceComp(row: PriceCompRow): Promise<boolean> {
  const p = await getPool();
  if (!p) return false;
  try {
    await p.query(
      `insert into price_comps (card_id, kind, value, source, comps, last_sold_at, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (card_id, kind) do update set
         value = excluded.value, source = excluded.source, comps = excluded.comps,
         last_sold_at = excluded.last_sold_at, updated_at = now()`,
      [row.cardId, row.kind, row.value, row.source, row.comps, row.lastSoldAt]
    );
    return true;
  } catch (e) {
    console.error("price comp save failed:", e);
    return false;
  }
}

/** Upsert today's history point for (card, kind) — one row per day. */
export async function savePriceHistoryPoint(cardId: string, kind: string, value: number): Promise<boolean> {
  const p = await getPool();
  if (!p) return false;
  try {
    await p.query(
      `insert into price_history (card_id, kind, day, value) values ($1,$2, current_date, $3)
       on conflict (card_id, kind, day) do update set value = excluded.value`,
      [cardId, kind, value]
    );
    return true;
  } catch (e) {
    console.error("price history save failed:", e);
    return false;
  }
}

/** Batched daily history upsert — one statement per 500 rows. */
export async function batchSavePriceHistory(rows: { cardId: string; kind: string; value: number }[]): Promise<void> {
  const p = await getPool();
  if (!p) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((r, j) => {
      values.push(r.cardId, r.kind, r.value);
      const o = j * 3;
      return `($${o + 1},$${o + 2}, current_date, $${o + 3})`;
    });
    try {
      await p.query(
        `insert into price_history (card_id, kind, day, value) values ${tuples.join(",")}
         on conflict (card_id, kind, day) do update set value = excluded.value`,
        values
      );
    } catch (e) {
      console.error("price history batch failed:", e);
      return;
    }
  }
}

/** Read all stored daily series, keyed "cardId kind", oldest → newest. */
export async function loadPriceHistoryFromPg(): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const p = await getPool();
  if (!p) return out;
  try {
    const q = await p.query(
      `select card_id, kind, value from price_history order by card_id, kind, day asc`
    );
    for (const r of q.rows) {
      const k = `${r.card_id} ${r.kind}`;
      const arr = out.get(k) ?? [];
      arr.push(r.value);
      out.set(k, arr);
    }
    return out;
  } catch {
    return out;
  }
}

/** Read all cached price comps (server boot → warm the in-memory cache). */
export async function loadPriceCompsFromPg(): Promise<PriceCompRow[]> {
  const p = await getPool();
  if (!p) return [];
  try {
    const q = await p.query(
      `select card_id, kind, value, source, comps, last_sold_at from price_comps`
    );
    return q.rows.map((r: any) => ({
      cardId: r.card_id,
      kind: r.kind,
      value: r.value,
      source: r.source,
      comps: r.comps,
      lastSoldAt: r.last_sold_at,
    }));
  } catch {
    return [];
  }
}
