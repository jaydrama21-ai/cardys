// In-memory catalog store with an optional Postgres swap.
// Dev runs entirely in memory seeded from mock.ts. When DATABASE_URL is set and
// you've run the ingest job, replace these bodies with SQL reads (schema.sql).

import type { Card, CardSet, Product, Lang } from "./types.js";
import { CARDS, SETS, PRODUCTS } from "./mock.js";

let cards: Card[] = [...CARDS];
let sets: CardSet[] = [...SETS];
let products: Product[] = [...PRODUCTS];
let byId = new Map(cards.map((c) => [c.id, c]));

/** Called by the ingest job to replace the in-memory catalog. */
export function loadCatalog(next: { cards: Card[]; sets: CardSet[]; products: Product[] }) {
  cards = next.cards;
  sets = next.sets;
  products = next.products;
  byId = new Map(cards.map((c) => [c.id, c]));
}

export const db = {
  cards: () => cards,
  sets: () => sets,
  products: () => products,
  cardById: (id: string): Card | null => byId.get(id) ?? null,
  cardByName: (name: string): Card | null => cards.find((c) => c.name === name) ?? null,

  searchCards: (query: string, lang: Lang | "All"): Card[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return cards.filter((c) => {
      if (lang !== "All" && !c.langs.includes(lang)) return false;
      return (
        c.name.toLowerCase().includes(q) ||
        c.set.toLowerCase().includes(q) ||
        c.variant.toLowerCase().includes(q) ||
        c.num.toLowerCase().includes(q)
      );
    });
  },
  searchProducts: (query: string): Product[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.set.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q)
    );
  },
};
