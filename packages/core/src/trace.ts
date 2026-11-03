import type { Box, PathCommand, Vec } from './geometry';
import type { Pixels } from './adjust';

/*
 * Vectorisation d'image (« Image Trace » d'Illustrator) : une image devient des tracés
 * vectoriels, une couleur par tracé.
 *
 * 1. Les couleurs sont réduites (k-moyennes, ou seuil en noir et blanc).
 * 2. Les petites taches sont fondues dans la couleur qui les entoure.
 * 3. Les couleurs sont empilées, de la plus étendue (en dessous) à la moins étendue : chaque
 *    tracé couvre aussi la place des couleurs posées au-dessus de lui, ce qui évite les fentes
 *    entre deux couleurs voisines.
 * 4. Les contours de chaque couleur suivent les bords des pixels, puis des courbes de Bézier sont
 *    ajustées dessus (algorithme de Schneider), avec des coins là où le contour tourne net.
 *
 * Tout est en JavaScript simple, sans DOM : le calcul tourne dans un Web Worker.
 */

export type TraceMode = 'bw' | 'gray' | 'color';

export interface TraceOptions {
  mode: TraceMode;
  /** Nombre de couleurs (ou de gris), de 2 à 64. */
  colors: number;
  /** Noir et blanc : seuil de luminosité (0 à 255), les pixels plus sombres sont noirs. */
  threshold: number;
  /** Plus petite tache gardée, en pixels de l'image tracée. */
  noise: number;
  /** Écart maximal entre les courbes et le contour des pixels, en pixels (0,2 à 5). */
  tolerance: number;
  /** Un nœud dont le contour tourne de plus de cet angle (degrés) reste un coin. */
  cornerAngle: number;
  /** Laisse de côté le blanc (le fond d'un dessin ou d'un logo). */
  ignoreWhite: boolean;
}

export const DEFAULT_TRACE: TraceOptions = {
  mode: 'color',
  colors: 6,
  threshold: 128,
  noise: 8,
  tolerance: 1,
  cornerAngle: 60,
  ignoreWhite: false,
};

/** Préréglages, comme ceux d'Illustrator. */
export const TRACE_PRESETS = {
  logo: { mode: 'color', colors: 6, noise: 12, tolerance: 1, cornerAngle: 55, ignoreWhite: false },
  blackWhite: { mode: 'bw', threshold: 128, noise: 8, tolerance: 1, cornerAngle: 60, ignoreWhite: true },
  sketch: { mode: 'bw', threshold: 170, noise: 16, tolerance: 1.5, cornerAngle: 70, ignoreWhite: true },
  grays: { mode: 'gray', colors: 6, noise: 10, tolerance: 1, cornerAngle: 60, ignoreWhite: false },
  photoLow: { mode: 'color', colors: 12, noise: 16, tolerance: 1.5, cornerAngle: 80, ignoreWhite: false },
  photoHigh: { mode: 'color', colors: 32, noise: 4, tolerance: 0.8, cornerAngle: 80, ignoreWhite: false },
} satisfies Record<string, Partial<TraceOptions>>;
export type TracePreset = keyof typeof TRACE_PRESETS;

export interface TraceLayer {
  /** Couleur de remplissage `#rrggbb`. */
  color: string;
  /** Contours (extérieurs et trous) en coordonnées des pixels, à remplir en pair-impair. */
  commands: PathCommand[];
  bounds: Box;
}

export interface TraceResult {
  width: number;
  height: number;
  layers: TraceLayer[];
}

/** Générateur pseudo-aléatoire reproductible (mulberry32) : le même réglage donne le même résultat. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex2 = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, '0');
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Étiquetage confié au moteur Rust (worker de vectorisation) : étiquettes et totaux des groupes. */
export type TraceLabeler = (
  data: Uint8ClampedArray,
  centers: number[],
  dim: number,
  ignoreWhite: boolean,
) => { labels: Int32Array; sums: Float64Array } | null;

