import type { Pixels } from './adjust';

/*
 * Fusion d'images prises à la suite (même cadre) : fusion d'expositions (rendu HDR sans passer par
 * une carte de luminance) et empilement de mise au point. Méthode de Mertens, Kautz et Van Reeth
 * (2007) : chaque pixel de chaque image reçoit un poids (contraste, saturation, bonne exposition),
 * et les images sont mélangées niveau par niveau d'une pyramide laplacienne, ce qui évite les
 * halos et les raccords visibles. La mise au point ne garde que le poids de contraste : chaque
 * zone vient de l'image où elle est la plus nette.
 *
 * Calcul pur (sans DOM), pour les tests et les workers.
 */

export type FusionMode = 'exposure' | 'focus';

export interface FusionOptions {
  mode: FusionMode;
  /** Poids de chaque critère (exposition seulement), de 0 à 2 ; 1 par défaut. */
  contrast?: number;
  saturation?: number;
  exposure?: number;
  /** Avancement de 0 à 1 ; renvoyer true pour annuler. */
  progress?: (fraction: number) => boolean | void;
}

/** Plus grand côté et nombre de pixels au-delà desquels `fitFusion` réduit les images. */
export const FUSION_MAX_PIXELS = 16_000_000;

const KERNEL = [1, 4, 6, 4, 1];

/** Flou séparable 5 points (bords répétés) sur `ch` canaux entrelacés. */
function blur(src: Float32Array, w: number, h: number, ch: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let k = -2; k <= 2; k++)
          s += KERNEL[k + 2] * src[(y * w + Math.min(w - 1, Math.max(0, x + k))) * ch + c];
        tmp[(y * w + x) * ch + c] = s / 16;
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let k = -2; k <= 2; k++)
          s += KERNEL[k + 2] * tmp[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * ch + c];
        out[(y * w + x) * ch + c] = s / 16;
      }
  return out;
}

/** Réduit de moitié (après flou). */
function down(
  src: Float32Array,
  w: number,
  h: number,
  ch: number,
): { data: Float32Array; w: number; h: number } {
  const b = blur(src, w, h, ch);
  const W = Math.max(1, (w + 1) >> 1),
    H = Math.max(1, (h + 1) >> 1);
  const out = new Float32Array(W * H * ch);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < ch; c++)
        out[(y * W + x) * ch + c] = b[(Math.min(h - 1, y * 2) * w + Math.min(w - 1, x * 2)) * ch + c];
  return { data: out, w: W, h: H };
}

/** Agrandit à (W, H) : insertion de zéros puis flou, comme dans la pyramide de Burt et Adelson. */
function up(src: Float32Array, w: number, h: number, ch: number, W: number, H: number): Float32Array {
  const big = new Float32Array(W * H * ch);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = x * 2,
        Y = y * 2;
      if (X >= W || Y >= H) continue;
      for (let c = 0; c < ch; c++) big[(Y * W + X) * ch + c] = src[(y * w + x) * ch + c] * 4;
    }
  return blur(big, W, H, ch);
}

interface Level {
  data: Float32Array;
  w: number;
  h: number;
}

function gaussianPyramid(src: Float32Array, w: number, h: number, ch: number, levels: number): Level[] {
  const out: Level[] = [{ data: src, w, h }];
  for (let i = 1; i < levels; i++) {
    const p = out[i - 1];
    out.push(down(p.data, p.w, p.h, ch));
  }
  return out;
}

function laplacianPyramid(src: Float32Array, w: number, h: number, ch: number, levels: number): Level[] {
  const g = gaussianPyramid(src, w, h, ch, levels);
  const out: Level[] = [];
  for (let i = 0; i < levels - 1; i++) {
    const a = g[i],
      b = g[i + 1];
    const u = up(b.data, b.w, b.h, ch, a.w, a.h);
    const d = new Float32Array(a.data.length);
    for (let k = 0; k < d.length; k++) d[k] = a.data[k] - u[k];
    out.push({ data: d, w: a.w, h: a.h });
  }
  out.push(g[levels - 1]);
  return out;
}

/** Niveaux de la pyramide : jusqu'à environ 16 pixels de côté, au plus 9. */
function levelsFor(w: number, h: number): number {
  return Math.max(1, Math.min(9, Math.floor(Math.log2(Math.max(2, Math.min(w, h) / 16))) + 1));
}

/** Réduit des images au plus à `maxPixels` (moyenne par blocs) . */
export function fitFusion(img: Pixels, maxPixels = FUSION_MAX_PIXELS): Pixels {
  const n = img.width * img.height;
  if (n <= maxPixels) return img;
  const k = Math.sqrt(maxPixels / n);
  const W = Math.max(1, Math.floor(img.width * k)),
    H = Math.max(1, Math.floor(img.height * k));
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * img.height) / H),
      y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * img.width) / W),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / W));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        c = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          c++;
        }
      const o = (y * W + x) * 4;
      out[o] = r / c;
      out[o + 1] = g / c;
      out[o + 2] = b / c;
      out[o + 3] = a / c;
    }
  }
  return { data: out, width: W, height: H };
}

