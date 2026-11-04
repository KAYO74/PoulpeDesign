import type { Pixels } from './adjust';

/*
 * Recalage de deux photos qui se recouvrent par une homographie (changement de perspective) :
 * points d'intérêt de Harris, descripteurs de petites vignettes normalisées, appariement avec test
 * du rapport des deux meilleurs voisins, puis RANSAC. Sert au panorama pour les photos prises en
 * tournant l'appareil. Calcul pur (sans DOM).
 */

/** Matrice 3×3 ligne par ligne : x' = (h0 x + h1 y + h2) / (h6 x + h7 y + h8). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o as Mat3;
}

export function invMat(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const s = 1 / det;
  return [
    A * s,
    -(b * i - c * h) * s,
    (b * f - c * e) * s,
    B * s,
    (a * i - c * g) * s,
    -(a * f - c * d) * s,
    C * s,
    -(a * h - b * g) * s,
    (a * e - b * d) * s,
  ];
}

export function applyMat(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/** Résout A·x = b (n × n) par élimination de Gauss ; null si la matrice est singulière. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Homographie qui envoie les points `from` sur `to` (moindres carrés, h8 = 1), après normalisation
 * des coordonnées pour garder le calcul stable. Au moins quatre couples.
 */
export function fitHomography(from: Pt[], to: Pt[]): Mat3 | null {
  const n = from.length;
  if (n < 4) return null;
  const norm = (p: Pt[]) => {
    let cx = 0,
      cy = 0;
    for (const q of p) {
      cx += q.x;
      cy += q.y;
    }
    cx /= p.length;
    cy /= p.length;
    let d = 0;
    for (const q of p) d += Math.hypot(q.x - cx, q.y - cy);
    const s = d > 1e-9 ? (Math.SQRT2 * p.length) / d : 1;
    return { cx, cy, s };
  };
  const nf = norm(from),
    nt = norm(to);
  const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const Atb = new Array<number>(8).fill(0);
  const add = (row: number[], rhs: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * rhs;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let i = 0; i < n; i++) {
    const x = (from[i].x - nf.cx) * nf.s,
      y = (from[i].y - nf.cy) * nf.s;
    const u = (to[i].x - nt.cx) * nt.s,
      v = (to[i].y - nt.cy) * nt.s;
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // Retour aux coordonnées d'origine : H = Tt⁻¹ · Hn · Tf.
  const Tf: Mat3 = [nf.s, 0, -nf.cx * nf.s, 0, nf.s, -nf.cy * nf.s, 0, 0, 1];
  const Tti: Mat3 = [1 / nt.s, 0, nt.cx, 0, 1 / nt.s, nt.cy, 0, 0, 1];
  const H = mulMat(Tti, mulMat(Hn, Tf));
  const k = H[8];
  return Math.abs(k) < 1e-12 ? null : (H.map((v) => v / k) as Mat3);
}

/** Vrai si l'homographie garde un quadrilatère convexe de taille raisonnable sur un cadre w × h. */
function plausible(H: Mat3, w: number, h: number): boolean {
  const c = [applyMat(H, 0, 0), applyMat(H, w, 0), applyMat(H, w, h), applyMat(H, 0, h)];
  if (c.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return false;
  let sign = 0,
    area = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i],
      [bx, by] = c[(i + 1) % 4],
      [cx, cy] = c[(i + 2) % 4];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
    area += ax * by - bx * ay;
  }
  const ratio = Math.abs(area / 2) / (w * h);
  return ratio > 0.25 && ratio < 4;
}

// ————— Points d'intérêt et descripteurs —————

interface Gray {
  w: number;
  h: number;
  d: Float32Array;
}

/** Image en gris réduite jusqu'à `maxSide` pixels au plus ; `scale` = taille réduite / taille d'origine. */
export function reducedGray(img: Pixels, maxSide: number): Gray & { scale: number } {
  let w = img.width,
    h = img.height;
  let d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++)
    d[i] = (0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]) / 255;
  let scale = 1;
  while (Math.max(w, h) > maxSide) {
    const W = Math.max(1, w >> 1),
      H = Math.max(1, h >> 1);
    const o = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const x1 = Math.min(w - 1, x * 2 + 1),
          y1 = Math.min(h - 1, y * 2 + 1);
        o[y * W + x] = (d[y * 2 * w + x * 2] + d[y * 2 * w + x1] + d[y1 * w + x * 2] + d[y1 * w + x1]) / 4;
      }
    d = o;
    w = W;
    h = H;
    scale /= 2;
  }
  return { w, h, d, scale };
}

/** Moyenne glissante (carré de côté 2r+1, bords répétés). */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / k;
      s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

const PATCH = 8;
const SPACING = 5;
/** Marge (pixels) sans point d'intérêt : la vignette doit tenir dans l'image. */
const MARGIN = (PATCH * SPACING) / 2 + 2;

export interface Features {
  pts: Pt[];
  /** PATCH × PATCH valeurs normalisées par point. */
  desc: Float32Array;
}

