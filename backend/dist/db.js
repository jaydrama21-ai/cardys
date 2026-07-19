// In-memory catalog store with an optional Postgres swap.
// Dev runs entirely in memory seeded from mock.ts. When DATABASE_URL is set and
// you've run the ingest job, replace these bodies with SQL reads (schema.sql).
import { CARDS, SETS, PRODUCTS } from "./mock.js";
let cards = [...CARDS];
let sets = [...SETS];
let products = [...PRODUCTS];
let byId = new Map(cards.map((c) => [c.id, c]));
/** Called by the ingest job to replace the in-memory catalog. */
export function loadCatalog(next) {
    cards = next.cards;
    sets = next.sets;
    products = next.products;
    byId = new Map(cards.map((c) => [c.id, c]));
}
export const db = {
    cards: () => cards,
    sets: () => sets,
    products: () => products,
    cardById: (id) => byId.get(id) ?? null,
    cardByName: (name) => cards.find((c) => c.name === name) ?? null,
    searchCards: (query, lang) => {
        const q = query.trim().toLowerCase();
        if (!q)
            return [];
        return cards.filter((c) => {
            if (lang !== "All" && !c.langs.includes(lang))
                return false;
            return (c.name.toLowerCase().includes(q) ||
                c.set.toLowerCase().includes(q) ||
                c.variant.toLowerCase().includes(q) ||
                c.num.toLowerCase().includes(q));
        });
    },
    searchProducts: (query) => {
        const q = query.trim().toLowerCase();
        if (!q)
            return [];
        return products.filter((p) => p.name.toLowerCase().includes(q) ||
            p.set.toLowerCase().includes(q) ||
            p.type.toLowerCase().includes(q));
    },
};