/** Poids par pixel d'une image : produit des critères choisis, nul là où l'image est transparente. */
function weightMap(img: Pixels, opts: FusionOptions): Float32Array {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++)
    gray[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  // Contraste : valeur absolue du laplacien de la luminance.
  const contrast = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = gray[y * w + x];
      const l = gray[y * w + Math.max(0, x - 1)],
        r = gray[y * w + Math.min(w - 1, x + 1)],
        t = gray[Math.max(0, y - 1) * w + x],
        b = gray[Math.min(h - 1, y + 1) * w + x];
      contrast[y * w + x] = Math.abs(l + r + t + b - 4 * c);
    }
  const focus = opts.mode === 'focus';
  // Mise au point : l'énergie du contraste est lissée, pour que le choix suive des zones et non du bruit.
  const sharp = focus ? blur(contrast, w, h, 1) : contrast;
  const wc = opts.contrast ?? 1,
    ws = opts.saturation ?? 1,
    we = opts.exposure ?? 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const alpha = data[i * 4 + 3] / 255;
    if (alpha <= 0) continue;
    if (focus) {
      out[i] = sharp[i] * alpha + 1e-12;
      continue;
    }
    const r = data[i * 4] / 255,
      g = data[i * 4 + 1] / 255,
      b = data[i * 4 + 2] / 255;
    const mean = (r + g + b) / 3;
    const sat = Math.sqrt(((r - mean) ** 2 + (g - mean) ** 2 + (b - mean) ** 2) / 3);
    // Bonne exposition : proche du gris moyen, pour chaque canal (courbe de Gauss, écart 0,2).
    const well = (v: number) => Math.exp(-((v - 0.5) ** 2) / (2 * 0.2 * 0.2));
    const e = well(r) * well(g) * well(b);
    out[i] = (contrast[i] + 1e-3) ** wc * (sat + 1e-3) ** ws * (e + 1e-3) ** we * alpha;
  }
  return out;
}

/**
 * Fusionne des images de même taille (même cadre) en une seule. Renvoie null si `progress`
 * demande d'annuler. Les zones transparentes dans toutes les images restent transparentes.
 */
export function fuseImages(images: Pixels[], opts: FusionOptions): Pixels | null {
  if (!images.length) throw new Error('fusion : aucune image');
  const { width: w, height: h } = images[0];
  for (const im of images)
    if (im.width !== w || im.height !== h) throw new Error('fusion : tailles différentes');
  const n = w * h;
  const count = images.length;
  const levels = levelsFor(w, h);
  // 1 : poids, normalisés pour que leur somme vaille 1 en chaque pixel.
  const weights = images.map((im) => weightMap(im, opts));
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const wm of weights) sum += wm[i];
    for (const im of images) alpha[i] = Math.max(alpha[i], im.data[i * 4 + 3]);
    if (sum > 0) for (const wm of weights) wm[i] /= sum;
  }
  let step = 0;
  const total = count * 2 + 1;
  const tick = (): boolean => !(opts.progress?.(++step / total) === true);
  // 2 : mélange niveau par niveau.
  let result: Level[] | null = null;
  for (let k = 0; k < count; k++) {
    const im = images[k];
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = im.data[i * 4] / 255;
      rgb[i * 3 + 1] = im.data[i * 4 + 1] / 255;
      rgb[i * 3 + 2] = im.data[i * 4 + 2] / 255;
    }
    const lap = laplacianPyramid(rgb, w, h, 3, levels);
    if (!tick()) return null;
    const gw = gaussianPyramid(weights[k], w, h, 1, levels);
    if (!result) result = lap.map((l) => ({ data: new Float32Array(l.data.length), w: l.w, h: l.h }));
    for (let l = 0; l < levels; l++) {
      const dst = result[l].data,
        a = lap[l].data,
        wt = gw[l].data;
      for (let i = 0; i < wt.length; i++) {
        const v = wt[i];
        dst[i * 3] += a[i * 3] * v;
        dst[i * 3 + 1] += a[i * 3 + 1] * v;
        dst[i * 3 + 2] += a[i * 3 + 2] * v;
      }
    }
    if (!tick()) return null;
  }
  // 3 : on remonte la pyramide.
  let cur = result![levels - 1];
  for (let l = levels - 2; l >= 0; l--) {
    const target = result![l];
    const u = up(cur.data, cur.w, cur.h, 3, target.w, target.h);
    for (let i = 0; i < u.length; i++) target.data[i] += u[i];
    cur = target;
  }
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = cur.data[i * 3] * 255;
    out[i * 4 + 1] = cur.data[i * 3 + 1] * 255;
    out[i * 4 + 2] = cur.data[i * 3 + 2] * 255;
    out[i * 4 + 3] = alpha[i];
  }
  tick();
  return { data: out, width: w, height: h };
}
