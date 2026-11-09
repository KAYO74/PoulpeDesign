import type { Pixels } from './adjust';
import {
  IDENTITY,
  applyMat,
  estimateHomography,
  homographyScore,
  invMat,
  mulMat,
  type Mat3,
} from './homography';

/*
 * Panorama : assemble des photos prises à la suite en tournant (ou en glissant) l'appareil, qui se
 * recouvrent en partie. Chaque image est recalée sur la précédente par une translation (corrélation
 * normalisée sur des versions réduites, de la grossière à la fine), puis les images sont fondues
 * ensemble : les gains de luminosité sont égalisés dans les zones communes et les bords sont
 * adoucis pour que les raccords ne se voient pas.
 *
 * Valable pour les prises de vue à main levée sans fort changement de perspective (comme
 * l'assemblage simple d'Affinity ou de Lightroom). Pour les vues très larges (360°, plus de 100°),
 * les images sont d'abord projetées sur un cylindre (distance focale estimée en cherchant celle qui
 * recale le mieux les images voisines), où une rotation de l'appareil devient une simple translation.
 * Calcul pur (sans DOM), pour les tests et les workers.
 */

export interface PanoramaOptions {
  /** Égaliser la luminosité entre images (vrai par défaut). */
  exposure?: boolean;
  /** Corriger la perspective entre images (vrai par défaut) ; sinon, simple translation. */
  perspective?: boolean;
  /**
   * Projection : `planar` (images posées à plat, avec perspective), `cylindrical` (vues très larges,
   * appareil tourné sur lui-même : images projetées sur un cylindre) ou `auto` (par défaut : à plat,
   * puis cylindrique si la vue est trop large pour être mise à plat).
   */
  projection?: 'auto' | 'planar' | 'cylindrical';
  /** Avancement de 0 à 1 ; renvoyer true pour annuler. */
  progress?: (fraction: number) => boolean | void;
}

/** Erreur d'assemblage ; `code` permet à l'interface de la traduire. */
export class PanoramaError extends Error {
  constructor(
    readonly code: 'tooFew' | 'noOverlap' | 'tooLarge',
    /** Numéro (à partir de 1) de la première des deux images concernées. */
    readonly index = 0,
  ) {
    super(`panorama : ${code} ${index}`);
  }
}

export interface PanoramaResult extends Pixels {
  /** Position (indicative) de chaque image dans le panorama, en pixels. */
  offsets: { x: number; y: number }[];
  /** Image de référence, dont le repère sert à placer le résultat. */
  ref: number;
  /** Coin haut gauche du panorama, en pixels de l'image de référence. */
  origin: { x: number; y: number };
}

/** Recouvrement minimal pour fier un recalage (part de la plus petite image). */
const MIN_OVERLAP = 0.1;
/** Plus grand côté (pixels) de la version réduite du recalage grossier. */
const COARSE = 64;
/** Candidats gardés au niveau grossier. */
const CANDIDATES = 6;

interface Gray {
  w: number;
  h: number;
  d: Float32Array;
}

function toGray(img: Pixels): Gray {
  const { width: w, height: h, data } = img;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++)
    d[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  return { w, h, d };
}

/** Moitié de la taille (moyenne de 2×2). */
function half(g: Gray): Gray {
  const w = Math.max(1, g.w >> 1),
    h = Math.max(1, g.h >> 1);
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x1 = Math.min(g.w - 1, x * 2 + 1),
        y1 = Math.min(g.h - 1, y * 2 + 1);
      d[y * w + x] =
        (g.d[y * 2 * g.w + x * 2] + g.d[y * 2 * g.w + x1] + g.d[y1 * g.w + x * 2] + g.d[y1 * g.w + x1]) / 4;
    }
  return { w, h, d };
}

function pyramid(g: Gray): Gray[] {
  const out = [g];
  while (Math.max(out[out.length - 1].w, out[out.length - 1].h) > COARSE) out.push(half(out[out.length - 1]));
  return out;
}

/**
 * Corrélation normalisée de `b` posée à (dx, dy) sur `a` ; -2 si le recouvrement est trop petit.
 * Compte les pixels communs seulement.
 */
