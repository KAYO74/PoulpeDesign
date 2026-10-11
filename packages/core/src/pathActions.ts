import { cubicDerivative, cubicPoint, flattenCommands } from './bezier';
import { simplifyPoints } from './boolean';
import type { Vec } from './geometry';
import {
  anchorKey,
  fromSubpaths,
  parseAnchorKey,
  segmentCount,
  segmentCubic,
  toSubpaths,
  type Anchor,
  type SubPath,
} from './pathEdit';

/*
 * Actions de l'outil Nœud, comme dans Affinity : scinder, casser, joindre, inverser, lisser une
 * courbe, redresser ou supprimer un segment, supprimer des nœuds en gardant la forme.
 * Les nœuds gardés restent les mêmes objets : on retrouve leur clé avec `keysOf`.
 */

const pt = (x: number, y: number): Vec => ({ x, y });
const near = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;

/** Copie d'un nœud (pour couper un tracé en deux à cet endroit). */
function copyAnchor(a: Anchor): Anchor {
  return { x: a.x, y: a.y, in: a.in && { ...a.in }, out: a.out && { ...a.out } };
}

/** Clés actuelles des nœuds donnés (après une action qui a déplacé les nœuds dans les tableaux). */
export function keysOf(sps: SubPath[], anchors: Set<Anchor>): string[] {
  const out: string[] = [];
  sps.forEach((sp, si) => sp.anchors.forEach((a, ai) => anchors.has(a) && out.push(anchorKey(si, ai))));
  return out;
}

/** Nœuds désignés par leurs clés. */
export function anchorsOf(sps: SubPath[], keys: string[]): Set<Anchor> {
  const out = new Set<Anchor>();
  for (const k of keys) {
    const [si, ai] = parseAnchorKey(k);
    const a = sps[si]?.anchors[ai];
    if (a) out.add(a);
  }
  return out;
}

/** Sous-tracés concernés par une sélection de nœuds (tous si aucun nœud n'est sélectionné). */
export function subpathsOfKeys(sps: SubPath[], keys: string[]): number[] {
  const set = new Set(keys.map((k) => parseAnchorKey(k)[0]).filter((si) => sps[si]));
  return set.size ? [...set].sort((a, b) => a - b) : sps.map((_, i) => i);
}

/** Redresse un segment : ses deux poignées disparaissent. */
export function straightenSegment(sps: SubPath[], si: number, seg: number): void {
  const sp = sps[si];
  const a = sp.anchors[seg],
    b = sp.anchors[(seg + 1) % sp.anchors.length];
  a.out = null;
  b.in = null;
  delete a.smart;
  delete b.smart;
}

/** Supprime un segment : un tracé fermé s'ouvre, un tracé ouvert se coupe en deux. */
export function deleteSegment(sps: SubPath[], si: number, seg: number): SubPath[] {
  const sp = sps[si];
  const a = sp.anchors;
  let parts: Anchor[][];
  if (sp.closed) parts = [[...a.slice(seg + 1), ...a.slice(0, seg + 1)]];
  else parts = [a.slice(0, seg + 1), a.slice(seg + 1)];
  const out = parts
    .filter((p) => p.length > 1)
    .map((p) => {
      p[0].in = null;
      p[p.length - 1].out = null;
      return { anchors: p, closed: false };
    });
  return [...sps.slice(0, si), ...out, ...sps.slice(si + 1)];
}

/**
 * Casse la courbe aux nœuds donnés : un tracé fermé s'ouvre à ce nœud, un tracé ouvert se coupe en
 * deux (le nœud est dédoublé). Les extrémités d'un tracé ouvert ne changent pas.
 */
