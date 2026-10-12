import { gaussianBlurred, luma, type Pixels } from './adjust';
import type { Vec } from './geometry';
import type { PoulpeDocument, SceneNode } from './types';

/*
 * Outils de pinceau et de sélection de la Persona Photo (version 1.2, comme Affinity Photo) :
 * plage de tons d'Éclaircir et Assombrir, stabilisateur du tracé, lasso magnétique (chemin qui
 * suit les bords), calques du dessous pour le tampon et le correcteur, affinage d'une sélection.
 * Sans dépendance au navigateur.
 */

// ————— Éclaircir et Assombrir —————

/** Plage de tons d'Éclaircir et Assombrir. */
export type ToneRange = 'shadows' | 'midtones' | 'highlights';

/**
 * Courbe d'Éclaircir (`amount` > 0) ou d'Assombrir (`amount` < 0) sur une valeur 0..1, à pleine
 * force (`amount` = ±1). Les ombres bougent surtout dans le noir, les tons moyens au milieu (les
 * extrémités restent en place), les hautes lumières surtout dans le clair.
 */
export function dodgeBurnCurve(v: number, amount: number, range: ToneRange): number {
  const a = Math.max(-1, Math.min(1, amount)) / 3;
  let out: number;
  if (range === 'highlights') out = v * (1 + a);
  else if (range === 'midtones') out = a >= 0 ? v ** (1 / (1 + a)) : v ** (1 - a);
  else out = a >= 0 ? v + a * (1 - v) : (v + a) / (1 + a);
  return Math.max(0, Math.min(1, out));
}

/**
 * Éclaircit ou assombrit des pixels sur place. « Protéger la teinte » change la luminosité sans
 * toucher à la teinte ni à la saturation (les trois canaux suivent le plus clair d'entre eux) ;
 * sinon chaque canal suit la courbe, ce qui ravive ou ternit un peu les couleurs.
 */
export function dodgeBurnPixels(px: Pixels, amount: number, range: ToneRange, protectHue = false): void {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = dodgeBurnCurve(i / 255, amount, range) * 255;
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!protectHue) {
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
      continue;
    }
    const m = Math.max(d[i], d[i + 1], d[i + 2]);
    if (m === 0) {
      d[i] = d[i + 1] = d[i + 2] = lut[0];
      continue;
    }
    const k = lut[m] / m;
    d[i] = d[i] * k;
    d[i + 1] = d[i + 1] * k;
    d[i + 2] = d[i + 2] * k;
  }
}

// ————— Stabilisateur —————

/** Point d'un coup de pinceau, avec la pression du stylet (1 à la souris). */
export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

/**
 * Stabilisateur du tracé, comme dans Affinity Photo. Mode « corde » : le pinceau est tiré par une
 * corde de longueur `amount` et ne bouge que quand elle est tendue (les tremblements plus courts
 * que la corde disparaissent). Mode « fenêtre » : le pinceau suit la moyenne des `amount`
 * dernières positions du pointeur.
 */
export class Stabilizer {
  private brush: StrokePoint | null = null;
  private window: StrokePoint[] = [];

  constructor(
    readonly mode: 'rope' | 'window',
    readonly amount: number,
  ) {}

  /** Début du geste : le pinceau part de là. */
  start(p: StrokePoint): void {
    this.brush = { ...p };
    this.window = [{ ...p }];
  }

  /** Nouvelle position du pointeur : positions du pinceau à peindre (parfois aucune). */
  push(p: StrokePoint): StrokePoint[] {
    if (!this.brush) {
      this.start(p);
      return [{ ...p }];
    }
    if (this.mode === 'rope') {
      const b = this.brush;
      const dx = p.x - b.x,
        dy = p.y - b.y;
      const d = Math.hypot(dx, dy);
      const len = Math.max(0, this.amount);
      if (d <= len) return [];
      const k = (d - len) / d;
      this.brush = { x: b.x + dx * k, y: b.y + dy * k, pressure: p.pressure };
      return [{ ...this.brush }];
    }
    const n = Math.max(1, Math.round(this.amount));
    this.window.push({ ...p });
    while (this.window.length > n) this.window.shift();
    this.brush = average(this.window);
    return [{ ...this.brush }];
  }

  /** Fin du geste : la fenêtre rattrape le pointeur ; la corde reste où elle est. */
  finish(): StrokePoint[] {
    if (this.mode === 'rope' || this.window.length < 2) return [];
    const out: StrokePoint[] = [];
    while (this.window.length > 1) {
      this.window.shift();
      out.push(average(this.window));
    }
    return out;
  }
}

function average(list: StrokePoint[]): StrokePoint {
  let x = 0,
    y = 0,
    p = 0;
  for (const q of list) {
    x += q.x;
    y += q.y;
    p += q.pressure;
  }
  return { x: x / list.length, y: y / list.length, pressure: p / list.length };
}

// ————— Lasso magnétique —————

/**
 * Coût de passage par chaque pixel pour le lasso magnétique : faible sur un bord marqué (fort
 * écart de luminosité entre voisins, filtre de Sobel), proche de 1 dans les zones unies.
 */
export function edgeCosts(px: Pixels): Float32Array {
  const { data, width: w, height: h } = px;
  const l = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    // Le transparent compte comme du blanc : le bord d'un calque détouré est un bord.
    l[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) * a + 255 * (1 - a);
  }
  const cost = new Float32Array(w * h);
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x - 1, y) -
        at(x - 1, y + 1);
      const gy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1);
      cost[y * w + x] = 1 / (1 + Math.hypot(gx, gy) / 8);
    }
  return cost;
}