function ncc(a: Gray, b: Gray, dx: number, dy: number): number {
  const x0 = Math.max(0, dx),
    x1 = Math.min(a.w, dx + b.w),
    y0 = Math.max(0, dy),
    y1 = Math.min(a.h, dy + b.h);
  const ow = x1 - x0,
    oh = y1 - y0;
  if (ow < 4 || oh < 4 || ow * oh < MIN_OVERLAP * Math.min(a.w * a.h, b.w * b.h)) return -2;
  let sa = 0,
    sb = 0,
    saa = 0,
    sbb = 0,
    sab = 0;
  for (let y = y0; y < y1; y++) {
    let ia = y * a.w + x0,
      ib = (y - dy) * b.w + (x0 - dx);
    for (let x = x0; x < x1; x++, ia++, ib++) {
      const va = a.d[ia],
        vb = b.d[ib];
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  }
  const n = ow * oh;
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n,
    vb = sbb - (sb * sb) / n;
  // Zone unie dans l'une des deux images : pas de repère, on n'y croit pas.
  if (va < 1e-6 || vb < 1e-6) return -1;
  return cov / Math.sqrt(va * vb);
}

/** Décalage (dx, dy) qui pose `b` sur `a`, et la qualité de la correspondance (-1 à 1). */
export function alignPair(a: Pixels, b: Pixels): { dx: number; dy: number; score: number } {
  const pa = pyramid(toGray(a)),
    pb = pyramid(toGray(b));
  const top = Math.min(pa.length, pb.length) - 1;
  // Niveau grossier : toutes les positions ; on garde les meilleures, éloignées les unes des autres
  // (un petit recouvrement peut donner une fausse bonne note).
  const A = pa[top],
    B = pb[top];
  let cands: { dx: number; dy: number; score: number }[] = [];
  for (let dy = -B.h + 1; dy < A.h; dy++)
    for (let dx = -B.w + 1; dx < A.w; dx++) {
      const s = ncc(A, B, dx, dy);
      if (s > -1) cands.push({ dx, dy, score: s });
    }
  cands.sort((p, q) => q.score - p.score);
  const kept: typeof cands = [];
  for (const c of cands) {
    if (kept.length >= CANDIDATES) break;
    if (kept.every((k) => Math.abs(k.dx - c.dx) > 2 || Math.abs(k.dy - c.dy) > 2)) kept.push(c);
  }
  cands = kept;
  // Niveaux plus fins : on affine chaque candidat autour de sa position ; la meilleure note finale gagne.
  let best = { dx: 0, dy: 0, score: -3 };
  for (const c of cands) {
    let cur = c;
    for (let l = top - 1; l >= 0; l--) {
      const cx = cur.dx * 2,
        cy = cur.dy * 2;
      cur = { dx: cx, dy: cy, score: -3 };
      for (let dy = cy - 3; dy <= cy + 3; dy++)
        for (let dx = cx - 3; dx <= cx + 3; dx++) {
          const s = ncc(pa[l], pb[l], dx, dy);
          if (s > cur.score) cur = { dx, dy, score: s };
        }
    }
    if (cur.score > best.score) best = cur;
  }
  return best;
}

/** Poids d'un pixel dans le fondu : 0 au bord, 1 loin des bords. */
function feather(x: number, y: number, w: number, h: number): number {
  const m = Math.min(x + 0.5, w - x - 0.5, y + 0.5, h - y - 0.5);
  return Math.max(1e-3, Math.min(1, m / Math.max(2, Math.min(w, h) * 0.12)));
}

/** Assemblage quand les images ne diffèrent que par une translation (`pos` : position de chacune). */
function composeTranslation(
  images: Pixels[],
  pos: { x: number; y: number }[],
  opts: PanoramaOptions,
  tick: () => boolean,
): PanoramaResult | null {
  const minX = Math.min(...pos.map((p) => p.x)),
    minY = Math.min(...pos.map((p) => p.y));
  const offsets = pos.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  const W = Math.max(...images.map((im, i) => offsets[i].x + im.width)),
    H = Math.max(...images.map((im, i) => offsets[i].y + im.height));
  if (W * H > 120_000_000) throw new PanoramaError('tooLarge');
  // 2 : gains de luminosité, d'une image à la suivante, sur leur zone commune.
  const gains = new Array<number>(images.length).fill(1);
  if (opts.exposure !== false)
    for (let i = 1; i < images.length; i++) {
      const a = images[i - 1],
        b = images[i];
      const dx = offsets[i].x - offsets[i - 1].x,
        dy = offsets[i].y - offsets[i - 1].y;
      let sa = 0,
        sb = 0;
      for (let y = Math.max(0, dy); y < Math.min(a.height, dy + b.height); y++)
        for (let x = Math.max(0, dx); x < Math.min(a.width, dx + b.width); x++) {
          const ia = (y * a.width + x) * 4,
            ib = ((y - dy) * b.width + (x - dx)) * 4;
          if (a.data[ia + 3] === 0 || b.data[ib + 3] === 0) continue;
          sa += a.data[ia] + a.data[ia + 1] + a.data[ia + 2];
          sb += b.data[ib] + b.data[ib + 1] + b.data[ib + 2];
        }
      const g = sb > 0 && sa > 0 ? (sa / sb) * gains[i - 1] : gains[i - 1];
      gains[i] = Math.min(1.5, Math.max(1 / 1.5, g));
    }
  // 3 : fondu pondéré par la distance au bord de chaque image.
  const acc = new Float32Array(W * H * 3),
    wsum = new Float32Array(W * H),
    alpha = new Float32Array(W * H);
  images.forEach((im, k) => {
    const { x: ox, y: oy } = offsets[k];
    for (let y = 0; y < im.height; y++)
      for (let x = 0; x < im.width; x++) {
        const s = (y * im.width + x) * 4,
          t = (oy + y) * W + ox + x;
        const a = im.data[s + 3] / 255;
        if (a <= 0) continue;
        const w = feather(x, y, im.width, im.height) * a;
        acc[t * 3] += im.data[s] * gains[k] * w;
        acc[t * 3 + 1] += im.data[s + 1] * gains[k] * w;
        acc[t * 3 + 2] += im.data[s + 2] * gains[k] * w;
        wsum[t] += w;
        alpha[t] = Math.max(alpha[t], a);
      }
  });
  if (!tick()) return null;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    if (wsum[i] <= 0) continue;
    out[i * 4] = acc[i * 3] / wsum[i];
    out[i * 4 + 1] = acc[i * 3 + 1] / wsum[i];
    out[i * 4 + 2] = acc[i * 3 + 2] / wsum[i];
    out[i * 4 + 3] = alpha[i] * 255;
  }
  return { data: out, width: W, height: H, offsets, ref: 0, origin: { x: -offsets[0].x, y: -offsets[0].y } };
}