export function breakAtAnchors(sps: SubPath[], keys: string[]): SubPath[] {
  const cut = anchorsOf(sps, keys);
  const out: SubPath[] = [];
  for (const sp of sps) {
    let anchors = sp.anchors;
    let closed = sp.closed;
    const first = anchors.findIndex((a) => cut.has(a));
    if (first < 0) {
      out.push(sp);
      continue;
    }
    if (closed) {
      // Le tracé s'ouvre au premier nœud coupé, qui devient son début et sa fin.
      const start = anchors[first];
      const end = copyAnchor(start);
      end.out = null;
      start.in = null;
      delete start.smart;
      anchors = [...anchors.slice(first), ...anchors.slice(0, first), end];
      closed = false;
    }
    let piece: Anchor[] = [];
    anchors.forEach((a, i) => {
      piece.push(a);
      if (i === 0 || i === anchors.length - 1 || !cut.has(a)) return;
      // Nœud intérieur : fin d'un morceau, début (copie) du suivant.
      const next = copyAnchor(a);
      next.in = null;
      a.out = null;
      delete a.smart;
      out.push({ anchors: piece, closed: false });
      piece = [next];
    });
    out.push({ anchors: piece, closed });
  }
  return out.filter((sp) => sp.anchors.length > 1);
}

/** Ajoute un nœud au milieu du segment qui suit chaque nœud donné. Renvoie les nouveaux nœuds. */
export function splitAfterAnchors(sps: SubPath[], keys: string[]): Set<Anchor> {
  const added = new Set<Anchor>();
  const targets = [...anchorsOf(sps, keys)];
  for (const target of targets) {
    sps.forEach((sp) => {
      const ai = sp.anchors.indexOf(target);
      if (ai < 0 || ai >= segmentCount(sp)) return;
      const b = segmentCubic(sp, ai);
      const mid = cubicPoint(b, 0.5);
      const a = sp.anchors[ai],
        next = sp.anchors[(ai + 1) % sp.anchors.length];
      let node: Anchor;
      if (!a.out && !next.in) node = { x: mid.x, y: mid.y, in: null, out: null };
      else {
        // De Casteljau en t = 0,5.
        const m = (p: Vec, q: Vec) => pt((p.x + q.x) / 2, (p.y + q.y) / 2);
        const p01 = m(b[0], b[1]),
          p12 = m(b[1], b[2]),
          p23 = m(b[2], b[3]);
        const p012 = m(p01, p12),
          p123 = m(p12, p23);
        a.out = p01;
        next.in = p23;
        node = { x: mid.x, y: mid.y, in: p012, out: p123 };
      }
      sp.anchors.splice(ai + 1, 0, node);
      added.add(node);
    });
  }
  return added;
}

/** Inverse le sens des sous-tracés donnés (un tracé fermé garde son premier nœud). */
export function reverseSubpaths(sps: SubPath[], indices: number[]): void {
  for (const si of indices) {
    const sp = sps[si];
    if (!sp) continue;
    const a = sp.anchors;
    sp.anchors = sp.closed ? [a[0], ...a.slice(1).reverse()] : [...a].reverse();
    for (const n of sp.anchors) [n.in, n.out] = [n.out, n.in];
  }
}

/** Extrémité d'un sous-tracé ouvert : `start` (premier nœud) ou `end` (dernier). */
function endOf(sps: SubPath[], key: string): { si: number; at: 'start' | 'end' } | null {
  const [si, ai] = parseAnchorKey(key);
  const sp = sps[si];
  if (!sp || sp.closed || sp.anchors.length < 2) return null;
  if (ai === 0) return { si, at: 'start' };
  if (ai === sp.anchors.length - 1) return { si, at: 'end' };
  return null;
}

/**
 * Joint deux extrémités de tracés ouverts. Sur le même sous-tracé, il se ferme ; sinon les deux
 * sous-tracés n'en font plus qu'un. Deux extrémités confondues fusionnent en un seul nœud.
 */