/** Au plus `max` coins de Harris bien répartis, et leurs descripteurs. */
export function detectFeatures(g: Gray, max = 600): Features {
  const { w, h } = g;
  const sm = boxMean(g.d, w, h, 1);
  const ixx = new Float32Array(w * h),
    iyy = new Float32Array(w * h),
    ixy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const gx = (sm[y * w + x + 1] - sm[y * w + x - 1]) / 2,
        gy = (sm[(y + 1) * w + x] - sm[(y - 1) * w + x]) / 2;
      const i = y * w + x;
      ixx[i] = gx * gx;
      iyy[i] = gy * gy;
      ixy[i] = gx * gy;
    }
  const sxx = boxMean(ixx, w, h, 2),
    syy = boxMean(iyy, w, h, 2),
    sxy = boxMean(ixy, w, h, 2);
  const resp = new Float32Array(w * h);
  let top = 0;
  for (let y = MARGIN; y < h - MARGIN; y++)
    for (let x = MARGIN; x < w - MARGIN; x++) {
      const i = y * w + x;
      const det = sxx[i] * syy[i] - sxy[i] * sxy[i],
        tr = sxx[i] + syy[i];
      const r = det - 0.04 * tr * tr;
      resp[i] = r;
      if (r > top) top = r;
    }
  const cand: { x: number; y: number; r: number }[] = [];
  const thr = top * 0.01;
  for (let y = MARGIN; y < h - MARGIN; y++)
    for (let x = MARGIN; x < w - MARGIN; x++) {
      const r = resp[y * w + x];
      if (r <= thr) continue;
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if ((dx || dy) && resp[(y + dy) * w + x + dx] >= r) {
            peak = false;
            break;
          }
      if (peak) cand.push({ x, y, r });
    }
  cand.sort((a, b) => b.r - a.r);
  // Répartition : une case occupée par point, pour ne pas tout concentrer au même endroit.
  const cell = 12;
  const cols = Math.ceil(w / cell);
  const taken = new Uint8Array(cols * Math.ceil(h / cell));
  const pts: Pt[] = [];
  for (const c of cand) {
    if (pts.length >= max) break;
    const k = Math.floor(c.y / cell) * cols + Math.floor(c.x / cell);
    if (taken[k]) continue;
    taken[k] = 1;
    pts.push({ x: c.x, y: c.y });
  }
  const blur = boxMean(g.d, w, h, 2);
  const desc = new Float32Array(pts.length * PATCH * PATCH);
  pts.forEach((p, n) => {
    let s = 0,
      s2 = 0;
    const o = n * PATCH * PATCH;
    for (let j = 0; j < PATCH; j++)
      for (let i = 0; i < PATCH; i++) {
        const v =
          blur[
            Math.round(p.y + (j - (PATCH - 1) / 2) * SPACING) * w +
              Math.round(p.x + (i - (PATCH - 1) / 2) * SPACING)
          ];
        desc[o + j * PATCH + i] = v;
        s += v;
        s2 += v * v;
      }
    const m = s / (PATCH * PATCH);
    const sd = Math.sqrt(Math.max(1e-8, s2 / (PATCH * PATCH) - m * m));
    for (let k = 0; k < PATCH * PATCH; k++) desc[o + k] = (desc[o + k] - m) / sd;
  });
  return { pts, desc };
}

/** Couples de points (a dans A, b dans B) : meilleurs voisins réciproques, sûrs face au deuxième. */
export function matchFeatures(A: Features, B: Features, ratio = 0.8): { a: Pt; b: Pt }[] {
  const D = PATCH * PATCH;
  const nearest = (from: Features, to: Features) => {
    const best = new Int32Array(from.pts.length).fill(-1);
    const ok = new Uint8Array(from.pts.length);
    for (let i = 0; i < from.pts.length; i++) {
      let b1 = Infinity,
        b2 = Infinity,
        bj = -1;
      for (let j = 0; j < to.pts.length; j++) {
        let d = 0;
        for (let k = 0; k < D; k++) {
          const e = from.desc[i * D + k] - to.desc[j * D + k];
          d += e * e;
        }
        if (d < b1) {
          b2 = b1;
          b1 = d;
          bj = j;
        } else if (d < b2) b2 = d;
      }
      best[i] = bj;
      ok[i] = bj >= 0 && b1 < ratio * ratio * b2 ? 1 : 0;
    }
    return { best, ok };
  };
  const ab = nearest(A, B),
    ba = nearest(B, A);
  const out: { a: Pt; b: Pt }[] = [];
  for (let i = 0; i < A.pts.length; i++) {
    const j = ab.best[i];
    if (ab.ok[i] && j >= 0 && ba.best[j] === i) out.push({ a: A.pts[i], b: B.pts[j] });
  }
  return out;
}

/** Générateur pseudo-aléatoire déterministe (le même panorama donne toujours le même résultat). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface HomographyFit {
  /** Envoie les coordonnées de l'image B sur celles de l'image A. */
  H: Mat3;
  inliers: number;
  matches: number;
}

/**
 * Homographie B → A par RANSAC sur les couples appariés (seuil `tol` pixels, dans le repère des
 * points). Null si les couples ne s'accordent pas.
 */