/** Largeur maximale (pixels) du panorama de perspective : au-delà, l'image explose. */
const MAX_SIDE = 60000;
/** Étirement maximal (en surface) d'une image mise à plat avant de passer en projection cylindrique. */
const MAX_STRETCH = 3;

interface Placed {
  /** Image → repère de l'image de référence. */
  M: Mat3;
  /** Repère de l'image de référence → image. */
  Minv: Mat3;
}

/**
 * Parcourt chaque pixel de la sortie couvert par l'image `im` (posée par `pl`), échantillonne
 * l'image (bilinéaire) et appelle `put` avec la position de sortie, la couleur, l'opacité et le poids
 * du fondu. La sortie est à l'échelle `r` ; son coin haut gauche est en (ox, oy) dans le repère de
 * l'image de référence.
 */
function warpImage(
  im: Pixels,
  pl: Placed,
  r: number,
  ox: number,
  oy: number,
  outW: number,
  outH: number,
  put: (index: number, red: number, green: number, blue: number, alpha: number, weight: number) => void,
): void {
  const { width: w, height: h, data } = im;
  // Boîte de la sortie touchée par l'image.
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [cx, cy] of [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]) {
    const [rx, ry] = applyMat(pl.M, cx, cy);
    x0 = Math.min(x0, (rx - ox) * r);
    x1 = Math.max(x1, (rx - ox) * r);
    y0 = Math.min(y0, (ry - oy) * r);
    y1 = Math.max(y1, (ry - oy) * r);
  }
  const X0 = Math.max(0, Math.floor(x0)),
    X1 = Math.min(outW, Math.ceil(x1) + 1),
    Y0 = Math.max(0, Math.floor(y0)),
    Y1 = Math.min(outH, Math.ceil(y1) + 1);
  const m = pl.Minv;
  for (let Y = Y0; Y < Y1; Y++)
    for (let X = X0; X < X1; X++) {
      const rx = X / r + ox,
        ry = Y / r + oy;
      const den = m[6] * rx + m[7] * ry + m[8];
      const sx = (m[0] * rx + m[1] * ry + m[2]) / den,
        sy = (m[3] * rx + m[4] * ry + m[5]) / den;
      if (!(sx >= 0 && sy >= 0 && sx <= w - 1 && sy <= h - 1)) continue;
      const ix = Math.floor(sx),
        iy = Math.floor(sy),
        fx = sx - ix,
        fy = sy - iy;
      const jx = Math.min(w - 1, ix + 1),
        jy = Math.min(h - 1, iy + 1);
      const p00 = (iy * w + ix) * 4,
        p10 = (iy * w + jx) * 4,
        p01 = (jy * w + ix) * 4,
        p11 = (jy * w + jx) * 4;
      const w00 = (1 - fx) * (1 - fy),
        w10 = fx * (1 - fy),
        w01 = (1 - fx) * fy,
        w11 = fx * fy;
      const a = (data[p00 + 3] * w00 + data[p10 + 3] * w10 + data[p01 + 3] * w01 + data[p11 + 3] * w11) / 255;
      if (a <= 0) continue;
      put(
        Y * outW + X,
        data[p00] * w00 + data[p10] * w10 + data[p01] * w01 + data[p11] * w11,
        data[p00 + 1] * w00 + data[p10 + 1] * w10 + data[p01 + 1] * w01 + data[p11 + 1] * w11,
        data[p00 + 2] * w00 + data[p10 + 2] * w10 + data[p01 + 2] * w01 + data[p11 + 2] * w11,
        a,
        feather(sx, sy, w, h) * a,
      );
    }
}

