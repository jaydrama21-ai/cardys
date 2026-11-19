// On-device photo analysis: photo checks (blur, exposure, glare) and centering
// measurement. Runs in the browser (canvas ImageData) and in Node tests — the
// input is any { width, height, data } with RGBA bytes.
//
// Photos never leave the phone for this: everything here is plain math on the
// pixels the camera produced.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Box-downscale so the longest side is <= maxDim (keeps analysis fast). */
export function downscale(img, maxDim = 640) {
  const { width: w, height: h, data } = img;
  const s = Math.max(w, h) / maxDim;
  if (s <= 1) return img;
  const nw = Math.max(1, Math.round(w / s));
  const nh = Math.max(1, Math.round(h / s));
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * s), y1 = Math.min(h, Math.floor((y + 1) * s));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * s), x1 = Math.min(w, Math.floor((x + 1) * s));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * w + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      }
      const o = (y * nw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: nw, height: nh, data: out };
}

export function luminance(img) {
  const { width: w, height: h, data } = img;
  const L = new Float32Array(w * h);
  for (let i = 0, p = 0; p < L.length; i += 4, p++) L[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return L;
}

/**
 * Sharpness that doesn't depend on how busy or bright the card is: at the
 * strongest edges in the photo, compare the second derivative (Laplacian) to
 * the first (gradient). A crisp edge keeps them close (~100+); blur spreads
 * the edge and the ratio collapses (< 40). Flat card backs score fine as
 * long as their edges are crisp.
 */
export function sharpness(img, region = null) {
  const small = downscale(img, 1024);
  const L = luminance(small);
  const w = small.width, h = small.height;
  const r = region ? scaleRect(region, img, small) : { left: 0, top: 0, right: w, bottom: h };
  const x0 = Math.max(1, r.left - 4), x1 = Math.min(w - 1, r.right + 4);
  const y0 = Math.max(1, r.top - 4), y1 = Math.min(h - 1, r.bottom + 4);
  const G = new Float32Array(w * h);
  const sample = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = y * w + x;
    G[p] = Math.hypot((L[p + 1] - L[p - 1]) / 2, (L[p + w] - L[p - w]) / 2);
    if ((x + y) % 7 === 0) sample.push(G[p]);
  }
  if (!sample.length) return 0;
  sample.sort((a, b) => a - b);
  const T = Math.max(3, sample[Math.floor(sample.length * 0.985)]);
  let sl = 0, sg = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = y * w + x;
    if (G[p] < T) continue;
    sl += Math.abs(L[p - 1] + L[p + 1] + L[p - w] + L[p + w] - 4 * L[p]);
    sg += G[p]; n++;
  }
  return n < 30 ? 0 : (100 * sl) / sg;
}

function scaleRect(r, from, to) {
  const sx = to.width / from.width, sy = to.height / from.height;
  return {
    left: Math.floor(r.left * sx), right: Math.ceil(r.right * sx),
    top: Math.floor(r.top * sy), bottom: Math.ceil(r.bottom * sy),
  };
}

/** Mean brightness and the share of blown-out / crushed pixels. */
export function exposure(img) {
  const L = luminance(downscale(img, 256));
  let sum = 0, hi = 0, lo = 0;
  for (const v of L) { sum += v; if (v >= 250) hi++; if (v <= 12) lo++; }
  return { mean: sum / L.length, clippedHigh: hi / L.length, clippedLow: lo / L.length };
}

const GRID_NAMES = [
  ["top left", "top", "top right"],
  ["left", "middle", "right"],
  ["bottom left", "bottom", "bottom right"],
];

/**
 * Glare: bright, colorless pixels bunched in one part of the card.
 * Returns { glare: bool, where: "top right" | null, worst: share }.
 */
export function glare(img, bounds = null) {
  const small = downscale(img, 320);
  const { width: w, height: h, data } = small;
  const r = bounds ? scaleRect(bounds, img, small) : { left: 0, top: 0, right: w, bottom: h };
  const cw = (r.right - r.left) / 3, ch = (r.bottom - r.top) / 3;
  const hits = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], tot = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let y = r.top; y < r.bottom; y++) {
    const gy = clamp(Math.floor((y - r.top) / ch), 0, 2);
    for (let x = r.left; x < r.right; x++) {
      const gx = clamp(Math.floor((x - r.left) / cw), 0, 2);
      const i = (y * w + x) * 4;
      const R = data[i], G = data[i + 1], B = data[i + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      tot[gy][gx]++;
      if (mn >= 240 && mx - mn <= 18) hits[gy][gx]++;
    }
  }
  let worst = 0, where = null;
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) {
    const share = tot[gy][gx] ? hits[gy][gx] / tot[gy][gx] : 0;
    if (share > worst) { worst = share; where = GRID_NAMES[gy][gx]; }
  }
  return { glare: worst >= 0.04, where: worst >= 0.04 ? where : null, worst };
}