export function ransacHomography(
  pairs: { a: Pt; b: Pt }[],
  w: number,
  h: number,
  tol = 3,
  iterations = 1000,
): HomographyFit | null {
  const n = pairs.length;
  if (n < 8) return null;
  const rand = rng(12345);
  const t2 = tol * tol;
  const inliersOf = (H: Mat3): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = applyMat(H, pairs[i].b.x, pairs[i].b.y);
      const dx = x - pairs[i].a.x,
        dy = y - pairs[i].a.y;
      if (dx * dx + dy * dy < t2) out.push(i);
    }
    return out;
  };
  let best: number[] = [];
  for (let it = 0; it < iterations; it++) {
    const idx = new Set<number>();
    while (idx.size < 4) idx.add(Math.floor(rand() * n));
    const s = [...idx];
    const H = fitHomography(
      s.map((i) => pairs[i].b),
      s.map((i) => pairs[i].a),
    );
    if (!H || !plausible(H, w, h)) continue;
    const inl = inliersOf(H);
    if (inl.length > best.length) best = inl;
    if (best.length > 0.9 * n) break;
  }
  if (best.length < 12) return null;
  // Affinage sur tous les accords, deux fois.
  let H: Mat3 | null = null;
  for (let r = 0; r < 2; r++) {
    const f = fitHomography(
      best.map((i) => pairs[i].b),
      best.map((i) => pairs[i].a),
    );
    if (!f || !plausible(f, w, h)) break;
    H = f;
    const next = inliersOf(f);
    if (next.length < 12) break;
    best = next;
  }
  return H ? { H, inliers: best.length, matches: n } : null;
}

/**
 * Homographie qui pose l'image `b` sur l'image `a` (coordonnées en pixels des images d'origine), ou
 * null si les points d'intérêt ne suffisent pas.
 */
export function estimateHomography(a: Pixels, b: Pixels, maxSide = 800): HomographyFit | null {
  const ga = reducedGray(a, maxSide),
    gb = reducedGray(b, maxSide);
  const fa = detectFeatures(ga),
    fb = detectFeatures(gb);
  if (fa.pts.length < 12 || fb.pts.length < 12) return null;
  const pairs = matchFeatures(fa, fb);
  const fit = ransacHomography(pairs, ga.w, ga.h, 3);
  if (!fit) return null;
  // Repère réduit → repère d'origine : H = Sa⁻¹ · H · Sb.
  const Sb: Mat3 = [gb.scale, 0, 0, 0, gb.scale, 0, 0, 0, 1];
  const Sai: Mat3 = [1 / ga.scale, 0, 0, 0, 1 / ga.scale, 0, 0, 0, 1];
  return { ...fit, H: mulMat(Sai, mulMat(fit.H, Sb)) };
}

/**
 * Note de 0 à 1 (corrélation normalisée) de la pose de `b` sur `a` selon `H` (pixels d'origine),
 * mesurée sur des versions réduites ; -1 si elles se recouvrent trop peu. Sert à départager deux
 * recalages candidats (perspective ou simple translation).
 */
export function homographyScore(a: Pixels, b: Pixels, H: Mat3, maxSide = 400): number {
  const ga = reducedGray(a, maxSide),
    gb = reducedGray(b, maxSide);
  // Repère réduit de b → repère réduit de a.
  const Sb: Mat3 = [1 / gb.scale, 0, 0, 0, 1 / gb.scale, 0, 0, 0, 1];
  const Sa: Mat3 = [ga.scale, 0, 0, 0, ga.scale, 0, 0, 0, 1];
  const inv = invMat(mulMat(Sa, mulMat(H, Sb)));
  if (!inv) return -1;
  let n = 0,
    sa = 0,
    sb = 0,
    saa = 0,
    sbb = 0,
    sab = 0;
  for (let y = 0; y < ga.h; y++)
    for (let x = 0; x < ga.w; x++) {
      const [u, v] = applyMat(inv, x, y);
      if (!(u >= 0 && v >= 0 && u <= gb.w - 1 && v <= gb.h - 1)) continue;
      const x0 = Math.floor(u),
        y0 = Math.floor(v),
        x1 = Math.min(gb.w - 1, x0 + 1),
        y1 = Math.min(gb.h - 1, y0 + 1),
        fx = u - x0,
        fy = v - y0;
      const vb =
        gb.d[y0 * gb.w + x0] * (1 - fx) * (1 - fy) +
        gb.d[y0 * gb.w + x1] * fx * (1 - fy) +
        gb.d[y1 * gb.w + x0] * (1 - fx) * fy +
        gb.d[y1 * gb.w + x1] * fx * fy;
      const va = ga.d[y * ga.w + x];
      n++;
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  if (n < 0.1 * Math.min(ga.w * ga.h, gb.w * gb.h)) return -1;
  const cov = sab - (sa * sb) / n,
    va = saa - (sa * sa) / n,
    vb = sbb - (sb * sb) / n;
  if (va < 1e-6 || vb < 1e-6) return -1;
  return cov / Math.sqrt(va * vb);
}
