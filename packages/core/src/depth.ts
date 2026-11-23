import { gaussianBlurred, type Pixels } from './adjust';

/*
 * Flou d'objectif selon la profondeur (modèle Depth Anything V2 Small). Ce fichier prépare
 * l'image pour le modèle, met sa réponse en carte de profondeur (0 loin, 1 près) et floute
 * chaque pixel selon son éloignement du plan net. Le modèle lui-même tourne dans un Web Worker
 * de l'éditeur (apps/editor/src/smart/depth.worker.ts).
 */

/** Petit côté de l'image donnée au modèle, et plafond du grand côté (les côtés sont des multiples de 14). */
export const DEPTH_SHORT = 518;
export const DEPTH_LONG_MAX = 1036;
const PATCH = 14;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Taille de l'image rendue au modèle : côtés multiples de 14, petit côté ≈ 518. */
export function depthSize(w: number, h: number): { width: number; height: number } {
  let k = DEPTH_SHORT / Math.min(w, h);
  if (Math.max(w, h) * k > DEPTH_LONG_MAX) k = DEPTH_LONG_MAX / Math.max(w, h);
  const snap = (v: number) => Math.max(PATCH, Math.round((v * k) / PATCH) * PATCH);
  return { width: snap(w), height: snap(h) };
}

/** Pixels RGBA (déjà à la taille de `depthSize`) en tenseur canaux × hauteur × largeur, norme ImageNet. */
export function depthInput(img: Pixels): Float32Array {
  const { data, width: w, height: h } = img;
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (data[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

/**
 * Réponse du modèle (profondeur inverse relative : grand = proche) mise entre 0 et 1. On ignore
 * les valeurs les plus extrêmes (0,5 % de chaque côté) pour un contraste utile.
 */
export function depthNormalize(pred: Float32Array): Float32Array {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of pred) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) return new Float32Array(pred.length).fill(0.5);
  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  const span = hi - lo;
  for (const v of pred) hist[Math.min(BINS - 1, Math.floor(((v - lo) / span) * (BINS - 1)))]++;
  const cut = pred.length * 0.005;
  let acc = 0,
    a = 0,
    b = BINS - 1;
  while (a < BINS - 1 && acc + hist[a] <= cut) acc += hist[a++];
  acc = 0;
  while (b > a && acc + hist[b] <= cut) acc += hist[b--];
  const min = lo + (a / (BINS - 1)) * span;
  const max = lo + ((b + 1) / (BINS - 1)) * span;
  const k = max > min ? 1 / (max - min) : 0;
  return pred.map((v) => Math.min(1, Math.max(0, (v - min) * k)));
}

/** Carte de profondeur `pw` × `ph` ramenée (interpolation bilinéaire) à `w` × `h`. */
export function depthResample(map: Float32Array, pw: number, ph: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const fx = pw / w,
    fy = ph / h;
  for (let y = 0; y < h; y++) {
    const py = Math.min(ph - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(py),
      y1 = Math.min(ph - 1, y0 + 1),
      ay = py - y0;
    for (let x = 0; x < w; x++) {
      const px = Math.min(pw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(px),
        x1 = Math.min(pw - 1, x0 + 1),
        ax = px - x0;
      out[y * w + x] =
        (map[y0 * pw + x0] * (1 - ax) + map[y0 * pw + x1] * ax) * (1 - ay) +
        (map[y1 * pw + x0] * (1 - ax) + map[y1 * pw + x1] * ax) * ay;
    }
  }
  return out;
}

/** Réponse du modèle, normalisée puis ramenée à la taille `w` × `h`. */
export function depthMap(pred: Float32Array, pw: number, ph: number, w: number, h: number): Float32Array {
  return depthResample(depthNormalize(pred), pw, ph, w, h);
}

/** Profondeur au point (x, y) : médiane d'un petit carré, pour ne pas dépendre d'un seul pixel. */
export function depthAt(depth: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = Math.min(w - 1, Math.max(0, Math.round(x))),
    cy = Math.min(h - 1, Math.max(0, Math.round(y)));
  const r = Math.max(1, Math.round(Math.min(w, h) / 100));
  const v: number[] = [];
  for (let yy = Math.max(0, cy - r); yy <= Math.min(h - 1, cy + r); yy++)
    for (let xx = Math.max(0, cx - r); xx <= Math.min(w - 1, cx + r); xx++) v.push(depth[yy * w + xx]);
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

export interface DepthBlurOptions {
  /** Profondeur du plan net (0 loin, 1 près). */
  focus: number;
  /** Demi-largeur du plan net : au-delà, le flou grandit. */
  range: number;
  /** Écart-type du flou (pixels) aux profondeurs les plus éloignées du plan net. */
  sigma: number;
}

/** Nombre d'images floutées intermédiaires : entre deux, le flou est interpolé. */
const LEVELS = 4;

/**
 * Image floutée : chaque pixel est mélangé entre l'original et des copies de plus en plus floues,
 * selon l'éloignement de sa profondeur au plan net.
 */
export function depthBlur(img: Pixels, depth: Float32Array, o: DepthBlurOptions): Uint8ClampedArray {
  const { data, width: w, height: h } = img;
  const far = Math.max(o.focus, 1 - o.focus) - o.range;
  if (o.sigma < 0.3 || far <= 0.01 || w * h === 0) return new Uint8ClampedArray(data);
  // Niveau de flou voulu par pixel, de 0 (net) à LEVELS.
  const want = new Float32Array(w * h);
  let maxWant = 0;
  for (let i = 0; i < want.length; i++) {
    const c = Math.min(1, Math.max(0, (Math.abs(depth[i] - o.focus) - o.range) / far));
    want[i] = c * LEVELS;
    if (want[i] > maxWant) maxWant = want[i];
  }
  const out = new Uint8ClampedArray(data.length);
  if (maxWant <= 0) {
    out.set(data);
    return out;
  }
  const top = Math.ceil(maxWant);
  const levels: Uint8ClampedArray[] = [data];
  for (let k = 1; k <= top; k++) levels.push(gaussianBlurred(img, (o.sigma * k) / LEVELS));
  for (let i = 0; i < want.length; i++) {
    const t = want[i];
    const k = Math.min(top - 1, Math.floor(t));
    const f = top === 0 ? 0 : t - k;
    const a = levels[k],
      b = levels[Math.min(top, k + 1)];
    for (let c = 0; c < 4; c++) out[i * 4 + c] = a[i * 4 + c] * (1 - f) + b[i * 4 + c] * f;
  }
  return out;
}
