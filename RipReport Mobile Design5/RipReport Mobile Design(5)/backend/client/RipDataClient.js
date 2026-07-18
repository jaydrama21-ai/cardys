// RipDataClient — the browser-side implementation of the RipDataService seam.
// Drop this into the RipReport app and point the DATA SEAM methods at it.
//
// The app's seam is SYNCHRONOUS (cardById/priceRaw/... return values, not
// promises). So we PRELOAD the catalog once at boot, then serve every read
// synchronously from memory. Real per-card comps are fetched lazily and cached;
// until a card's comps arrive we fall back to the modelled price (identical to
// today), so nothing ever blocks the UI.
//
// Usage in RipReport.dc.html:
//   1. constructor:  this.rip = new RipDataClient('https://your-backend');
//   2. componentDidMount:  await this.rip.bootstrap(); this.forceUpdate();
//   3. replace the DATA SEAM bodies:
//        cardById(id){ return this.rip.cardById(id); }
//        priceRaw(c,l){ return this.rip.priceRaw(c,l); }
//        priceGraded(c,co,g,l){ return this.rip.priceGraded(c,co,g,l); }
//        gradedAbs(c,g){ return this.rip.gradedAbs(c,g); }
//        histFor(end,chg){ return this.rip.histFor(end,chg); }
//        (search screen) this.rip.searchCards(q, lang)
//   4. scan:  const { card } = await this.rip.recognize(base64Frame);

const GRADE_BASE = { 10: 5, 9.5: 3.4, 9: 2, 8: 1.3 };
const COMPANY_FACTOR = { PSA: 1.0, BGS: 1.15, CGC: 0.92, SGC: 0.9, TAG: 0.85 };
const LANG_MULT = { EN: 1.0, JP: 0.9, KR: 0.75, ZH: 0.7 };

export class RipDataClient {
  constructor(baseUrl) {
    this.base = String(baseUrl || "").replace(/\/$/, "");
    this._cards = [];
    this._sets = [];
    this._products = [];
    this._byId = new Map();
    this._priceCache = new Map(); // id -> { raw?, graded: {key:val}, hist? }
    this.ready = false;
  }

  // --- one-time preload of the catalog ---
  async bootstrap() {
    const [cards, sets, products] = await Promise.all([
      fetch(`${this.base}/cards`).then((r) => r.json()),
      fetch(`${this.base}/sets`).then((r) => r.json()),
      fetch(`${this.base}/products`).then((r) => r.json()),
    ]);
    this._cards = cards;
    this._sets = sets;
    this._products = products;
    this._byId = new Map(cards.map((c) => [c.id, c]));
    this.ready = true;
    return this;
  }

  // --- catalog (sync) ---
  cards() { return this._cards; }
  sets() { return this._sets; }
  products() { return this._products; }
  cardById(id) { return this._byId.get(id) || null; }
  cardByName(name) { return this._cards.find((c) => c.name === name) || null; }

  searchCards(query, lang) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return [];
    return this._cards.filter((c) => {
      if (lang && lang !== "All" && !(c.langs || []).includes(lang)) return false;
      return (
        c.name.toLowerCase().includes(q) ||
        c.set.toLowerCase().includes(q) ||
        (c.variant || "").toLowerCase().includes(q) ||
        (c.num || "").toLowerCase().includes(q)
      );
    });
  }
  searchProducts(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return [];
    return this._products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.set.toLowerCase().includes(q) ||
        (p.type || "").toLowerCase().includes(q)
    );
  }

  // --- pricing (sync; cache-first, modelled fallback) ---
  priceRaw(card, lang) {
    const cached = this._priceCache.get(card.id);
    if (cached && cached.raw != null) return Math.round(cached.raw * LANG_MULT[lang]);
    this._warm(card.id); // fire-and-forget; fills the cache for next render
    return Math.round(card.raw * LANG_MULT[lang]);
  }
  gradedAbs(card, grade) {
    const p10 = card.psa10 != null ? card.psa10 : Math.round(card.raw * GRADE_BASE[10]);
    return Math.round(p10 * (GRADE_BASE[grade] / GRADE_BASE[10]));
  }
  priceGraded(card, company, grade, lang) {
    const cached = this._priceCache.get(card.id);
    const key = `${company}-${grade}-${lang}`;
    if (cached && cached.graded && cached.graded[key] != null) return cached.graded[key];
    this._warm(card.id);
    return Math.round(this.gradedAbs(card, grade) * COMPANY_FACTOR[company] * LANG_MULT[lang]);
  }
  histFor(end, chgPct) {
    const n = 14, start = end / (1 + chgPct / 100), out = [];
    for (let i = 0; i < n; i++) out.push(Math.round(start + (end - start) * (i / (n - 1))));
    out[n - 1] = Math.round(end);
    return out;
  }

  // lazily fetch real comps for one card and cache them
  async _warm(id) {
    if (this._priceCache.has(id) || this._warming?.has?.(id)) return;
    (this._warming ||= new Set()).add(id);
    try {
      const raw = await fetch(`${this.base}/price/raw/${id}?lang=EN`).then((r) => r.json());
      this._priceCache.set(id, { raw: raw.price, graded: {} });
    } catch {
      /* keep modelled fallback */
    } finally {
      this._warming.delete(id);
    }
  }

  // --- recognition ---
  async recognize(imageBase64) {
    const r = await fetch(`${this.base}/recognize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageBase64 }),
    });
    return r.json(); // { id, confidence, card }
  }
}
