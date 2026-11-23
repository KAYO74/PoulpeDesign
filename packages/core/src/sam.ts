import type { Pixels } from './adjust';

/*
 * Sélection d'objet par clic (modèle SAM, version SlimSAM). Ce fichier prépare l'image pour le
 * modèle et traduit son résultat en masque d'opacité ; le modèle lui-même tourne dans un Web
 * Worker de l'éditeur (apps/editor/src/smart/sam.worker.ts).
 */

/** Côté de l'image donnée à l'encodeur. */
export const SAM_SIZE = 1024;
/** Côté des masques rendus par le décodeur (le quart de `SAM_SIZE`). */
export const SAM_MASK = 256;

const MEAN = [123.675, 116.28, 103.53];
const STD = [58.395, 57.12, 57.375];

export interface SamInput {
  /** Canaux × 1024 × 1024, centré et réduit, complété de 0 en bas et à droite. */
  tensor: Float32Array;
  /** Pixels du modèle par pixel de l'image. */
  scale: number;
  /** Taille de l'image dans le cadre du modèle. */
  width: number;
  height: number;
}

/** Image réduite pour que son grand côté vaille 1024 (moyenne des pixels couverts), normalisée. */
export function samInput(img: Pixels): SamInput {
  const { width: sw, height: sh, data } = img;
  const scale = SAM_SIZE / Math.max(sw, sh);
  const width = Math.max(1, Math.round(sw * scale)),
    height = Math.max(1, Math.round(sh * scale));
  const plane = SAM_SIZE * SAM_SIZE;
  const tensor = new Float32Array(3 * plane);
  const fx = sw / width,
    fy = sh / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r: number, g: number, b: number;
      if (fx <= 1 && fy <= 1) {
        // Agrandissement : interpolation bilinéaire.
        const px = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5)),
          py = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
        const x0 = Math.floor(px),
          y0 = Math.floor(py),
          x1 = Math.min(sw - 1, x0 + 1),
          y1 = Math.min(sh - 1, y0 + 1);
        const ax = px - x0,
          ay = py - y0;
        const at = (xx: number, yy: number, c: number) => data[(yy * sw + xx) * 4 + c];
        const mix = (c: number) =>
          (at(x0, y0, c) * (1 - ax) + at(x1, y0, c) * ax) * (1 - ay) +
          (at(x0, y1, c) * (1 - ax) + at(x1, y1, c) * ax) * ay;
        r = mix(0);
        g = mix(1);
        b = mix(2);
      } else {
        // Réduction : moyenne des pixels de la case.
        const xa = Math.floor(x * fx),
          xb = Math.max(xa + 1, Math.min(sw, Math.ceil((x + 1) * fx)));
        const ya = Math.floor(y * fy),
          yb = Math.max(ya + 1, Math.min(sh, Math.ceil((y + 1) * fy)));
        let sr = 0,
          sg = 0,
          sb = 0;
        for (let yy = ya; yy < yb; yy++)
          for (let xx = xa; xx < xb; xx++) {
            const i = (yy * sw + xx) * 4;
            sr += data[i];
            sg += data[i + 1];
            sb += data[i + 2];
          }
        const n = (xb - xa) * (yb - ya);
        r = sr / n;
        g = sg / n;
        b = sb / n;
      }
      const o = y * SAM_SIZE + x;
      tensor[o] = (r - MEAN[0]) / STD[0];
      tensor[plane + o] = (g - MEAN[1]) / STD[1];
      tensor[2 * plane + o] = (b - MEAN[2]) / STD[2];
    }
  }
  return { tensor, scale, width, height };
}

export interface SamClick {
  /** Position dans l'image, en pixels. */
  x: number;
  y: number;
  /** Faux : ce point est hors de l'objet (clic avec Alt). */
  positive: boolean;
}

/** Clics au format du décodeur : coordonnées dans le cadre du modèle, et 1 (dans l'objet) ou 0. */
export function samPrompt(
  clicks: SamClick[],
  scale: number,
): { points: Float32Array; labels: BigInt64Array } {
  const points = new Float32Array(clicks.length * 2);
  const labels = new BigInt64Array(clicks.length);
  clicks.forEach((c, i) => {
    points[i * 2] = c.x * scale;
    points[i * 2 + 1] = c.y * scale;
    labels[i] = c.positive ? 1n : 0n;
  });
  return { points, labels };
}

/** Indice du meilleur des masques proposés (note de qualité la plus haute). */
export function samBest(scores: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  return best;
}

/** Largeur de la rampe d'opacité autour du bord, en valeurs du modèle (0 = bord). */
const EDGE = 4;

/**
 * Masque d'opacité de l'image (`width` × `height`) d'après un masque du décodeur (256 × 256,
 * valeurs positives = dans l'objet). Le bord est adouci sur environ un pixel du masque.
 */
export function samMask(
  logits: ArrayLike<number>,
  scale: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  const k = scale / (SAM_SIZE / SAM_MASK);
  const mw = Math.max(1, Math.round(width * k)),
    mh = Math.max(1, Math.round(height * k));
  const at = (x: number, y: number) => logits[Math.min(mh - 1, y) * SAM_MASK + Math.min(mw - 1, x)];
  for (let y = 0; y < height; y++) {
    const py = Math.min(mh - 1, Math.max(0, (y + 0.5) * k - 0.5));
    const y0 = Math.floor(py),
      ay = py - y0;
    for (let x = 0; x < width; x++) {
      const px = Math.min(mw - 1, Math.max(0, (x + 0.5) * k - 0.5));
      const x0 = Math.floor(px),
        ax = px - x0;
      const v =
        (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) +
        (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
      out[y * width + x] = (0.5 + v / (2 * EDGE)) * 255;
    }
  }
  return out;
}