let labeler: TraceLabeler | null = null;

/** Branche (ou débranche, avec null) le moteur Rust sur la vectorisation. */
export function setTraceLabeler(f: TraceLabeler | null): void {
  labeler = f;
}

/**
 * Réduit l'image à quelques couleurs : renvoie une étiquette par pixel (-1 = transparent ou ignoré)
 * et la palette (r, g, b à la suite).
 */
export function quantize(img: Pixels, opts: TraceOptions): { labels: Int32Array; palette: number[] } {
  const { data, width, height } = img;
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const isWhite = (i: number) => {
    const r = data[i * 4],
      g = data[i * 4 + 1],
      b = data[i * 4 + 2];
    return r > 235 && g > 235 && b > 235;
  };
  if (opts.mode === 'bw') {
    for (let i = 0; i < n; i++) {
      if (data[i * 4 + 3] < 128) continue;
      const dark = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < opts.threshold;
      if (dark) labels[i] = 0;
      else if (!opts.ignoreWhite) labels[i] = 1;
    }
    return { labels, palette: [0, 0, 0, 255, 255, 255] };
  }
  const k = Math.max(2, Math.min(64, Math.round(opts.colors)));
  const gray = opts.mode === 'gray';
  const dim = gray ? 1 : 3;
  // Échantillon des pixels pris en compte.
  const keepAll = new Int32Array(n);
  let kept = 0;
  for (let i = 0; i < n; i++)
    if (data[i * 4 + 3] >= 128 && !(opts.ignoreWhite && isWhite(i))) keepAll[kept++] = i;
  if (!kept) return { labels, palette: [] };
  const keep = keepAll.subarray(0, kept);
  const value = (i: number, out: number[]) => {
    const r = data[i * 4],
      g = data[i * 4 + 1],
      b = data[i * 4 + 2];
    if (gray) out[0] = luma(r, g, b);
    else {
      out[0] = r;
      out[1] = g;
      out[2] = b;
    }
  };
  const random = rng(1234);
  const sampleSize = Math.min(keep.length, 24000);
  const sample = new Float64Array(sampleSize * dim);
  const tmp = [0, 0, 0];
  for (let s = 0; s < sampleSize; s++) {
    const i = keep[sampleSize === keep.length ? s : Math.floor(random() * keep.length)];
    value(i, tmp);
    for (let c = 0; c < dim; c++) sample[s * dim + c] = tmp[c];
  }
  // Initialisation k-means++.
  const centers: number[] = [];
  const first = Math.floor(random() * sampleSize);
  for (let c = 0; c < dim; c++) centers.push(sample[first * dim + c]);
  const dist = new Float64Array(sampleSize).fill(Infinity);
  const d2 = (s: number, j: number) => {
    let d = 0;
    for (let c = 0; c < dim; c++) {
      const v = sample[s * dim + c] - centers[j * dim + c];
      d += v * v;
    }
    return d;
  };
  while (centers.length / dim < k) {
    const j = centers.length / dim - 1;
    let total = 0;
    for (let s = 0; s < sampleSize; s++) {
      dist[s] = Math.min(dist[s], d2(s, j));
      total += dist[s];
    }
    if (total === 0) break;
    let r = random() * total;
    let pick = 0;
    for (; pick < sampleSize - 1; pick++) {
      r -= dist[pick];
      if (r <= 0) break;
    }
    for (let c = 0; c < dim; c++) centers.push(sample[pick * dim + c]);
  }
  const kk = centers.length / dim;
  const nearest = (v: ArrayLike<number>, off: number) => {
    let best = 0,
      bestD = Infinity;
    for (let j = 0; j < kk; j++) {
      let d = 0;
      for (let c = 0; c < dim; c++) {
        const e = v[off + c] - centers[j * dim + c];
        d += e * e;
      }
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  };
  const sums = new Float64Array(kk * dim);
  const counts = new Float64Array(kk);
  for (let iter = 0; iter < 16; iter++) {
    sums.fill(0);
    counts.fill(0);
    for (let s = 0; s < sampleSize; s++) {
      const j = nearest(sample, s * dim);
      counts[j]++;
      for (let c = 0; c < dim; c++) sums[j * dim + c] += sample[s * dim + c];
    }
    let moved = 0;
    for (let j = 0; j < kk; j++) {
      if (!counts[j]) continue;
      for (let c = 0; c < dim; c++) {
        const v = sums[j * dim + c] / counts[j];
        moved = Math.max(moved, Math.abs(v - centers[j * dim + c]));
        centers[j * dim + c] = v;
      }
    }
    if (moved < 0.5) break;
  }
  // Étiquetage de tous les pixels, et couleur moyenne réelle de chaque groupe : par le moteur
  // Rust s'il est branché (même résultat), sinon ici.
  const fast = labeler?.(data, centers, dim, !!opts.ignoreWhite);
  if (fast) {
    const palette: number[] = [];
    for (let j = 0; j < kk; j++) {
      const c = Math.max(1, fast.sums[j * 4]);
      if (gray) palette.push(centers[j], centers[j], centers[j]);
      else palette.push(fast.sums[j * 4 + 1] / c, fast.sums[j * 4 + 2] / c, fast.sums[j * 4 + 3] / c);
    }
    return { labels: fast.labels, palette };
  }
  sums.fill(0);
  counts.fill(0);
  const rgb = new Float64Array(kk * 3);
  const v = [0, 0, 0];
  for (const i of keep) {
    value(i, v);
    const j = nearest(v, 0);
    labels[i] = j;
    counts[j]++;
    rgb[j * 3] += data[i * 4];
    rgb[j * 3 + 1] += data[i * 4 + 1];
    rgb[j * 3 + 2] += data[i * 4 + 2];
  }
  const palette: number[] = [];
  for (let j = 0; j < kk; j++) {
    const c = Math.max(1, counts[j]);
    if (gray) {
      const l = centers[j];
      palette.push(l, l, l);
    } else palette.push(rgb[j * 3] / c, rgb[j * 3 + 1] / c, rgb[j * 3 + 2] / c);
  }
  return { labels, palette };
}

/**
 * Fond les taches de moins de `minArea` pixels (4-connexité) dans l'étiquette voisine la plus
 * présente sur leur bord. Les pixels transparents (-1) ne bougent pas.
 */
export function despeckle(labels: Int32Array, width: number, height: number, minArea: number): void {
  if (minArea <= 1) return;
  const n = width * height;
  const comp = new Int32Array(n);
  const stack = new Int32Array(n);
  const members = new Int32Array(n);
  for (let pass = 0; pass < 3; pass++) {
    comp.fill(-1);
    let changed = false;
    let id = 0;
    for (let start = 0; start < n; start++) {
      if (comp[start] >= 0 || labels[start] < 0) continue;
      const label = labels[start];
      let sp = 0,
        count = 0;
      stack[sp++] = start;
      comp[start] = id;
      const border = new Map<number, number>();
      while (sp) {
        const p = stack[--sp];
        members[count++] = p;
        const x = p % width,
          y = (p - x) / width;
        for (let d = 0; d < 4; d++) {
          const nx = d === 0 ? x - 1 : d === 1 ? x + 1 : x,
            ny = d === 2 ? y - 1 : d === 3 ? y + 1 : y;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          const lq = labels[q];
          if (lq === label) {
            if (comp[q] < 0) {
              comp[q] = id;
              stack[sp++] = q;
            }
          } else if (lq >= 0 && count < minArea) border.set(lq, (border.get(lq) ?? 0) + 1);
        }
      }
      if (count < minArea && border.size) {
        let best = -1,
          bestN = 0;
        for (const [l, c] of border)
          if (c > bestN) {
            bestN = c;
            best = l;
          }
        for (let m = 0; m < count; m++) labels[members[m]] = best;
        changed = true;
      }
      id++;
    }
    if (!changed) break;
  }
}

// Directions sur la grille des coins de pixels : est, sud, ouest, nord.
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * Contours d'un masque binaire, en boucles de coins de pixels (le dedans à droite du sens de
 * parcours, y vers le bas). Aux points selles, on tourne à droite : deux pixels qui ne se touchent
 * que par un coin restent séparés.
 */
