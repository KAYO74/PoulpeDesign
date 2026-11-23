import type { Pixels } from './adjust';

/*
 * Agrandissement par IA (Real-ESRGAN, modèle « general x4v3 ») : l'image est découpée en tuiles
 * qui se recouvrent un peu, chaque tuile passe dans le modèle (×4 en largeur et en hauteur), puis
 * on recolle le centre de chaque tuile. Ce fichier prépare les tuiles et recolle le résultat ; le
 * modèle tourne dans un Web Worker de l'éditeur (apps/editor/src/smart/upscale.worker.ts).
 */

/** Facteur du modèle. */
export const UPSCALE_FACTOR = 4;
/** Côté d'une tuile (sans les marges), en pixels de l'image d'origine. */
export const UPSCALE_TILE = 192;
/** Marge ajoutée de chaque côté intérieur d'une tuile, puis jetée : le modèle y voit le voisinage. */
export const UPSCALE_MARGIN = 24;

export interface UpscaleTile {
  /** Zone envoyée au modèle (marges comprises), dans l'image d'origine. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Zone gardée au résultat (la tuile sans ses marges). */
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
}

/** Découpe une image de `w` × `h` pixels en tuiles. */
export function planTiles(w: number, h: number, tile = UPSCALE_TILE, margin = UPSCALE_MARGIN): UpscaleTile[] {
  const out: UpscaleTile[] = [];
  for (let cy0 = 0; cy0 < h; cy0 += tile)
    for (let cx0 = 0; cx0 < w; cx0 += tile) {
      const cx1 = Math.min(w, cx0 + tile),
        cy1 = Math.min(h, cy0 + tile);
      out.push({
        x0: Math.max(0, cx0 - margin),
        y0: Math.max(0, cy0 - margin),
        x1: Math.min(w, cx1 + margin),
        y1: Math.min(h, cy1 + margin),
        cx0,
        cy0,
        cx1,
        cy1,
      });
    }
  return out;
}

/** Pixels d'une tuile pour le modèle : canaux rouge, vert, bleu l'un après l'autre, de 0 à 1. */
export function tileInput(img: Pixels, t: UpscaleTile): Float32Array {
  const tw = t.x1 - t.x0,
    th = t.y1 - t.y0;
  const out = new Float32Array(3 * tw * th);
  const plane = tw * th;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const i = ((t.y0 + y) * img.width + t.x0 + x) * 4;
      const o = y * tw + x;
      out[o] = img.data[i] / 255;
      out[plane + o] = img.data[i + 1] / 255;
      out[2 * plane + o] = img.data[i + 2] / 255;
    }
  return out;
}

/** Recolle le centre d'une tuile agrandie (`result` : 3 canaux de (tw×4) × (th×4)) dans `out` (RGBA). */
export function placeTile(
  out: Uint8ClampedArray,
  outWidth: number,
  result: Float32Array,
  t: UpscaleTile,
  factor = UPSCALE_FACTOR,
): void {
  const rw = (t.x1 - t.x0) * factor,
    rh = (t.y1 - t.y0) * factor;
  const plane = rw * rh;
  for (let y = t.cy0 * factor; y < t.cy1 * factor; y++) {
    const ry = y - t.y0 * factor;
    for (let x = t.cx0 * factor; x < t.cx1 * factor; x++) {
      const r = ry * rw + (x - t.x0 * factor);
      const o = (y * outWidth + x) * 4;
      // La valeur est ramenée dans [0, 1] puis arrondie (Uint8ClampedArray fait les deux).
      out[o] = result[r] * 255;
      out[o + 1] = result[plane + r] * 255;
      out[o + 2] = result[2 * plane + r] * 255;
    }
  }
}

/** Opacité agrandie (interpolation bilinéaire) : le modèle ne traite que les couleurs. */
export function upscaleAlpha(img: Pixels, out: Uint8ClampedArray, factor = UPSCALE_FACTOR): void {
  const { width: w, height: h, data } = img;
  const ow = w * factor;
  let opaque = true;
  for (let i = 3; i < data.length; i += 4)
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  if (opaque) {
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return;
  }
  for (let y = 0; y < h * factor; y++) {
    const py = Math.min(h - 1, Math.max(0, (y + 0.5) / factor - 0.5));
    const y0 = Math.floor(py),
      y1 = Math.min(h - 1, y0 + 1),
      ay = py - y0;
    for (let x = 0; x < ow; x++) {
      const px = Math.min(w - 1, Math.max(0, (x + 0.5) / factor - 0.5));
      const x0 = Math.floor(px),
        x1 = Math.min(w - 1, x0 + 1),
        ax = px - x0;
      const a = (xx: number, yy: number) => data[(yy * w + xx) * 4 + 3];
      out[(y * ow + x) * 4 + 3] =
        (a(x0, y0) * (1 - ax) + a(x1, y0) * ax) * (1 - ay) + (a(x0, y1) * (1 - ax) + a(x1, y1) * ax) * ay;
    }
  }
}
