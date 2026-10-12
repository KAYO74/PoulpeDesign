import { cubicDerivative, cubicPoint, splitCubic, type Cubic } from './bezier';
import type { Vec } from './geometry';
import { segmentCount, segmentCubic, type Anchor, type SubPath } from './pathEdit';
import type { WidthProfile } from './types';

/*
 * Dessin à main levée (crayon, pinceau vectoriel) : largeur d'après la pression du stylet ou
 * effilée aux bouts, stabilisateur « corde », et mode Sculpter du crayon d'Affinity (un trait
 * qui part d'une courbe sélectionnée la prolonge ou en remplace un morceau).
 */

const MIN_WIDTH = 0.05;

function lengths(points: Vec[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++)
    out.push(out[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return out;
}

/**
 * Profil de largeur d'après la pression relevée en chaque point (0 à 1), réparti selon la distance
 * parcourue et adouci. Renvoie null si la pression reste au maximum (épaisseur constante).
 */
export function pressureProfile(points: Vec[], pressures: number[], samples = 24): WidthProfile | null {
  const n = Math.min(points.length, pressures.length);
  if (n < 2) return null;
  const lens = lengths(points.slice(0, n));
  const total = lens[n - 1];
  if (total <= 0) return null;
  const raw: number[] = [];
  let j = 0;
  for (let k = 0; k < samples; k++) {
    const d = (total * k) / (samples - 1);
    while (j < n - 2 && lens[j + 1] < d) j++;
    const span = lens[j + 1] - lens[j] || 1;
    const f = Math.min(1, Math.max(0, (d - lens[j]) / span));
    raw.push(pressures[j] + (pressures[j + 1] - pressures[j]) * f);
  }
  // Moyenne glissante : le stylet tremble un peu.
  const out = raw.map((_, k) => {
    const win = raw.slice(Math.max(0, k - 1), k + 2);
    const v = win.reduce((a, b) => a + b, 0) / win.length;
    return Math.round(Math.min(1, Math.max(MIN_WIDTH, v)) * 1000) / 1000;
  });
  return out.every((v) => v > 0.995) ? null : out;
}

/**
 * Profil effilé : la largeur monte sur la première fraction `start` du tracé et descend sur la
 * dernière fraction `end`. Renvoie null sans effilement.
 */
export function taperProfile(start: number, end: number, samples = 21): WidthProfile | null {
  if (start <= 0 && end <= 0) return null;
  const out: number[] = [];
  for (let k = 0; k < samples; k++) {
    const x = k / (samples - 1);
    let w = 1;
    if (start > 0) w = Math.min(w, x / start);
    if (end > 0) w = Math.min(w, (1 - x) / end);
    out.push(Math.round(Math.max(MIN_WIDTH, w) * 1000) / 1000);
  }
  return out;
}

/** Stabilisateur « corde » : le point tracé ne suit le pointeur qu'au bout d'une corde de longueur `rope`. */
export function ropeFollow(drawn: Vec, pointer: Vec, rope: number): Vec | null {
  const d = Math.hypot(pointer.x - drawn.x, pointer.y - drawn.y);
  if (d <= rope) return null;
  const k = (d - rope) / d;
  return { x: drawn.x + (pointer.x - drawn.x) * k, y: drawn.y + (pointer.y - drawn.y) * k };
}

// ————— Morceaux de courbe —————

/** Morceau d'une courbe cubique entre les paramètres t0 et t1. */
function subCubic(c: Cubic, t0: number, t1: number): Cubic {
  const right = t0 > 0 ? splitCubic(c, t0)[1] : c;
  if (t1 >= 1) return right;
  return splitCubic(right, (t1 - t0) / (1 - t0))[0];
}

/** Segment et paramètre d'une position `u` (n° de segment + t) sur un sous-tracé. */
function locate(sp: SubPath, u: number): { seg: number; t: number } {
  const n = segmentCount(sp);
  const seg = Math.min(n - 1, Math.max(0, Math.floor(u)));
  return { seg, t: Math.min(1, Math.max(0, u - seg)) };
}

/** Point du sous-tracé à la position `u`. */
export function pointOnSubpath(sp: SubPath, u: number): Vec {
  const { seg, t } = locate(sp, u);
  return cubicPoint(segmentCubic(sp, seg), t);
}

/**
 * Morceau d'un sous-tracé de la position `u0` à `u1` (u0 < u1), en nœuds avec leurs poignées.
 * Sur un tracé fermé, `u1` peut dépasser la fin : on refait le tour.
 */
export function curvePart(sp: SubPath, u0: number, u1: number): Anchor[] {
  const n = segmentCount(sp);
  const out: Anchor[] = [];
  let u = u0;
  while (n && u1 - u > 1e-9) {
    const seg = Math.floor(u + 1e-9);
    const end = Math.min(seg + 1, u1);
    const k = ((seg % n) + n) % n;
    const a = sp.anchors[k],
      b = sp.anchors[(k + 1) % sp.anchors.length];
    const straight = !a.out && !b.in;
    const c = subCubic(segmentCubic(sp, k), Math.max(0, u - seg), Math.min(1, end - seg));
    if (!out.length) out.push({ x: c[0].x, y: c[0].y, in: null, out: null });
    out[out.length - 1].out = straight ? null : { x: c[1].x, y: c[1].y };
    out.push({ x: c[3].x, y: c[3].y, in: straight ? null : { x: c[2].x, y: c[2].y }, out: null });
    u = end;
  }
  if (!out.length) {
    const p = pointOnSubpath(sp, u0);
    out.push({ x: p.x, y: p.y, in: null, out: null });
  }
  return out;
}

function cloneAnchor(a: Anchor): Anchor {
  return { x: a.x, y: a.y, in: a.in && { ...a.in }, out: a.out && { ...a.out } };
}

/** Nœuds dans l'autre sens (les poignées s'échangent). */
function reversed(list: Anchor[]): Anchor[] {
  return list
    .slice()
    .reverse()
    .map((a) => ({ x: a.x, y: a.y, in: a.out && { ...a.out }, out: a.in && { ...a.in } }));
}

/** Met bout à bout deux suites de nœuds : la fin de la première et le début de la seconde fusionnent. */
function chain(a: Anchor[], b: Anchor[]): Anchor[] {
  if (!a.length) return b;
  if (!b.length) return a;
  const last = a[a.length - 1],
    first = b[0];
  return [...a.slice(0, -1), { x: last.x, y: last.y, in: last.in, out: first.out }, ...b.slice(1)];
}

/** Déplace un nœud (avec ses poignées) en `p`. */
function moveTo(a: Anchor, p: Vec): Anchor {
  const dx = p.x - a.x,
    dy = p.y - a.y;
  return {
    x: p.x,
    y: p.y,
    in: a.in && { x: a.in.x + dx, y: a.in.y + dy },
    out: a.out && { x: a.out.x + dx, y: a.out.y + dy },
  };
}

/** Ferme une suite de nœuds dont le dernier rejoint le premier. */
function closeLoop(list: Anchor[]): SubPath {
  const anchors = list.slice();
  if (anchors.length > 2) {
    const last = anchors.pop()!;
    anchors[0] = { ...anchors[0], in: last.in };
  }
  return { anchors, closed: true };
}

function arcLength(sp: SubPath, u0: number, u1: number): number {
  let len = 0;
  const part = curvePart(sp, u0, u1);
  for (let i = 1; i < part.length; i++) {
    const a = part[i - 1],
      b = part[i];
    const c: Cubic = [a, a.out ?? a, b.in ?? b, b];
    let prev = cubicPoint(c, 0);
    for (let k = 1; k <= 12; k++) {
      const q = cubicPoint(c, k / 12);
      len += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
  }
  return len;
}

/**
 * Crayon en mode Sculpter : `drawn` (nœuds du trait, ouvert) part du sous-tracé `sp` à la position
 * `u0` et finit à la position `u1` (ou en dehors de la courbe : null). Comme dans Affinity :
 * - parti d'une extrémité d'un tracé ouvert, le trait le prolonge (et le ferme s'il finit sur
 *   l'autre extrémité) ;
 * - parti de la courbe et revenu dessus, il remplace le morceau entre les deux (sur un tracé
 *   fermé, le plus court des deux arcs) ;
 * - parti de la courbe d'un tracé ouvert sans y revenir, il remplace la fin vers laquelle il part.
 * Renvoie null si le trait ne sculpte pas la courbe (tracé fermé quitté sans y revenir).
 */
export function sculptSubpath(sp: SubPath, u0: number, u1: number | null, drawn: Anchor[]): SubPath | null {
  const n = segmentCount(sp);
  if (!n || drawn.length < 2) return null;
  const d = drawn.map(cloneAnchor);
  d[0] = moveTo(d[0], pointOnSubpath(sp, u0));
  if (u1 !== null) d[d.length - 1] = moveTo(d[d.length - 1], pointOnSubpath(sp, u1));
  const E = 1e-3;
  if (!sp.closed) {
    const atStart = u0 <= E,
      atEnd = u0 >= n - E;
    if (atStart || atEnd) {
      const base = atEnd ? sp.anchors.map(cloneAnchor) : reversed(sp.anchors);
      const joined = chain(base, d);
      const other = atEnd ? u1 !== null && u1 <= E : u1 !== null && u1 >= n - E;
      return other ? closeLoop(joined) : { anchors: joined, closed: false };
    }
    if (u1 !== null) {
      const anchors =
        u1 >= u0
          ? chain(chain(curvePart(sp, 0, u0), d), curvePart(sp, u1, n))
          : chain(chain(curvePart(sp, 0, u1), reversed(d)), curvePart(sp, u0, n));
      return { anchors, closed: false };
    }
    // Le trait quitte la courbe : il remplace la fin vers laquelle il part.
    const { seg, t } = locate(sp, u0);
    const tan = cubicDerivative(segmentCubic(sp, seg), t);
    const dir = { x: d[d.length - 1].x - d[0].x, y: d[d.length - 1].y - d[0].y };
    const forward = tan.x * dir.x + tan.y * dir.y >= 0;
    const anchors = forward ? chain(curvePart(sp, 0, u0), d) : chain(reversed(d), curvePart(sp, u0, n));
    return { anchors, closed: false };
  }
  if (u1 === null) return null;
  const U1 = u1 >= u0 ? u1 : u1 + n;
  const ahead = arcLength(sp, u0, U1);
  const behind = arcLength(sp, U1, u0 + n);
  // On garde le plus long des deux arcs, et le trait referme la boucle.
  const loop =
    ahead <= behind ? chain(curvePart(sp, U1, u0 + n), d) : chain(curvePart(sp, u0, U1), reversed(d));
  return closeLoop(loop);
}