/**
 * Chemin le moins coûteux de `from` à `to` (pixels entiers) sur la carte de coûts, en restant dans
 * leur boîte élargie de `margin` : il colle aux bords voisins (algorithme de Dijkstra, 8 voisins).
 * Au-delà de `maxArea` pixels à explorer, on renvoie le segment droit.
 */
export function liveWire(
  cost: Float32Array,
  w: number,
  h: number,
  from: Vec,
  to: Vec,
  margin = 12,
  maxArea = 512 * 512,
): Vec[] {
  const fx = clampInt(from.x, w),
    fy = clampInt(from.y, h);
  const tx = clampInt(to.x, w),
    ty = clampInt(to.y, h);
  if (fx === tx && fy === ty) return [{ x: fx, y: fy }];
  const x0 = Math.max(0, Math.min(fx, tx) - margin),
    y0 = Math.max(0, Math.min(fy, ty) - margin);
  const x1 = Math.min(w - 1, Math.max(fx, tx) + margin),
    y1 = Math.min(h - 1, Math.max(fy, ty) + margin);
  const bw = x1 - x0 + 1,
    bh = y1 - y0 + 1;
  if (bw * bh > maxArea)
    return [
      { x: fx, y: fy },
      { x: tx, y: ty },
    ];
  const n = bw * bh;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  const start = (fy - y0) * bw + (fx - x0);
  const goal = (ty - y0) * bw + (tx - x0);
  dist[start] = 0;
  heap.push(start, 0);
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const cx = i % bw,
      cy = (i / bw) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx,
          ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const j = ny * bw + nx;
        if (done[j]) continue;
        // Une petite part fixe évite les détours dans les zones sans bord.
        const step = (cost[(y0 + ny) * w + x0 + nx] + 0.02) * (dx && dy ? Math.SQRT2 : 1);
        const nd = dist[i] + step;
        if (nd < dist[j]) {
          dist[j] = nd;
          prev[j] = i;
          heap.push(j, nd);
        }
      }
  }
  const path: Vec[] = [];
  for (let i = goal; i >= 0; i = prev[i]) {
    path.push({ x: x0 + (i % bw), y: y0 + ((i / bw) | 0) });
    if (i === start) break;
  }
  return path.reverse();
}

function clampInt(v: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.round(v)));
}

/** Tas binaire minimal (indices et priorités). */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const ids = this.ids,
      keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids,
      keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!,
      lastKey = keys.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

/** Simplifie une ligne brisée (Douglas-Peucker), à `tolerance` près. */
export function simplifyPolyline(points: Vec[], tolerance: number): Vec[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a],
      pb = points[b];
    const dx = pb.x - pa.x,
      dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    let worst = -1,
      far = 0;
    for (let i = a + 1; i < b; i++) {
      // Contour fermé (extrémités confondues) : distance au point de départ.
      const d =
        len < 1e-9
          ? Math.hypot(points[i].x - pa.x, points[i].y - pa.y)
          : Math.abs((points[i].x - pa.x) * dy - (points[i].y - pa.y) * dx) / len;
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst > 0 && far > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// ————— Calques du dessous —————

/**
 * Objets à cacher pour ne voir que ce qui est sous le calque `id` (lui compris si `includeSelf`) :
 * tout ce qui est peint après lui sur son plan de travail. Sert au tampon et au correcteur quand
 * leur source est « le calque et ceux du dessous » ou « les calques du dessous ».
 */
export function nodesAbove(doc: PoulpeDocument, id: string, includeSelf: boolean): Set<string> {
  const out = new Set<string>();
  const visit = (nodes: SceneNode[]): boolean => {
    let found = false;
    for (const n of nodes) {
      if (found) {
        out.add(n.id);
        continue;
      }
      if (n.id === id) {
        found = true;
        if (!includeSelf) out.add(n.id);
        continue;
      }
      if (n.type === 'group' && visit(n.children)) found = true;
    }
    return found;
  };
  for (const ab of doc.artboards) if (visit(ab.children)) break;
  return out;
}

// ————— Affiner la sélection —————

export interface RefineOptions {
  /** Agrandir (> 0) ou réduire (< 0) la sélection, en pixels du masque. */
  adjust: number;
  /** Lissage du bord (arrondit les angles, efface les petits îlots), en pixels du masque. */
  smooth: number;
  /** Adoucissement du bord, en pixels du masque. */
  feather: number;
}

/**
 * Affine un masque de sélection (opacité de pixels RGBA) sur place : lissage, puis agrandir ou
 * réduire, puis adoucir.
 */
export function refineMask(px: Pixels, o: RefineOptions): void {
  const d = px.data;
  const blurAlpha = (sigma: number) => {
    if (sigma < 0.3) return;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255;
    d.set(gaussianBlurred(px, sigma));
  };
  const threshold = (lo: number, hi: number) => {
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i];
      d[i] = a <= lo ? 0 : a >= hi ? 255 : Math.round(((a - lo) / (hi - lo)) * 255);
    }
  };
  if (o.smooth > 0) {
    blurAlpha(o.smooth / 2);
    threshold(118, 138);
  }
  if (o.adjust) {
    // Un bord droit flouté vaut ~2 % de l'opacité à deux écarts-types : le seuil y place le bord.
    blurAlpha(Math.abs(o.adjust) / 2);
    if (o.adjust > 0) threshold(1, 8);
    else threshold(247, 254);
  }
  if (o.feather > 0) blurAlpha(o.feather / 2);
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255;
}