/** Assemblage avec correction de perspective : image du milieu en référence, fondu pondéré. */
function composeProjective(
  images: Pixels[],
  pairs: Mat3[],
  opts: PanoramaOptions,
  tick: () => boolean,
): PanoramaResult | null {
  const n = images.length;
  const ref = n >> 1;
  // Chaque image dans le repère de la référence : on enchaîne les paires depuis la référence.
  const M: Mat3[] = new Array<Mat3>(n);
  M[ref] = IDENTITY;
  for (let i = ref + 1; i < n; i++) M[i] = mulMat(M[i - 1], pairs[i]);
  for (let i = ref - 1; i >= 0; i--) {
    const inv = invMat(pairs[i + 1]);
    if (!inv) throw new PanoramaError('noOverlap', i + 1);
    M[i] = mulMat(M[i + 1], inv);
  }
  const placed: Placed[] = M.map((m) => {
    const inv = invMat(m);
    if (!inv) throw new PanoramaError('tooLarge');
    return { M: m, Minv: inv };
  });
  // Boîte du panorama dans le repère de la référence.
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  images.forEach((im, i) => {
    for (const [cx, cy] of [
      [0, 0],
      [im.width, 0],
      [im.width, im.height],
      [0, im.height],
    ]) {
      const den = M[i][6] * cx + M[i][7] * cy + M[i][8];
      const [rx, ry] = applyMat(M[i], cx, cy);
      // Un coin qui passe « derrière » l'appareil : la perspective n'a plus de sens.
      if (den <= 0 || !Number.isFinite(rx) || !Number.isFinite(ry)) throw new PanoramaError('tooLarge');
      x0 = Math.min(x0, rx);
      x1 = Math.max(x1, rx);
      y0 = Math.min(y0, ry);
      y1 = Math.max(y1, ry);
    }
  });
  // Une image étirée de plus de 3 fois en surface : vue trop large pour être mise à plat.
  if (opts.projection !== 'planar')
    images.forEach((im, i) => {
      const q = [
        [0, 0],
        [im.width, 0],
        [im.width, im.height],
        [0, im.height],
      ].map(([cx, cy]) => applyMat(M[i], cx, cy));
      let area = 0;
      for (let j = 0; j < 4; j++) area += q[j][0] * q[(j + 1) % 4][1] - q[(j + 1) % 4][0] * q[j][1];
      if (Math.abs(area) / 2 > MAX_STRETCH * im.width * im.height) throw new PanoramaError('tooLarge');
    });
  const ox = Math.floor(x0),
    oy = Math.floor(y0);
  const W = Math.ceil(x1) - ox,
    H = Math.ceil(y1) - oy;
  if (W > MAX_SIDE || H > MAX_SIDE || W * H > 120_000_000) throw new PanoramaError('tooLarge');
  // Gains de luminosité : sur une version réduite, l'écart moyen entre voisines sur leur zone commune.
  const gains = new Array<number>(n).fill(1);
  if (opts.exposure !== false) {
    const r = Math.min(1, 400 / Math.max(W, H));
    const lw = Math.max(1, Math.ceil(W * r)),
      lh = Math.max(1, Math.ceil(H * r));
    const lum = images.map((im, i) => {
      const L = new Float32Array(lw * lh).fill(-1);
      warpImage(im, placed[i], r, ox, oy, lw, lh, (idx, red, green, blue) => {
        L[idx] = red + green + blue;
      });
      return L;
    });
    const link = (i: number, j: number) => {
      // Gain de j déduit de celui de i, voisine déjà réglée.
      let si = 0,
        sj = 0;
      for (let k = 0; k < lw * lh; k++)
        if (lum[i][k] >= 0 && lum[j][k] >= 0) {
          si += lum[i][k];
          sj += lum[j][k];
        }
      const g = si > 0 && sj > 0 ? (si / sj) * gains[i] : gains[i];
      gains[j] = Math.min(1.5, Math.max(1 / 1.5, g));
    };
    for (let j = ref + 1; j < n; j++) link(j - 1, j);
    for (let j = ref - 1; j >= 0; j--) link(j + 1, j);
  }
  if (!tick()) return null;
  const acc = new Float32Array(W * H * 3),
    wsum = new Float32Array(W * H),
    alpha = new Float32Array(W * H);
  for (let k = 0; k < n; k++) {
    const g = gains[k];
    warpImage(images[k], placed[k], 1, ox, oy, W, H, (t, red, green, blue, a, w) => {
      acc[t * 3] += red * g * w;
      acc[t * 3 + 1] += green * g * w;
      acc[t * 3 + 2] += blue * g * w;
      wsum[t] += w;
      if (a > alpha[t]) alpha[t] = a;
    });
    if (!tick()) return null;
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    if (wsum[i] <= 0) continue;
    out[i * 4] = acc[i * 3] / wsum[i];
    out[i * 4 + 1] = acc[i * 3 + 1] / wsum[i];
    out[i * 4 + 2] = acc[i * 3 + 2] / wsum[i];
    out[i * 4 + 3] = alpha[i] * 255;
  }
  tick();
  // Position de chaque image dans le panorama (coin haut gauche, indicatif).
  const offsets = images.map((im, i) => {
    const [rx, ry] = applyMat(M[i], 0, 0);
    return { x: Math.round(rx - ox), y: Math.round(ry - oy) };
  });
  return { data: out, width: W, height: H, offsets, ref, origin: { x: ox, y: oy } };
}