export function traceContours(inside: Uint8Array, width: number, height: number): Vec[][] {
  const W = width + 1;
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && inside[y * width + x] === 1;
  // Bits des arêtes sortantes de chaque coin.
  const out = new Uint8Array(W * (height + 1));
  let edges = 0;
  for (let y = 0; y <= height; y++)
    for (let x = 0; x <= width; x++) {
      const cur = at(x, y);
      if (x < width && cur !== at(x, y - 1)) {
        // Arête du haut du pixel (x, y) : vers l'est si le pixel est dedans, sinon vers l'ouest.
        if (cur) out[y * W + x] |= 1;
        else out[y * W + x + 1] |= 4;
        edges++;
      }
      if (y < height && cur !== at(x - 1, y)) {
        // Arête de gauche : vers le nord si dedans, sinon vers le sud.
        if (cur) out[(y + 1) * W + x] |= 8;
        else out[y * W + x] |= 2;
        edges++;
      }
    }
  const loops: Vec[][] = [];
  if (!edges) return loops;
  for (let v = 0; v < out.length; v++) {
    while (out[v]) {
      let dir = out[v] & 1 ? 0 : out[v] & 2 ? 1 : out[v] & 4 ? 2 : 3;
      let x = v % W,
        y = (v - x) / W;
      const loop: Vec[] = [{ x, y }];
      let cur = v;
      for (let guard = 0; guard <= edges; guard++) {
        out[cur] &= ~(1 << dir);
        x += DX[dir];
        y += DY[dir];
        cur = y * W + x;
        // Retour au départ : la boucle est fermée (le remplissage pair-impair ne dépend pas de la
        // façon dont les arêtes sont réparties en boucles).
        if (cur === v) break;
        const bits = out[cur];
        if (!bits) break;
        // Préférence : droite, tout droit, gauche.
        const right = (dir + 1) & 3,
          left = (dir + 3) & 3;
        const next = bits & (1 << right) ? right : bits & (1 << dir) ? dir : bits & (1 << left) ? left : -1;
        if (next < 0) break;
        if (next !== dir) loop.push({ x, y });
        dir = next;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** Points denses le long d'une boucle de coins : le milieu de chaque arête d'un pixel. */
function midpoints(loop: Vec[]): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const sx = Math.sign(b.x - a.x),
      sy = Math.sign(b.y - a.y);
    for (let s = 0; s < len; s++) pts.push({ x: a.x + sx * (s + 0.5), y: a.y + sy * (s + 0.5) });
  }
  return pts;
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const len = (a: Vec) => Math.hypot(a.x, a.y);
const unit = (a: Vec): Vec => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** Simplification de Douglas-Peucker d'une suite ouverte : indices des points gardés. */
function dpIndices(pts: Vec[], from: number, to: number, tol: number, keep: Set<number>): void {
  const a = pts[from],
    b = pts[to];
  const ab = sub(b, a);
  const l = len(ab);
  let worst = -1,
    worstD = tol;
  for (let i = from + 1; i < to; i++) {
    const ap = sub(pts[i], a);
    const d = l < 1e-9 ? len(ap) : Math.abs(ab.x * ap.y - ab.y * ap.x) / l;
    if (d > worstD) {
      worstD = d;
      worst = i;
    }
  }
  if (worst < 0) return;
  keep.add(worst);
  dpIndices(pts, from, worst, tol, keep);
  dpIndices(pts, worst, to, tol, keep);
}

/** Indices des coins d'une boucle de points denses. */
function findCorners(pts: Vec[], cornerAngle: number): number[] {
  const n = pts.length;
  // On part du point le plus éloigné du premier, pour couper la boucle en deux suites ouvertes.
  let far = 0,
    farD = -1;
  for (let i = 0; i < n; i++) {
    const d = len(sub(pts[i], pts[0]));
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const keep = new Set<number>([0, far]);
  const ring = [...pts, pts[0]];
  dpIndices(ring, 0, far, 0.9, keep);
  dpIndices(ring, far, n, 0.9, keep);
  keep.delete(n);
  const idx = [...keep].sort((a, b) => a - b);
  if (idx.length < 3) return [];
  const limit = Math.cos((cornerAngle * Math.PI) / 180);
  const corners: number[] = [];
  for (let k = 0; k < idx.length; k++) {
    const p = pts[idx[k]];
    const prev = pts[idx[(k - 1 + idx.length) % idx.length]];
    const next = pts[idx[(k + 1) % idx.length]];
    const u = unit(sub(p, prev)),
      w = unit(sub(next, p));
    // Angle de virage entre les deux segments ; les segments très courts comptent peu.
    if (dot(u, w) < limit && len(sub(p, prev)) > 1.2 && len(sub(next, p)) > 1.2) corners.push(idx[k]);
  }
  return corners;
}

type Bez = [Vec, Vec, Vec, Vec];

function bezierAt(b: Bez, t: number): Vec {
  const mt = 1 - t;
  const a = mt * mt * mt,
    c = 3 * mt * mt * t,
    d = 3 * mt * t * t,
    e = t * t * t;
  return {
    x: a * b[0].x + c * b[1].x + d * b[2].x + e * b[3].x,
    y: a * b[0].y + c * b[1].y + d * b[2].y + e * b[3].y,
  };
}

function chordParams(pts: Vec[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generateBezier(pts: Vec[], u: number[], t1: Vec, t2: Vec): Bez {
  const first = pts[0],
    last = pts[pts.length - 1];
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i],
      mt = 1 - t;
    const b0 = mt * mt * mt,
      b1 = 3 * mt * mt * t,
      b2 = 3 * mt * t * t,
      b3 = t * t * t;
    const a1 = mul(t1, b1),
      a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1 = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : 0;
  let alpha2 = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0;
  const segLen = len(sub(last, first));
  const eps = 1e-6 * segLen;
  if (alpha1 < eps || alpha2 < eps) alpha1 = alpha2 = segLen / 3;
  return [first, add(first, mul(t1, alpha1)), add(last, mul(t2, alpha2)), last];
}

/** Un pas de Newton-Raphson pour rapprocher le paramètre t du point le plus proche. */
function newton(b: Bez, p: Vec, t: number): number {
  const d = sub(bezierAt(b, t), p);
  const mt = 1 - t;
  const q1 = add(
    add(mul(sub(b[1], b[0]), 3 * mt * mt), mul(sub(b[2], b[1]), 6 * mt * t)),
    mul(sub(b[3], b[2]), 3 * t * t),
  );
  const q2 = add(
    mul(add(sub(b[2], mul(b[1], 2)), b[0]), 6 * mt),
    mul(add(sub(b[3], mul(b[2], 2)), b[1]), 6 * t),
  );
  const den = dot(q1, q1) + dot(d, q2);
  if (Math.abs(den) < 1e-12) return t;
  return Math.max(0, Math.min(1, t - dot(d, q1) / den));
}

function maxError(pts: Vec[], b: Bez, u: number[]): { err: number; at: number } {
  let err = 0,
    at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len(sub(bezierAt(b, u[i]), pts[i]));
    if (d > err) {
      err = d;
      at = i;
    }
  }
  return { err, at };
}

/** Plus grand écart des points à la corde qui joint le premier au dernier. */
function chordDistance(pts: Vec[]): number {
  const a = pts[0],
    ab = sub(pts[pts.length - 1], a);
  const l = len(ab);
  let worst = 0;
  for (const p of pts) {
    const ap = sub(p, a);
    worst = Math.max(worst, l < 1e-9 ? len(ap) : Math.abs(ab.x * ap.y - ab.y * ap.x) / l);
  }
  return worst;
}

/** Ajuste des courbes de Bézier sur une suite de points (Schneider, « Graphics Gems », 1990). */
function fitCubic(pts: Vec[], t1: Vec, t2: Vec, tol: number, out: Bez[], depth = 0): void {
  if (pts.length === 2 || chordDistance(pts) < Math.min(0.35, tol)) {
    // Points alignés : un segment droit (poignées sur la corde, écrit « L »).
    const a = pts[0],
      b = pts[pts.length - 1];
    out.push([a, add(a, mul(sub(b, a), 1 / 3)), add(a, mul(sub(b, a), 2 / 3)), b]);
    return;
  }
  if (pts.length === 2) {
    const d = len(sub(pts[1], pts[0])) / 3;
    out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]);
    return;
  }
  let u = chordParams(pts);
  let b = generateBezier(pts, u, t1, t2);
  let { err, at } = maxError(pts, b, u);
  if (err <= tol) {
    out.push(b);
    return;
  }
  if (err < tol * 4) {
    for (let it = 0; it < 6; it++) {
      u = u.map((t, i) => newton(b, pts[i], t));
      b = generateBezier(pts, u, t1, t2);
      ({ err, at } = maxError(pts, b, u));
      if (err <= tol) {
        out.push(b);
        return;
      }
    }
  }
  if (depth > 24 || pts.length < 4) {
    out.push(b);
    return;
  }
  at = Math.max(1, Math.min(pts.length - 2, at));
  const center = unit(sub(pts[at - 1], pts[at + 1]));
  fitCubic(pts.slice(0, at + 1), t1, center, tol, out, depth + 1);
  fitCubic(pts.slice(at), mul(center, -1), t2, tol, out, depth + 1);
}

/** Tangente à l'extrémité d'une suite de points : vers l'intérieur, sur quelques points. */
function endTangent(pts: Vec[], fromStart: boolean): Vec {
  const k = Math.min(3, pts.length - 1);
  return fromStart ? unit(sub(pts[k], pts[0])) : unit(sub(pts[pts.length - 1 - k], pts[pts.length - 1]));
}

/**
 * Le milieu des arêtes coupe les angles d'un demi-pixel : le coin est replacé à la rencontre des
 * deux côtés qui y arrivent, pour des angles nets.
 */
function snapCorner(pts: Vec[], c: number): void {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n];
  const a1 = at(c - 4),
    a2 = at(c - 1),
    b1 = at(c + 1),
    b2 = at(c + 4);
  const d1 = sub(a2, a1),
    d2 = sub(b2, b1);
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return;
  const k = ((b1.x - a1.x) * d2.y - (b1.y - a1.y) * d2.x) / den;
  const q = add(a1, mul(d1, k));
  if (len(sub(q, pts[c])) < 1.5) pts[c] = q;
}

/** Courbes d'une boucle de pixels (fermée), en commandes M, C, Z. */
export function fitLoop(loop: Vec[], tolerance: number, cornerAngle: number): PathCommand[] {
  const pts = midpoints(loop);
  const n = pts.length;
  if (n < 3) return [];
  if (n <= 6) {
    // Très petite boucle : un polygone suffit.
    const cmds: PathCommand[] = pts.map((p, i) => ({ op: i ? 'L' : 'M', x: p.x, y: p.y }) as PathCommand);
    cmds.push({ op: 'Z' });
    return cmds;
  }
  const corners = findCorners(pts, cornerAngle);
  for (const c of corners) snapCorner(pts, c);
  const curves: Bez[] = [];
  if (!corners.length) {
    // Boucle sans coin : une suite fermée lisse, tangente commune au point de départ.
    const ring = [...pts, pts[0]];
    const tan = unit(sub(pts[1], pts[n - 1]));
    fitCubic(ring, tan, mul(tan, -1), tolerance, curves);
  } else {
    for (let c = 0; c < corners.length; c++) {
      const a = corners[c],
        b = corners[(c + 1) % corners.length];
      const run: Vec[] = [];
      for (let i = a; ; i = (i + 1) % n) {
        run.push(pts[i]);
        if (i === b && run.length > 1) break;
        if (run.length > n + 1) break;
      }
      if (run.length < 2) continue;
      fitCubic(run, endTangent(run, true), endTangent(run, false), tolerance, curves);
    }
  }
  if (!curves.length) return [];
  const cmds: PathCommand[] = [{ op: 'M', x: curves[0][0].x, y: curves[0][0].y }];
  for (const [, c1, c2, p] of curves) {
    const straight = isStraight(cmds, c1, c2, p);
    if (straight) cmds.push({ op: 'L', x: p.x, y: p.y });
    else cmds.push({ op: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y });
  }
  cmds.push({ op: 'Z' });
  return cmds;
}

/** Une courbe dont les poignées sont sur la corde devient un segment droit (fichier plus léger). */
function isStraight(cmds: PathCommand[], c1: Vec, c2: Vec, p: Vec): boolean {
  const last = cmds[cmds.length - 1] as { x: number; y: number };
  const a = { x: last.x, y: last.y };
  const ab = sub(p, a);
  const l = len(ab);
  if (l < 1e-6) return true;
  const off = (q: Vec) => Math.abs(ab.x * (q.y - a.y) - ab.y * (q.x - a.x)) / l;
  return off(c1) < 0.05 && off(c2) < 0.05;
}

function commandsBox(cmds: PathCommand[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const c of cmds) {
    if (c.op === 'Z') continue;
    const xs = c.op === 'C' ? [c.x1, c.x2, c.x] : [c.x];
    const ys = c.op === 'C' ? [c.y1, c.y2, c.y] : [c.y];
    for (const x of xs) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
    for (const y of ys) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Vectorise une image : un calque de tracés par couleur, du dessous vers le dessus. */
export function traceImage(
  img: Pixels,
  options: Partial<TraceOptions> = {},
  onProgress?: (f: number) => void,
): TraceResult {
  const opts = { ...DEFAULT_TRACE, ...options };
  const { width, height } = img;
  const { labels, palette } = quantize(img, opts);
  onProgress?.(0.15);
  despeckle(labels, width, height, Math.max(1, Math.round(opts.noise)));
  onProgress?.(0.3);
  const k = palette.length / 3;
  const counts = new Float64Array(k);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) counts[labels[i]]++;
  // Ordre d'empilement : la couleur la plus étendue en dessous.
  let order = [...Array(k).keys()].filter((j) => counts[j] > 0).sort((a, b) => counts[b] - counts[a]);
  if (opts.mode === 'bw') order = order.filter((j) => j === 0 || !opts.ignoreWhite);
  const rank = new Int32Array(k).fill(-1);
  order.forEach((j, r) => (rank[j] = r));
  const layers: TraceLayer[] = [];
  const inside = new Uint8Array(width * height);
  for (let r = 0; r < order.length; r++) {
    const j = order[r];
    for (let i = 0; i < labels.length; i++) inside[i] = labels[i] >= 0 && rank[labels[i]] >= r ? 1 : 0;
    const commands: PathCommand[] = [];
    for (const loop of traceContours(inside, width, height))
      commands.push(...fitLoop(loop, opts.tolerance, opts.cornerAngle));
    if (commands.length)
      layers.push({
        color: toHex(palette[j * 3], palette[j * 3 + 1], palette[j * 3 + 2]),
        commands,
        bounds: commandsBox(commands),
      });
    onProgress?.(0.3 + (0.7 * (r + 1)) / order.length);
  }
  return { width, height, layers };
}
