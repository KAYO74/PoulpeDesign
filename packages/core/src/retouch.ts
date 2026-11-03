import { adjustmentEngine, gaussianBlurred, type Pixels } from './adjust';
import type { Vec } from './geometry';

/*
 * Retouches géométriques et correctives sur des pixels RGBA : correction de perspective,
 * déformation au pinceau (fluidité), correcteur. Sans dépendance au navigateur.
 */

/** Matrice 3×3 (lignes) d'une homographie : `[a b c; d e f; g h 1]`. */
export type Homography = [number, number, number, number, number, number, number, number, number];

/** Homographie qui envoie les 4 points `from` sur les 4 points `to`. */
export function homography(from: Vec[], to: Vec[]): Homography {
  // 8 équations, 8 inconnues (h33 = 1), résolues par élimination de Gauss.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / d;
      if (k) for (let j = c; j < 9; j++) A[r][j] -= k * A[c][j];
    }
  }
  const h = A.map((row, i) => row[8] / (row[i] || 1e-12));
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(H: Homography, p: Vec): Vec {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

/**
 * Lit la couleur en (x, y) par interpolation bilinéaire (couleurs prémultipliées, pour ne pas
 * baver de couleur cachée sur les bords transparents). Écrit le résultat dans `out` à `o`.
 */
function sample(px: Pixels, x: number, y: number, out: Uint8ClampedArray, o: number, clamp = false): void {
  const { data, width: w, height: h } = px;
  x -= 0.5;
  y -= 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const tx = x - x0,
    ty = y - y0;
  let r = 0,
    g = 0,
    b = 0,
    a = 0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      let xx = x0 + i,
        yy = y0 + j;
      if (clamp) {
        xx = Math.min(w - 1, Math.max(0, xx));
        yy = Math.min(h - 1, Math.max(0, yy));
      }
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
      const p = (yy * w + xx) * 4;
      const pa = (data[p + 3] / 255) * k;
      r += data[p] * pa;
      g += data[p + 1] * pa;
      b += data[p + 2] * pa;
      a += pa;
    }
  if (a <= 1e-6) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  out[o] = r / a;
  out[o + 1] = g / a;
  out[o + 2] = b / a;
  out[o + 3] = a * 255;
}

/**
 * Correction de perspective : le quadrilatère `quad` de l'image (coins haut gauche, haut droit,
 * bas droit, bas gauche, en pixels) devient un rectangle de `width` × `height` pixels.
 */
export function warpPerspective(src: Pixels, quad: Vec[], width: number, height: number): Pixels {
  const W = Math.max(1, Math.round(width)),
    H = Math.max(1, Math.round(height));
  const M = homography(
    [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ],
    quad,
  );
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = applyHomography(M, { x: x + 0.5, y: y + 0.5 });
      sample(src, p.x, p.y, out, (y * W + x) * 4);
    }
  return { data: out, width: W, height: H };
}

export type LiquifyMode = 'push' | 'twirl' | 'bloat' | 'pinch';

/**
 * Une touche du pinceau de fluidité, sur place : les pixels du disque de rayon `radius` autour
 * de (cx, cy) sont déplacés selon `mode`. `dx`, `dy` : mouvement du pinceau depuis la touche
 * précédente (pour `push`). `strength` de 0 à 1 ; un `strength` négatif inverse le tourbillon.
 * `freeze` (un octet par pixel de `px`, 255 = gelé) protège des pixels.
 */