export function joinEnds(sps: SubPath[], keyA: string, keyB: string): SubPath[] | null {
  const ea = endOf(sps, keyA),
    eb = endOf(sps, keyB);
  if (!ea || !eb) return null;
  if (ea.si === eb.si) {
    if (ea.at === eb.at) return null;
    const sp = sps[ea.si];
    const a = sp.anchors;
    if (a.length > 2 && near(a[0], a[a.length - 1])) a[0].in = a.pop()!.in;
    sp.closed = true;
    return sps;
  }
  const A = sps[ea.si],
    B = sps[eb.si];
  // A finit par l'extrémité choisie, B commence par la sienne.
  if (ea.at === 'start') reverseSubpaths(sps, [ea.si]);
  if (eb.at === 'end') reverseSubpaths(sps, [eb.si]);
  const last = A.anchors[A.anchors.length - 1],
    head = B.anchors[0];
  let tail = B.anchors;
  if (near(last, head)) {
    last.out = head.out;
    tail = tail.slice(1);
  }
  const joined: SubPath = { anchors: [...A.anchors, ...tail], closed: false };
  return sps.flatMap((sp, i) => (i === ea.si ? [joined] : i === eb.si ? [] : [sp]));
}

/** Les deux extrémités libres les plus proches, prises sur deux sous-tracés ouverts différents. */
export function nearestEnds(sps: SubPath[]): [string, string] | null {
  const ends: { key: string; si: number; p: Vec }[] = [];
  sps.forEach((sp, si) => {
    if (sp.closed || sp.anchors.length < 2) return;
    const n = sp.anchors.length;
    ends.push({ key: anchorKey(si, 0), si, p: sp.anchors[0] });
    ends.push({ key: anchorKey(si, n - 1), si, p: sp.anchors[n - 1] });
  });
  let best: { pair: [string, string]; d: number } | null = null;
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[i].si === ends[j].si) continue;
      const d = Math.hypot(ends[i].p.x - ends[j].p.x, ends[i].p.y - ends[j].p.y);
      if (!best || d < best.d) best = { pair: [ends[i].key, ends[j].key], d };
    }
  return best?.pair ?? null;
}

function unit(v: Vec): Vec | null {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-9 ? null : pt(v.x / l, v.y / l);
}

/** Direction de départ d'un segment (vers l'intérieur de la courbe). */
function startTangent(b: [Vec, Vec, Vec, Vec]): Vec {
  return (
    unit(cubicDerivative(b, 0)) ??
    unit(pt(b[2].x - b[0].x, b[2].y - b[0].y)) ??
    unit(pt(b[3].x - b[0].x, b[3].y - b[0].y)) ??
    pt(1, 0)
  );
}

/** Direction d'arrivée d'un segment, retournée (de la fin vers l'intérieur de la courbe). */
function endTangent(b: [Vec, Vec, Vec, Vec]): Vec {
  const d = cubicDerivative(b, 1);
  return (
    unit(pt(-d.x, -d.y)) ??
    unit(pt(b[1].x - b[3].x, b[1].y - b[3].y)) ??
    unit(pt(b[0].x - b[3].x, b[0].y - b[3].y)) ??
    pt(-1, 0)
  );
}

/**
 * Une courbe de Bézier entre p0 et p3, de directions de départ et d'arrivée données, au plus près des
 * points relevés (méthode de Schneider, avec paramètres à la longueur de corde).
 */
