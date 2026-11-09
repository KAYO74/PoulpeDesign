/*
 * Réduction du bruit (comme « Débruiter » de Lightroom), calculée sur l'ordinateur sans modèle :
 * un filtre bilatéral séparable qui lisse le grain sans écraser les contours.
 *  - la luminance est lissée sur un rayon de 3 pixels, selon l'écart de luminance ;
 *  - la couleur (le bruit de chrominance, bien plus visible) est lissée sur 6 pixels, en suivant
 *    les contours de luminance et de couleur pour ne pas baver.
 * Le moteur Rust (crates/poulpe-engine/src/denoise.rs) fait exactement le même calcul : les
 * opérations sont les mêmes, dans le même ordre, sans exponentielle (pas de différence d'arrondi).
 */

const R_LUMA = 3;
const R_CHROMA = 6;

/** Rayon en pixels pour l'échelle d'aperçu donnée (au moins 1). */
export const denoiseRadius = (base: number, scale: number): number =>
  Math.max(1, Math.floor(base * scale + 0.5));

/** Marge lue autour de chaque pixel, en pixels de l'image (échelle d'aperçu comprise). */
export const denoiseReach = (scale: number): number => denoiseRadius(R_CHROMA, scale);

/** Poids de distance : 1 au centre, décroît linéairement jusqu'à 0 au-delà du rayon. */
const spatial = (k: number, r: number) => (r + 1 - Math.abs(k)) / (r + 1);
/** Poids de ressemblance : 1 si pareil, tombe vers 0 quand l'écart dépasse `s`. */
const similar = (d: number, s: number) => {
  const q = d / s;
  return 1 / (1 + q * q);
};

/**
 * Une passe horizontale ou verticale sur un ou deux plans. Les voisins sont pris dans l'ordre
 * k = −r…r (bords répétés) ; `weight(i, j)` donne la ressemblance du pixel j au pixel i.
 */
function pass(
  w: number,
  h: number,
  vertical: boolean,
  r: number,
  weight: (i: number, j: number) => number,
  a: Float64Array,
  b?: Float64Array,
): [Float64Array, Float64Array | undefined] {
  const outA = new Float64Array(w * h);
  const outB = b ? new Float64Array(w * h) : undefined;
  const len = vertical ? h : w;
  const step = vertical ? w : 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const pos = vertical ? y : x;
      let sa = 0,
        sb = 0,
        total = 0;
      for (let k = -r; k <= r; k++) {
        const p = Math.min(len - 1, Math.max(0, pos + k));
        const j = i + (p - pos) * step;
        const wt = spatial(k, r) * weight(i, j);
        total += wt;
        sa += wt * a[j];
        if (b) sb += wt * b[j];
      }
      outA[i] = total > 0 ? sa / total : a[i];
      if (outB && b) outB[i] = total > 0 ? sb / total : b[i];
    }
  return [outA, outB];
}

export interface DenoiseOptions {
  /** Échelle d'aperçu (rayons proportionnels). */
  scale?: number;
}

/** Applique la réduction du bruit sur place. `luminance` et `color` vont de 0 à 100. */
export function applyDenoise(
  px: { data: Uint8ClampedArray; width: number; height: number },
  luminance: number,
  color: number,
  opts: DenoiseOptions = {},
): void {
  const { data, width: w, height: h } = px;
  const scale = opts.scale ?? 1;
  const lum = Math.max(0, Math.min(100, luminance)) / 100;
  const col = Math.max(0, Math.min(100, color)) / 100;
  if ((lum === 0 && col === 0) || w * h === 0) return;
  const n = w * h;
  let Y: Float64Array = new Float64Array(n);
  let Cb: Float64Array = new Float64Array(n);
  let Cr: Float64Array = new Float64Array(n);
  const A = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4],
      g = data[i * 4 + 1],
      b = data[i * 4 + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    Y[i] = y;
    Cb[i] = b - y;
    Cr[i] = r - y;
    A[i] = data[i * 4 + 3] / 255;
  }

  if (lum > 0) {
    const sigma = 1 + lum * 40;
    const r = denoiseRadius(R_LUMA, scale);
    for (const vertical of [false, true]) {
      const src = Y;
      Y = pass(w, h, vertical, r, (i, j) => A[j] * similar(Math.abs(src[j] - src[i]), sigma), src)[0];
    }
  }
  if (col > 0) {
    const sigma = 4 + col * 30;
    const r = denoiseRadius(R_CHROMA, scale);
    for (const vertical of [false, true]) {
      const [cb, cr, y] = [Cb, Cr, Y];
      const out = pass(
        w,
        h,
        vertical,
        r,
        (i, j) =>
          A[j] *
          similar(Math.abs(y[j] - y[i]) + 0.5 * (Math.abs(cb[j] - cb[i]) + Math.abs(cr[j] - cr[i])), sigma),
        cb,
        cr,
      );
      Cb = out[0];
      Cr = out[1]!;
    }
  }

  for (let i = 0; i < n; i++) {
    const r = Y[i] + Cr[i];
    const b = Y[i] + Cb[i];
    const g = (Y[i] - 0.2126 * r - 0.0722 * b) / 0.7152;
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
  }
}
