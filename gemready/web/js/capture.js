// Camera, photo decoding, on-device analysis, crops and OCR.

import { photoChecks, measureCentering, findCardBounds, borderMarks, downscale } from "../shared/analysis.js";
import { put, get, uid } from "./state.js";

const MAX_ANALYSIS = 1600; // px, longest side — plenty for centering

// ---------------------------------------------------------------- camera
export class Camera {
  constructor(video) { this.video = video; this.stream = null; }
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-camera");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", "");
    this.video.muted = true;
    await this.video.play();
  }
  stop() { this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; }
  ready() { return this.video.readyState >= 2 && this.video.videoWidth > 0; }
  /** Current frame as a canvas at full resolution. */
  frame() {
    const v = this.video;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    return c;
  }
  /** Small frame for the live edge lock. */
  smallFrame(max = 400) {
    const v = this.video;
    const s = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(v, 0, 0, c.width, c.height);
    return g.getImageData(0, 0, c.width, c.height);
  }
}

/** Edge lock for the brackets: card found, reasonably large, right shape. */
export function edgeLock(img) {
  const b = findCardBounds(img);
  return { locked: b.confidence >= 0.35 && b.fill > 0.3 && b.fill < 0.92, bounds: b };
}

// ---------------------------------------------------------------- photos
export async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

export function imageDataOf(canvas, max = MAX_ANALYSIS) {
  const s = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height);
}

/** Re-encoding through a canvas drops EXIF (location, phone model, time). */
export const toJpeg = (canvas, q = 0.9) => new Promise((r) => canvas.toBlob(r, "image/jpeg", q));

/** Save one photo for a scan slot; returns { photoId, checks }. */
export async function savePhoto(canvas, { side, slot }) {
  const img = imageDataOf(canvas);
  const checks = photoChecks(img, slot === "full" ? "full" : "closeup");
  const blob = await toJpeg(scaled(canvas, 2400), 0.9);
  const id = uid();
  await put("photos", { id, blob, side, slot, w: canvas.width, h: canvas.height });
  return { photoId: id, checks: { ok: checks.ok, issues: checks.issues, sharpness: Math.round(checks.scores.sharpness), glare: +checks.scores.glare.toFixed(4) } };
}

function scaled(canvas, max) {
  const s = Math.min(1, max / Math.max(canvas.width, canvas.height));
  if (s === 1) return canvas;
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

export async function photoCanvas(photoId) {
  const p = await get("photos", photoId);
  if (!p) return null;
  return fileToCanvas(p.blob);
}

export async function photoUrl(photoId) {
  const p = photoId && (await get("photos", photoId));
  return p ? URL.createObjectURL(p.blob) : null;
}

/** Centering + border marks for a full-card photo. */
export async function analyzeFull(photoId) {
  const canvas = await photoCanvas(photoId);
  if (!canvas) return null;
  const img = imageDataOf(canvas);
  const c = measureCentering(img);
  if (!c) return { centering: null, marks: false, bounds: null, scale: canvas.width / img.width };
  return {
    centering: { lr: +c.lr.toFixed(4), tb: +c.tb.toFixed(4), confidence: +c.confidence.toFixed(2) },
    marks: borderMarks(img, c),
    bounds: c.outer,
    scale: canvas.width / img.width,
  };
}

/** Card-only crop (for training uploads) as a base64 JPEG without EXIF. */
export async function cardCrop(photoId, bounds, scale = 1) {
  const src = await photoCanvas(photoId);
  if (!src || !bounds) return null;
  const x = Math.max(0, Math.round(bounds.left * scale)), y = Math.max(0, Math.round(bounds.top * scale));
  const w = Math.min(src.width - x, Math.round((bounds.right - bounds.left) * scale));
  const h = Math.min(src.height - y, Math.round((bounds.bottom - bounds.top) * scale));
  if (w < 100 || h < 100) return null;
  const s = Math.min(1, 1200 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  const blob = await toJpeg(c, 0.88);
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------------------------------------------------------- OCR
// Reads the card name (top band) and collector number (bottom band) on the
// phone. Tesseract loads on first use only.
let tesseract = null;
async function loadTesseract() {
  if (tesseract) return tesseract;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  tesseract = await window.Tesseract.createWorker("eng");
  return tesseract;
}

export async function readCardText(photoId, bounds, scale = 1) {
  const src = await photoCanvas(photoId);
  if (!src) return "";
  const b = bounds
    ? { x: bounds.left * scale, y: bounds.top * scale, w: (bounds.right - bounds.left) * scale, h: (bounds.bottom - bounds.top) * scale }
    : { x: 0, y: 0, w: src.width, h: src.height };
  const band = (y0, y1, x0 = 0, x1 = 1) => {
    const c = document.createElement("canvas");
    const sw = b.w * (x1 - x0), sh = b.h * (y1 - y0);
    const s = Math.min(2, 1400 / sw);
    c.width = Math.round(sw * s); c.height = Math.round(sh * s);
    c.getContext("2d").drawImage(src, b.x + b.w * x0, b.y + b.h * y0, sw, sh, 0, 0, c.width, c.height);
    return c;
  };
  try {
    const w = await loadTesseract();
    const top = await w.recognize(band(0.02, 0.12, 0.05, 0.75));
    const bottom = await w.recognize(band(0.88, 0.98, 0, 1));
    return `${top.data.text}\n${bottom.data.text}`;
  } catch {
    return "";
  }
}

export { downscale };