function fitCubic(points: Vec[], t1: Vec, t2: Vec): [Vec, Vec] {
  const p0 = points[0],
    p3 = points[points.length - 1];
  const lens = [0];
  for (let i = 1; i < points.length; i++)
    lens.push(lens[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = lens[lens.length - 1] || 1;
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  points.forEach((p, i) => {
    const u = lens[i] / total,
      v = 1 - u;
    const b0 = v * v * v,
      b1 = 3 * u * v * v,
      b2 = 3 * u * u * v,
      b3 = u * u * u;
    const a1 = pt(t1.x * b1, t1.y * b1),
      a2 = pt(t2.x * b2, t2.y * b2);
    c00 += a1.x * a1.x + a1.y * a1.y;
    c01 += a1.x * a2.x + a1.y * a2.y;
    c11 += a2.x * a2.x + a2.y * a2.y;
    const tx = p.x - (p0.x * (b0 + b1) + p3.x * (b2 + b3)),
      ty = p.y - (p0.y * (b0 + b1) + p3.y * (b2 + b3));
    x0 += a1.x * tx + a1.y * ty;
    x1 += a2.x * tx + a2.y * ty;
  });
  const det = c00 * c11 - c01 * c01;
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  let l1 = det ? (x0 * c11 - x1 * c01) / det : 0,
    l2 = det ? (c00 * x1 - c01 * x0) / det : 0;
  if (!(l1 > chord * 1e-3) || !(l2 > chord * 1e-3) || !isFinite(l1) || !isFinite(l2)) l1 = l2 = chord / 3;
  return [pt(p0.x + t1.x * l1, p0.y + t1.y * l1), pt(p3.x + t2.x * l2, p3.y + t2.y * l2)];
}

/**
 * Supprime des nœuds en gardant la forme : les nœuds voisins prennent les poignées qui suivent au
 * mieux la courbe d'origine (« Supprimer en gardant une courbe lisse »).
 */
export function fitDeleteAnchors(sps: SubPath[], keys: string[]): SubPath[] {
  const del = anchorsOf(sps, keys);
  const out: SubPath[] = [];
  for (const sp of sps) {
    const n = sp.anchors.length;
    const kept = sp.anchors.map((a) => !del.has(a));
    if (!kept.includes(false)) {
      out.push(sp);
      continue;
    }
    if (kept.filter(Boolean).length < 2) continue;
    // Copie d'origine pour relever la courbe avant de toucher aux poignées.
    const orig = { closed: sp.closed, anchors: sp.anchors.map((a) => copyAnchor(a)) };
    const first = kept.indexOf(true);
    const order = sp.closed ? [...Array(n).keys()].map((i) => (first + i) % n) : [...Array(n).keys()];
    const fits: { from: number; to: number }[] = [];
    let prev = -1,
      prevPos = -1;
    order.forEach((i, pos) => {
      if (!kept[i]) return;
      if (prev >= 0 && pos - prevPos > 1) fits.push({ from: prev, to: i });
      prev = i;
      prevPos = pos;
    });
    // Tracé fermé : les nœuds supprimés après le dernier gardé rejoignent le premier.
    if (sp.closed && prevPos < n - 1) fits.push({ from: prev, to: first });
    for (const { from, to } of fits) {
      const pts: Vec[] = [];
      let t1: Vec | null = null,
        t2: Vec = pt(-1, 0);
      for (let i = from; ; i = (i + 1) % n) {
        const b = segmentCubic(orig, i);
        if (!t1) t1 = startTangent(b);
        for (let k = pts.length ? 1 : 0; k <= 12; k++) pts.push(cubicPoint(b, k / 12));
        if ((i + 1) % n === to) {
          t2 = endTangent(b);
          break;
        }
      }
      const [c1, c2] = fitCubic(pts, t1!, t2);
      const a = sp.anchors[from],
        b = sp.anchors[to];
      a.out = c1;
      b.in = c2;
      delete a.smart;
      delete b.smart;
    }
    const anchors = sp.anchors.filter((_, i) => kept[i]);
    if (!sp.closed) {
      anchors[0].in = null;
      anchors[anchors.length - 1].out = null;
    }
    out.push({ anchors, closed: sp.closed });
  }
  return out;
}

/**
 * Lisse les sous-tracés donnés : ils sont relevés puis redessinés avec moins de nœuds, aux courbes
 * plus douces (« Lisser la courbe »). `tolerance` : écart admis, en unités du tracé.
 */
export function smoothSubpaths(sps: SubPath[], indices: number[], tolerance: number): SubPath[] {
  return sps.map((sp, si) => {
    if (!indices.includes(si) || sp.anchors.length < 3) return sp;
    const flat = flattenCommands(fromSubpaths([sp]), tolerance / 8)[0];
    if (!flat) return sp;
    const pts = flat.points.slice();
    if (sp.closed && pts.length > 2 && near(pts[0], pts[pts.length - 1])) pts.pop();
    const made = toSubpaths(simplifyPoints(pts, tolerance, sp.closed))[0];
    return made && made.anchors.length > 1 ? { anchors: made.anchors, closed: sp.closed } : sp;
  });
}