/** Matrice de translation. */
const shift = (dx: number, dy: number): Mat3 => [1, 0, dx, 0, 1, dy, 0, 0, 1];

/** Panorama assemblé et note du plus mauvais recalage entre deux images voisines (de -1 à 1). */
interface Stitched {
  result: PanoramaResult;
  quality: number;
}

/** En dessous de cette note, l'assemblage à plat est suspect : on essaie aussi le cylindrique. */
const FLAT_TRUSTED = 0.75;
/** Avance minimale de la note cylindrique sur la note à plat pour préférer le cylindrique. */
const CYLINDER_MARGIN = 0.1;

/** Version réduite (moyenne par blocs) dont le plus grand côté ne dépasse pas `maxSide`. */
function shrink(im: Pixels, maxSide: number): Pixels {
  const k = maxSide / Math.max(im.width, im.height);
  if (k >= 1) return im;
  const w = Math.max(1, Math.round(im.width * k)),
    h = Math.max(1, Math.round(im.height * k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / k),
      y1 = Math.min(im.height, Math.max(y0 + 1, Math.ceil((y + 1) / k)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / k),
        x1 = Math.min(im.width, Math.max(x0 + 1, Math.ceil((x + 1) / k)));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        c = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * im.width + xx) * 4;
          r += im.data[i];
          g += im.data[i + 1];
          b += im.data[i + 2];
          a += im.data[i + 3];
          c++;
        }
      out.set([r / c, g / c, b / c, a / c], (y * w + x) * 4);
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Image projetée sur un cylindre de rayon `f` (la distance focale, en pixels) : une rotation de
 * l'appareil autour de l'axe vertical devient une translation horizontale. Au-delà de l'image
 * d'origine, la couleur du bord est reprise et l'opacité est nulle.
 */
function toCylinder(im: Pixels, f: number): Pixels {
  const { width: w, height: h, data } = im;
  const cx = w / 2,
    cy = h / 2;
  const u0 = f * Math.atan(-cx / f),
    u1 = f * Math.atan((w - cx) / f);
  const W = Math.max(1, Math.ceil(u1 - u0));
  const sxs = new Float32Array(W),
    scale = new Float32Array(W);
  for (let u = 0; u < W; u++) {
    const th = (u + 0.5 + u0) / f;
    sxs[u] = f * Math.tan(th) + cx;
    scale[u] = 1 / Math.cos(th);
  }
  const out = new Uint8ClampedArray(W * h * 4);
  for (let v = 0; v < h; v++)
    for (let u = 0; u < W; u++) {
      const sx = sxs[u],
        sy = (v + 0.5 - cy) * scale[u] + cy;
      const inside = sx >= 0 && sx <= w - 1 && sy >= 0 && sy <= h - 1;
      const px = Math.min(w - 1, Math.max(0, sx)),
        py = Math.min(h - 1, Math.max(0, sy));
      const ix = Math.floor(px),
        iy = Math.floor(py),
        fx = px - ix,
        fy = py - iy;
      const jx = Math.min(w - 1, ix + 1),
        jy = Math.min(h - 1, iy + 1);
      const p00 = (iy * w + ix) * 4,
        p10 = (iy * w + jx) * 4,
        p01 = (jy * w + ix) * 4,
        p11 = (jy * w + jx) * 4;
      const w00 = (1 - fx) * (1 - fy),
        w10 = fx * (1 - fy),
        w01 = (1 - fx) * fy,
        w11 = fx * fy;
      const o = (v * W + u) * 4;
      for (let c = 0; c < 3; c++)
        out[o + c] = data[p00 + c] * w00 + data[p10 + c] * w10 + data[p01 + c] * w01 + data[p11 + c] * w11;
      out[o + 3] = inside
        ? data[p00 + 3] * w00 + data[p10 + 3] * w10 + data[p01 + 3] * w01 + data[p11 + 3] * w11
        : 0;
    }
  return { data: out, width: W, height: h };
}

/** Plus grand côté (pixels) des images pendant la recherche de la distance focale. */
const SEARCH_SIDE = 200;
/** Distances focales essayées, en multiples du plus grand côté de l'image (de 40° à 140° de champ environ). */
const FOCAL_FROM = 0.45,
  FOCAL_TO = 3,
  FOCAL_STEP = 1.2;

/** Somme des notes de recalage des paires voisines, images projetées avec la distance focale `k`. */
function cylinderScore(small: Pixels[], k: number): number {
  let prev: Pixels | null = null;
  let sum = 0;
  for (const im of small) {
    const cur = toCylinder(im, k * Math.max(im.width, im.height));
    if (prev) sum += alignPair(prev, cur).score;
    prev = cur;
  }
  return sum;
}

/**
 * Assemblage cylindrique, pour les vues très larges : on cherche la distance focale qui recale le
 * mieux les images voisines (sur des versions réduites), puis on projette les images sur le cylindre
 * et on les assemble par simple translation.
 */
function stitchCylindrical(images: Pixels[], opts: PanoramaOptions): Stitched | null {
  const n = images.length;
  const total = n * 2 + 4;
  let step = 0;
  const tick = (): boolean => !(opts.progress?.(Math.min(1, ++step / total)) === true);
  const small = images.map((im) => shrink(im, SEARCH_SIDE));
  let best = { k: 1, score: -Infinity };
  const tryK = (k: number) => {
    const score = cylinderScore(small, k);
    if (score > best.score) best = { k, score };
  };
  for (let k = FOCAL_FROM; k <= FOCAL_TO; k *= FOCAL_STEP) tryK(k);
  if (!tick()) return null;
  for (const spread of [1.1, 1.04, 1.015]) {
    const centre = best.k;
    tryK(centre / spread);
    tryK(centre * spread);
  }
  if (!tick()) return null;
  const warped: Pixels[] = [];
  for (const im of images) {
    warped.push(toCylinder(im, best.k * Math.max(im.width, im.height)));
    if (!tick()) return null;
  }
  const pos: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let quality = 1;
  for (let i = 1; i < n; i++) {
    const r = alignPair(warped[i - 1], warped[i]);
    if (r.score < 0.3) throw new PanoramaError('noOverlap', i);
    quality = Math.min(quality, r.score);
    pos.push({ x: pos[i - 1].x + r.dx, y: pos[i - 1].y + r.dy });
  }
  if (!tick()) return null;
  const result = composeTranslation(warped, pos, opts, tick);
  return result && { result, quality };
}

/** Assemblage à plat : recalage de chaque image sur la précédente (perspective ou translation). */
function stitchPlanar(images: Pixels[], opts: PanoramaOptions): Stitched | null {
  const n = images.length;
  const total = n * 2 + 1;
  let step = 0;
  const tick = (): boolean => !(opts.progress?.(++step / total) === true);
  // 1 : position de chaque image par rapport à la précédente (homographie ou translation).
  const pairs: Mat3[] = [IDENTITY];
  let projective = false;
  let quality = 1;
  for (let i = 1; i < n; i++) {
    const fit = opts.perspective === false ? null : estimateHomography(images[i - 1], images[i]);
    const r = alignPair(images[i - 1], images[i]);
    const T = shift(r.dx, r.dy);
    // On garde la perspective seulement si elle ne recale pas moins bien que la simple translation
    // (sur des motifs répétitifs, les points d'intérêt peuvent se tromper).
    const tScore = r.score >= 0.3 ? homographyScore(images[i - 1], images[i], T) : -1;
    const hScore = fit ? homographyScore(images[i - 1], images[i], fit.H) : -1;
    if (fit && hScore >= 0.3 && hScore >= tScore - 0.02) {
      pairs.push(fit.H);
      projective = true;
      quality = Math.min(quality, hScore);
    } else if (tScore >= 0.3 || r.score >= 0.3) {
      pairs.push(T);
      quality = Math.min(quality, Math.max(tScore, r.score));
    } else throw new PanoramaError('noOverlap', i);
    if (!tick()) return null;
  }
  if (!projective) {
    const pos: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    for (let i = 1; i < n; i++) pos.push({ x: pos[i - 1].x + pairs[i][2], y: pos[i - 1].y + pairs[i][5] });
    const result = composeTranslation(images, pos, opts, tick);
    return result && { result, quality };
  }
  const result = composeProjective(images, pairs, opts, tick);
  return result && { result, quality };
}

/**
 * Assemble les images dans l'ordre donné (chacune recouvre la précédente). Renvoie null si
 * `progress` demande d'annuler. Lève une erreur si deux images consécutives ne se recouvrent pas.
 * Avec `perspective` (par défaut), le recalage corrige la perspective ; s'il échoue pour une paire,
 * la translation prend le relais. Voir `projection` pour les vues très larges.
 */
export function stitchPanorama(images: Pixels[], opts: PanoramaOptions = {}): PanoramaResult | null {
  if (images.length < 2) throw new PanoramaError('tooFew');
  if (opts.projection === 'cylindrical') return stitchCylindrical(images, opts)?.result ?? null;
  if (opts.projection === 'planar' || opts.perspective === false)
    return stitchPlanar(images, opts)?.result ?? null;
  // Automatique : à plat d'abord ; si c'est impossible ou suspect (vue très large), on essaie le cylindrique.
  let flat: Stitched | null = null;
  let failure: unknown = null;
  try {
    flat = stitchPlanar(images, opts);
    if (!flat) return null;
  } catch (e) {
    if (!(e instanceof PanoramaError)) throw e;
    failure = e;
  }
  if (flat && flat.quality >= FLAT_TRUSTED) return flat.result;
  let round: Stitched | null = null;
  try {
    round = stitchCylindrical(images, opts);
    if (!round) return null;
  } catch (e) {
    if (!(e instanceof PanoramaError)) throw e;
  }
  if (round && (!flat || round.quality > flat.quality + CYLINDER_MARGIN)) return round.result;
  if (flat) return flat.result;
  throw failure;
}
