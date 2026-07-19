-- RipReport — Postgres schema (optional; dev runs in-memory).
-- Run against your DATABASE_URL, then have db.ts read from these tables and the
-- ingest/refresh jobs write to them.

create table if not exists sets (
  code      text primary key,
  name      text not null unique,
  released  text
);

create table if not exists cards (
  id      text primary key,
  name    text not null,
  "set"   text not null references sets(name),
  num     text,
  rarity  text,
  variant text,
  tier    char(1) check (tier in ('A','B','C','D')),
  chase   boolean default false,
  langs   text[] not null default '{EN}',
  raw     integer not null default 0,   -- EN raw market, USD
  psa10   integer,                       -- PSA-10 comp, USD
  chg     real not null default 0,       -- 30d % change
  img     text                           -- card image URL (Pokémon TCG API images.large)
);
alter table cards add column if not exists img text;
create index if not exists cards_name_idx on cards using gin (to_tsvector('english', name));
create index if not exists cards_set_idx  on cards ("set");

create table if not exists products (
  id     text primary key,
  name   text not null,
  "set"  text not null references sets(name),
  type   text,
  packs  integer not null default 1,
  msrp   integer,
  market integer
);

-- Per-comp price cache — one row per (card, kind). Drives priceMeta() provenance:
-- source, comp count, last-sold time, freshness.
create table if not exists price_comps (
  card_id      text not null references cards(id),
  kind         text not null,            -- 'raw' | 'psa10' | 'psa9' | 'cgc10' | ...
  value        integer not null,         -- whole USD
  source       text not null,            -- 'eBay sold' | 'TCGplayer' | 'PriceCharting'
  comps        integer not null default 0,
  last_sold_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (card_id, kind)
);

-- Daily price history for the detail sparkline (last point === current value).
create table if not exists price_history (
  card_id text not null references cards(id),
  kind    text not null default 'raw',
  day     date not null,
  value   integer not null,
  primary key (card_id, kind, day)
);

-- Per-user collection (move holdings off the device once you add auth).
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  password_hash text,                     -- scrypt salt:hash
  created_at    timestamptz not null default now()
);
alter table users add column if not exists password_hash text;

-- Bearer-token sessions (issued by /auth/register + /auth/login).
create table if not exists sessions (
  token      text primary key,
  user_id    uuid not null references users(id),
  created_at timestamptz not null default now()
);
create table if not exists holdings (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references users(id),
  card_id   text not null,  -- app catalog id; not FK'd so holdings can sync before ingest
  lang      text not null default 'EN',
  grade     text,                        -- null = raw
  cost      integer,                     -- acquisition cost basis, USD
  acquired  timestamptz not null default now(),
  sold_at   timestamptz,
  sold_price integer
);