// ---------------------------------------------------------------------------
// Edge finding. Cards are photographed roughly square to the camera, so we
// work with 1-D color profiles: the mean color of each column (over the middle
// rows) and each row (over the middle columns). An edge is a big jump between
// neighbouring profile samples.
// ---------------------------------------------------------------------------

function profiles(img, rect) {
  const { width: w, data } = img;
  const cols = [], rows = [];
  const y0 = Math.round(rect.top + (rect.bottom - rect.top) * 0.3);
  const y1 = Math.round(rect.top + (rect.bottom - rect.top) * 0.7);
  const x0 = Math.round(rect.left + (rect.right - rect.left) * 0.3);
  const x1 = Math.round(rect.left + (rect.right - rect.left) * 0.7);
  for (let x = rect.left; x < rect.right; x++) {
    let r = 0, g = 0, b = 0;
    for (let y = y0; y < y1; y++) { const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    const n = Math.max(1, y1 - y0); cols.push([r / n, g / n, b / n]);
  }
  for (let y = rect.top; y < rect.bottom; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    const n = Math.max(1, x1 - x0); rows.push([r / n, g / n, b / n]);
  }
  return { cols, rows };
}

function jumps(p, k = 2) {
  const out = new Float32Array(p.length);
  for (let i = k; i < p.length - k; i++) {
    const a = p[i - k], b = p[i + k];
    out[i] = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  return out;
}

function argmaxIn(arr, lo, hi) {
  lo = Math.max(0, Math.floor(lo)); hi = Math.min(arr.length - 1, Math.ceil(hi));
  let best = -1, at = -1;
  for (let i = lo; i <= hi; i++) if (arr[i] > best) { best = arr[i]; at = i; }
  return { at, value: best };
}

/**
 * Walk from `from` toward `to` and return the first local peak that is
 * clearly an edge: at least 35% of the strongest jump in the window and
 * 4× the typical jump. Falls back to the strongest jump.
 */
function firstStrong(arr, from, to, dir, base) {
  const lo = Math.max(1, Math.floor(Math.min(from, to))), hi = Math.min(arr.length - 2, Math.ceil(Math.max(from, to)));
  const best = argmaxIn(arr, lo, hi);
  const need = Math.max(best.value * 0.35, base * 4);
  const start = dir > 0 ? lo : hi, end = dir > 0 ? hi : lo;
  for (let i = start; dir > 0 ? i <= end : i >= end; i += dir) {
    if (arr[i] >= need && arr[i] >= arr[i - 1] && arr[i] >= arr[i + 1]) return { at: i, value: arr[i] };
  }
  return best;
}

function median(arr) {
  const s = Array.from(arr).filter((v) => v > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Outer card edges in image coordinates, plus a confidence 0..1.
 * Needs some background around the card (the capture brackets leave it).
 */
export function findCardBounds(img) {
  const small = downscale(img, 640);
  const W = small.width, H = small.height;
  const { cols, rows } = profiles(small, { left: 0, top: 0, right: W, bottom: H });
  const jc = jumps(cols), jr = jumps(rows);
  const base = Math.max(1, (median(jc) + median(jr)) / 2);
  // First strong edge in from each side of the frame = the card's edge (the
  // art box inside is often a bigger jump, so "strongest" would find that).
  const L = firstStrong(jc, 2, W * 0.35, +1, base), R = firstStrong(jc, W - 3, W * 0.65, -1, base);
  const T = firstStrong(jr, 2, H * 0.35, +1, base), B = firstStrong(jr, H - 3, H * 0.65, -1, base);
  const peaks = [L.value, R.value, T.value, B.value];
  const weakest = Math.min(...peaks);
  const confidence = clamp((weakest / base - 2) / 8, 0, 1);
  const s = img.width / W;
  const bounds = {
    left: Math.round(L.at * s), right: Math.round(R.at * s),
    top: Math.round(T.at * s), bottom: Math.round(B.at * s),
  };
  // A trading card is 63 × 88 mm (0.716). Way off → we found something else.
  const aspect = (bounds.right - bounds.left) / Math.max(1, bounds.bottom - bounds.top);
  const aspectOk = aspect > 0.6 && aspect < 0.85;
  const fill = ((bounds.right - bounds.left) * (bounds.bottom - bounds.top)) / (img.width * img.height);
  return { ...bounds, confidence: aspectOk ? confidence : confidence * 0.3, aspect, fill };
}

/**
 * Centering from one full-card photo.
 * Finds the outer edge, then the border/art boundary inside it, and measures
 * the border on each side. lr = left / (left + right), tb = top / (top + bottom).
 */
export function measureCentering(img, outer = null) {
  outer = outer || findCardBounds(img);
  const small = downscale(img, 1200);
  const s = img.width / small.width;
  const W = small.width, H = small.height;
  const coarse = {
    left: outer.left / s, right: outer.right / s, top: outer.top / s, bottom: outer.bottom / s,
  };
  if (coarse.right - coarse.left < 40 || coarse.bottom - coarse.top < 40) return null;
  // Forward differences: d[i] is the jump between sample i and i+1, so an edge
  // found at i sits exactly between those two pixels.
  const { cols, rows } = profiles(small, { left: 0, top: 0, right: W, bottom: H });
  const fwd = (p) => {
    const d = new Float32Array(p.length);
    for (let i = 0; i < p.length - 1; i++) d[i] = Math.hypot(p[i][0] - p[i + 1][0], p[i][1] - p[i + 1][1], p[i][2] - p[i + 1][2]);
    return d;
  };
  // Profiles over the card's middle band (not the whole frame) for accuracy.
  const band = profiles(small, {
    left: Math.max(0, Math.floor(coarse.left)), right: Math.min(W, Math.ceil(coarse.right)),
    top: Math.max(0, Math.floor(coarse.top)), bottom: Math.min(H, Math.ceil(coarse.bottom)),
  });
  const colsFull = cols.map((v, x) => {
    const bx = x - Math.max(0, Math.floor(coarse.left));
    return band.cols[bx] ?? v;
  });
  const rowsFull = rows.map((v, y) => {
    const by = y - Math.max(0, Math.floor(coarse.top));
    return band.rows[by] ?? v;
  });
  // Use band profiles for rows/cols but keep frame samples outside the card
  // so the outer edge jump is visible.
  for (let x = 0; x < W; x++) if (x < coarse.left - 1 || x > coarse.right + 1) colsFull[x] = colProfileAt(small, x, coarse);
  for (let y = 0; y < H; y++) if (y < coarse.top - 1 || y > coarse.bottom + 1) rowsFull[y] = rowProfileAt(small, y, coarse);
  const dc = fwd(colsFull), dr = fwd(rowsFull);
  const pad = 3 + 2 * Math.max(1, (img.width / 640) / s);
  // Refine outer edges near the coarse guess.
  const oL = argmaxIn(dc, coarse.left - pad - 1, coarse.left + pad).at;        // card starts at oL+1
  const oR = argmaxIn(dc, coarse.right - pad - 1, coarse.right + pad).at;      // card ends at oR
  const oT = argmaxIn(dr, coarse.top - pad - 1, coarse.top + pad).at;
  const oB = argmaxIn(dr, coarse.bottom - pad - 1, coarse.bottom + pad).at;
  const cw = oR - oL, ch = oB - oT;
  const lo = 0.012, hi = 0.16; // borders run ~1.5–16% of the card
  // The border ends at the FIRST strong edge coming in from the outside —
  // not the strongest one, which is often the art box or the name text.
  const base0 = Math.max(1, (median(dc) + median(dr)) / 2);
  const iL = firstStrong(dc, oL + 2 + cw * lo, oL + cw * hi, +1, base0);
  const iR = firstStrong(dc, oR - 2 - cw * lo, oR - cw * hi, -1, base0);
  const iT = firstStrong(dr, oT + 2 + ch * lo, oT + ch * hi, +1, base0);
  const iB = firstStrong(dr, oB - 2 - ch * lo, oB - ch * hi, -1, base0);
  const borders = { left: iL.at - oL, right: oR - iR.at, top: iT.at - oT, bottom: oB - iB.at };
  const base = Math.max(1, (median(dc) + median(dr)) / 2);
  const conf = clamp((Math.min(iL.value, iR.value, iT.value, iB.value) / base - 1.5) / 6, 0, 1) * (outer.confidence ?? 1);
  const lr = borders.left / Math.max(1, borders.left + borders.right);
  const tb = borders.top / Math.max(1, borders.top + borders.bottom);
  const up = (v) => Math.round(v * s);
  return {
    lr, tb,
    borders: { left: up(borders.left), right: up(borders.right), top: up(borders.top), bottom: up(borders.bottom) },
    inner: { left: up(iL.at + 1), right: up(iR.at), top: up(iT.at + 1), bottom: up(iB.at) },
    outer: { left: up(oL + 1), right: up(oR), top: up(oT + 1), bottom: up(oB) },
    confidence: conf,
  };
}

function colProfileAt(img, x, c) {
  const { width: w, data } = img;
  const y0 = Math.round(c.top + (c.bottom - c.top) * 0.3), y1 = Math.round(c.top + (c.bottom - c.top) * 0.7);
  let r = 0, g = 0, b = 0;
  for (let y = y0; y < y1; y++) { const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  const n = Math.max(1, y1 - y0); return [r / n, g / n, b / n];
}
function rowProfileAt(img, y, c) {
  const { width: w, data } = img;
  const x0 = Math.round(c.left + (c.right - c.left) * 0.3), x1 = Math.round(c.left + (c.right - c.left) * 0.7);
  let r = 0, g = 0, b = 0;
  for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  const n = Math.max(1, x1 - x0); return [r / n, g / n, b / n];
}

/**
 * Writing or stickers on the border: the border band should be close to one
 * flat color. Used only to skip training uploads (never blocks grading).
 */
export function borderMarks(img, c) {
  if (!c) return false;
  const { width: w, data } = img;
  const band = [];
  const step = Math.max(1, Math.floor((c.outer.right - c.outer.left) / 200));
  const sample = (x, y) => { const i = (Math.round(y) * w + Math.round(x)) * 4; band.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]); };
  const midTop = (c.outer.top + c.inner.top) / 2, midBot = (c.outer.bottom + c.inner.bottom) / 2;
  for (let x = c.inner.left; x < c.inner.right; x += step) { sample(x, midTop); sample(x, midBot); }
  if (band.length < 20) return false;
  const mean = band.reduce((a, b) => a + b, 0) / band.length;
  const outliers = band.filter((v) => Math.abs(v - mean) > 60).length / band.length;
  return outliers > 0.03;
}

export const THRESHOLDS = { sharpness: 60, darkMean: 55, brightMean: 225, clippedHigh: 0.25 };

/**
 * Everything "Retake Photo" needs. kind: 'full' (whole card) or 'closeup'.
 * issues: [{ kind: 'blur'|'dark'|'washed'|'glare'|'no-card', where? }]
 */
export function photoChecks(img, kind = "full") {
  const issues = [];
  const ex = exposure(img);
  if (ex.mean < THRESHOLDS.darkMean) issues.push({ kind: "dark" });
  if (ex.mean > THRESHOLDS.brightMean || ex.clippedHigh > THRESHOLDS.clippedHigh) issues.push({ kind: "washed" });
  let bounds = null;
  if (kind === "full") {
    bounds = findCardBounds(img);
    if (bounds.confidence < 0.15) issues.push({ kind: "no-card" });
  }
  const sharp = sharpness(img, bounds && bounds.confidence >= 0.15 ? bounds : null);
  if (sharp < THRESHOLDS.sharpness) issues.push({ kind: "blur" });
  const g = glare(img, bounds && bounds.confidence >= 0.15 ? bounds : null);
  if (g.glare) issues.push({ kind: "glare", where: g.where });
  return { ok: issues.length === 0, issues, scores: { sharpness: sharp, exposure: ex, glare: g.worst }, bounds };
}

export const ISSUE_COPY = {
  blur: { title: "Too blurry", body: "Blur hides corner and edge wear. Hold steady and let it focus, then retake." },
  dark: { title: "Too dark", body: "Move to brighter, even light and retake." },
  washed: { title: "Washed out", body: "Too much light. Step back from the lamp or turn it away and retake." },
  glare: { title: "Glare", body: "Glare can hide scratches, so the surface check would miss them. Tilt the card slightly away from the light and retake." },
  "no-card": { title: "Can't find the card edges", body: "Fill the brackets with the card on a plain surface that contrasts with the border, with a little space around it." },
};
