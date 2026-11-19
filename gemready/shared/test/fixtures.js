// Synthetic card photos for tests: background, a card with a colored border,
// textured art inside. Border widths are exact, so centering has a known answer.

export function makeCard({
  W = 800, H = 1000,
  card = { left: 114, top: 100, width: 572, height: 800 },
  border = { left: 30, right: 20, top: 36, bottom: 36 },
  bg = [38, 40, 46], borderColor = [228, 196, 52], seed = 7,
  glareAt = null, // { x, y, r }
  innerBox = false, // dark art box inside a light frame (stronger edge than the border)
  flat = false, // flat art, like a card back
} = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let c = bg.map((v) => v + (rnd() - 0.5) * 6);
      const inCard = x >= card.left && x < card.left + card.width && y >= card.top && y < card.top + card.height;
      if (inCard) {
        const ax0 = card.left + border.left, ax1 = card.left + card.width - border.right;
        const ay0 = card.top + border.top, ay1 = card.top + card.height - border.bottom;
        if (x >= ax0 && x < ax1 && y >= ay0 && y < ay1) {
          // textured art: stripes + noise so it's sharp
          const t = ((x >> 3) + (y >> 3)) % 2 ? 40 : -40;
          c = flat ? [40, 96, 196] : [70 + t + rnd() * 30, 120 + t + rnd() * 30, 175 + rnd() * 30];
          if (innerBox) {
            const inBox = x >= ax0 + 20 && x < ax1 - 20 && y >= ay0 + 60 && y < ay0 + 360;
            c = inBox ? [30, 30, 80] : [226, 226, 216];
          }
        } else {
          c = borderColor.map((v) => v + (rnd() - 0.5) * 8);
        }
      }
      if (glareAt) {
        const d = Math.hypot(x - glareAt.x, y - glareAt.y);
        if (d < glareAt.r) c = [252, 252, 250];
      }
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

export function boxBlur(img, r = 6) {
  const { width: w, height: h, data } = img;
  const tmp = new Float32Array(w * h * 4), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += data[(y * w + xx) * 4 + c]; n++; } }
    tmp[(y * w + x) * 4 + c] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[(yy * w + x) * 4 + c]; n++; } }
      out[(y * w + x) * 4 + c] = s / n;
    }
    out[(y * w + x) * 4 + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

export function darken(img, f = 0.2) {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < d.length; i += 4) { d[i] *= f; d[i + 1] *= f; d[i + 2] *= f; }
  return { ...img, data: d };
}