export function liquifyDab(
  px: Pixels,
  cx: number,
  cy: number,
  radius: number,
  mode: LiquifyMode,
  strength: number,
  dx = 0,
  dy = 0,
  freeze?: Uint8Array,
): void {
  const { data, width: w, height: h } = px;
  const r = Math.max(1, radius);
  const x0 = Math.max(0, Math.floor(cx - r)),
    y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(w, Math.ceil(cx + r)),
    y1 = Math.min(h, Math.ceil(cy + r));
  if (x1 <= x0 || y1 <= y0) return;
  // Copie de la zone lue : le disque, plus ce que le déplacement peut aller chercher autour.
  const m = Math.ceil(mode === 'push' ? Math.hypot(dx, dy) * Math.abs(strength) + 2 : r * 0.5 + 2);
  const sx0 = Math.max(0, x0 - m),
    sy0 = Math.max(0, y0 - m);
  const sx1 = Math.min(w, x1 + m),
    sy1 = Math.min(h, y1 + m);
  const sw = sx1 - sx0,
    sh = sy1 - sy0;
  const copy = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++)
    copy.set(data.subarray(((sy0 + y) * w + sx0) * 4, ((sy0 + y) * w + sx1) * 4), y * sw * 4);
  const src: Pixels = { data: copy, width: sw, height: sh };
  const tmp = new Uint8ClampedArray(4);
  const r2 = r * r;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const ox = x + 0.5 - cx,
        oy = y + 0.5 - cy;
      const d2 = ox * ox + oy * oy;
      if (d2 >= r2) continue;
      // Masque de gel : les pixels gelés (255) ne bougent pas, les autres d'autant moins qu'ils le sont.
      const thaw = freeze ? 1 - freeze[y * w + x] / 255 : 1;
      if (thaw <= 0) continue;
      const f = (1 - d2 / r2) ** 2 * Math.abs(strength) * thaw;
      let sxp: number, syp: number;
      if (mode === 'push') {
        sxp = x + 0.5 - dx * f;
        syp = y + 0.5 - dy * f;
      } else if (mode === 'twirl') {
        const a = -f * 0.35 * Math.sign(strength || 1);
        const c = Math.cos(a),
          s = Math.sin(a);
        sxp = cx + ox * c - oy * s;
        syp = cy + ox * s + oy * c;
      } else {
        const k = mode === 'bloat' ? 1 - f * 0.25 : 1 + f * 0.25;
        sxp = cx + ox * k;
        syp = cy + oy * k;
      }
      sample(src, sxp - sx0, syp - sy0, tmp, 0, true);
      const o = (y * w + x) * 4;
      data[o] = tmp[0];
      data[o + 1] = tmp[1];
      data[o + 2] = tmp[2];
      data[o + 3] = tmp[3];
    }
}

/**
 * Correcteur : la texture de `src` avec les couleurs et la lumière de `dest` (ce qui reste quand
 * on enlève les détails, c'est-à-dire un flou de rayon `sigma`). Les deux images ont la même
 * taille ; l'opacité est celle de `dest`.
 */
export function healBlend(dest: Pixels, src: Pixels, sigma: number): Uint8ClampedArray {
  const fast = adjustmentEngine()?.heal?.(dest, src, sigma);
  if (fast) return fast;
  return healBlendTs(dest, src, sigma);
}

/** Calcul TypeScript d'origine du correcteur (référence du moteur Rust, et solution de repli). */
export function healBlendTs(dest: Pixels, src: Pixels, sigma: number): Uint8ClampedArray {
  const bd = gaussianBlurred(dest, sigma);
  const bs = gaussianBlurred(src, sigma);
  const out = new Uint8ClampedArray(dest.data.length);
  const s = src.data,
    d = dest.data;
  for (let i = 0; i < out.length; i += 4) {
    out[i] = s[i] + bd[i] - bs[i];
    out[i + 1] = s[i + 1] + bd[i + 1] - bs[i + 1];
    out[i + 2] = s[i + 2] + bd[i + 2] - bs[i + 2];
    out[i + 3] = d[i + 3];
  }
  return out;
}

/** Rééchantillonne des pixels à une autre taille (moyenne des pixels couverts en réduction, bilinéaire en agrandissement). */
export function resamplePixels(src: Pixels, width: number, height: number): Pixels {
  const W = Math.max(1, Math.round(width)),
    H = Math.max(1, Math.round(height));
  const out = new Uint8ClampedArray(W * H * 4);
  const kx = src.width / W,
    ky = src.height / H;
  if (kx <= 1 && ky <= 1) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) sample(src, (x + 0.5) * kx, (y + 0.5) * ky, out, (y * W + x) * 4, true);
    return { data: out, width: W, height: H };
  }
  const d = src.data,
    sw = src.width;
  for (let y = 0; y < H; y++) {
    const ya = Math.floor(y * ky),
      yb = Math.max(ya + 1, Math.min(src.height, Math.floor((y + 1) * ky)));
    for (let x = 0; x < W; x++) {
      const xa = Math.floor(x * kx),
        xb = Math.max(xa + 1, Math.min(sw, Math.floor((x + 1) * kx)));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let yy = ya; yy < yb; yy++)
        for (let xx = xa; xx < xb; xx++) {
          const p = (yy * sw + xx) * 4;
          const pa = d[p + 3];
          r += d[p] * pa;
          g += d[p + 1] * pa;
          b += d[p + 2] * pa;
          a += pa;
          n++;
        }
      const o = (y * W + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / Math.max(1, n);
    }
  }
  return { data: out, width: W, height: H };
}
