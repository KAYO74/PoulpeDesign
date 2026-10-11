import { localToWorld, pathToSvg, worldToLocal, type PathCommand, type Vec } from './geometry';
import { cubicPoint, exactBounds, nearestOnCubic, splitCubic, type Cubic } from './bezier';
import { cachedSvgPath, fitCommands } from './path';
import { shapeCommands } from './shapes';
import type { Corners, PathNode } from './types';

/*
 * Tracés modifiables : la plume, l'outil Nœud et le crayon travaillent sur des sous-tracés faits
 * de nœuds (ancres) avec leurs poignées, plutôt que sur des commandes M, L, C et Z.
 */

/** Nœud d'un tracé. Une poignée absente (`null`) est confondue avec le nœud. */
export interface Anchor {
  x: number;
  y: number;
  in: Vec | null;
  out: Vec | null;
  /** Nœud intelligent : ses poignées se recalculent d'après ses voisins (comme dans Affinity). */
  smart?: boolean;
}

export interface SubPath {
  anchors: Anchor[];
  closed: boolean;
}

const EPS = 1e-6;
const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
const pt = (x: number, y: number): Vec => ({ x, y });

// ————— Sous-tracés —————

/** Commandes → sous-tracés. Un dernier nœud confondu avec le premier d'un tracé fermé est fusionné. */
export function toSubpaths(cmds: PathCommand[]): SubPath[] {
  const out: SubPath[] = [];
  let cur: SubPath | null = null;
  let start: Vec = pt(0, 0);
  for (const c of cmds) {
    if (c.op === 'M') {
      cur = { anchors: [{ x: c.x, y: c.y, in: null, out: null }], closed: false };
      start = pt(c.x, c.y);
      out.push(cur);
      continue;
    }
    if (c.op === 'Z') {
      if (cur) {
        cur.closed = true;
        const a = cur.anchors;
        if (a.length > 1 && same(a[0], a[a.length - 1])) a[0].in = a.pop()!.in;
      }
      cur = null;
      continue;
    }
    if (!cur) {
      // Commande de tracé sans M après un Z : on repart du début du sous-tracé précédent.
      cur = { anchors: [{ x: start.x, y: start.y, in: null, out: null }], closed: false };
      out.push(cur);
    }
    const prev = cur.anchors[cur.anchors.length - 1];
    if (c.op === 'L') cur.anchors.push({ x: c.x, y: c.y, in: null, out: null });
    else {
      const c1 = pt(c.x1, c.y1),
        c2 = pt(c.x2, c.y2),
        end = pt(c.x, c.y);
      prev.out = same(c1, prev) ? null : c1;
      cur.anchors.push({ x: c.x, y: c.y, in: same(c2, end) ? null : c2, out: null });
    }
  }
  return out;
}

/** Sous-tracés → commandes M, L, C et Z. */
export function fromSubpaths(sps: SubPath[]): PathCommand[] {
  const out: PathCommand[] = [];
  const seg = (p: Anchor, q: Anchor): PathCommand =>
    p.out || q.in
      ? {
          op: 'C',
          x1: (p.out ?? p).x,
          y1: (p.out ?? p).y,
          x2: (q.in ?? q).x,
          y2: (q.in ?? q).y,
          x: q.x,
          y: q.y,
        }
      : { op: 'L', x: q.x, y: q.y };
  for (const sp of sps) {
    const a = sp.anchors;
    if (!a.length) continue;
    out.push({ op: 'M', x: a[0].x, y: a[0].y });
    for (let i = 1; i < a.length; i++) out.push(seg(a[i - 1], a[i]));
    if (sp.closed) {
      const last = a[a.length - 1];
      if (a.length > 1 && (last.out || a[0].in)) out.push(seg(last, a[0]));
      out.push({ op: 'Z' });
    }
  }
  return out;
}

export function cloneSubpaths(sps: SubPath[]): SubPath[] {
  return sps.map((s) => ({
    closed: s.closed,
    anchors: s.anchors.map((a) => ({
      x: a.x,
      y: a.y,
      in: a.in && { ...a.in },
      out: a.out && { ...a.out },
      ...(a.smart ? { smart: true } : {}),
    })),
  }));
}

/** Clé d'un nœud : « sous-tracé:nœud ». */
export const anchorKey = (si: number, ai: number): string => `${si}:${ai}`;
export function parseAnchorKey(key: string): [number, number] {
  const [a, b] = key.split(':').map(Number);
  return [a, b];
}

/** Segments d'un sous-tracé : le segment i va du nœud i au nœud suivant. */
export function segmentCubic(sp: SubPath, i: number): Cubic {
  const a = sp.anchors[i],
    b = sp.anchors[(i + 1) % sp.anchors.length];
  return [pt(a.x, a.y), a.out ?? pt(a.x, a.y), b.in ?? pt(b.x, b.y), pt(b.x, b.y)];
}

export function segmentCount(sp: SubPath): number {
  const n = sp.anchors.length;
  return sp.closed ? (n > 1 ? n : 0) : Math.max(0, n - 1);
}

/** Un nœud est lisse si ses deux poignées sont alignées de part et d'autre. */
export function isSmooth(a: Anchor): boolean {
  if (!a.in || !a.out) return false;
  const ix = a.in.x - a.x,
    iy = a.in.y - a.y,
    ox = a.out.x - a.x,
    oy = a.out.y - a.y;
  const li = Math.hypot(ix, iy),
    lo = Math.hypot(ox, oy);
  if (li < EPS || lo < EPS) return false;
  return Math.abs(ix * oy - iy * ox) / (li * lo) < 0.02 && ix * ox + iy * oy < 0;
}

/** Segment du tracé le plus proche d'un point. */
export function nearestSegment(
  sps: SubPath[],
  p: Vec,
): { si: number; seg: number; t: number; dist: number; point: Vec } | null {
  let best: { si: number; seg: number; t: number; dist: number; point: Vec } | null = null;
  sps.forEach((sp, si) => {
    for (let i = 0; i < segmentCount(sp); i++) {
      const b = segmentCubic(sp, i);
      const r = nearestOnCubic(b, p);
      if (!best || r.dist < best.dist) best = { si, seg: i, t: r.t, dist: r.dist, point: cubicPoint(b, r.t) };
    }
  });
  return best;
}

/** Ajoute un nœud sur un segment, sans changer la forme. Renvoie la clé du nouveau nœud. */
export function insertAnchor(sps: SubPath[], si: number, seg: number, t: number): string {
  const sp = sps[si];
  const a = sp.anchors[seg],
    bIndex = (seg + 1) % sp.anchors.length,
    b = sp.anchors[bIndex];
  let node: Anchor;
  if (!a.out && !b.in) {
    node = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, in: null, out: null };
  } else {
    const [l, r] = splitCubic(segmentCubic(sp, seg), t);
    a.out = l[1];
    b.in = r[2];
    node = { x: l[3].x, y: l[3].y, in: l[2], out: r[1] };
  }
  sp.anchors.splice(seg + 1, 0, node);
  return anchorKey(si, seg + 1);
}

/** Supprime des nœuds ; un sous-tracé réduit à un seul nœud disparaît. */
export function deleteAnchors(sps: SubPath[], keys: string[]): SubPath[] {
  const set = new Set(keys);
  return sps
    .map((sp, si) => ({ ...sp, anchors: sp.anchors.filter((_, ai) => !set.has(anchorKey(si, ai))) }))
    .filter((sp) => sp.anchors.length > 1);
}

export function moveAnchors(sps: SubPath[], keys: string[], dx: number, dy: number): void {
  for (const k of keys) {
    const [si, ai] = parseAnchorKey(k);
    const a = sps[si]?.anchors[ai];
    if (!a) continue;
    a.x += dx;
    a.y += dy;
    if (a.in) a.in = pt(a.in.x + dx, a.in.y + dy);
    if (a.out) a.out = pt(a.out.x + dx, a.out.y + dy);
  }
}

/**
 * Déplace une poignée. `mirror` : la poignée opposée reste alignée (nœud lisse), avec sa longueur
 * (`'angle'`) ou avec la même longueur (`'symmetric'`, pendant le tracé à la plume).
 */
export function moveHandle(
  a: Anchor,
  which: 'in' | 'out',
  pos: Vec,
  mirror: false | 'angle' | 'symmetric',
): void {
  const other = which === 'in' ? 'out' : 'in';
  a[which] = same(pos, a) ? null : pt(pos.x, pos.y);
  if (!mirror) return;
  const h = a[which];
  if (!h) return;
  const dx = h.x - a.x,
    dy = h.y - a.y;
  const len = Math.hypot(dx, dy);
  const o = a[other];
  const olen = mirror === 'symmetric' ? len : o ? Math.hypot(o.x - a.x, o.y - a.y) : 0;
  if (olen < EPS || len < EPS) return;
  a[other] = pt(a.x - (dx / len) * olen, a.y - (dy / len) * olen);
}

/** Poignées lisses d'un nœud : alignées sur ses voisins, au tiers de la distance qui les sépare. */
function smoothHandles(sp: SubPath, ai: number): void {
  const a = sp.anchors[ai];
  const n = sp.anchors.length;
  const prev = ai > 0 ? sp.anchors[ai - 1] : sp.closed ? sp.anchors[n - 1] : null;
  const next = ai < n - 1 ? sp.anchors[ai + 1] : sp.closed ? sp.anchors[0] : null;
  if (!prev && !next) return;
  const from = prev ?? a,
    to = next ?? a;
  let dx = to.x - from.x,
    dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const lp = prev ? Math.hypot(a.x - prev.x, a.y - prev.y) / 3 : 0;
  const ln = next ? Math.hypot(next.x - a.x, next.y - a.y) / 3 : 0;
  a.in = prev ? pt(a.x - dx * lp, a.y - dy * lp) : null;
  a.out = next ? pt(a.x + dx * ln, a.y + dy * ln) : null;
}

/**
 * Type de nœud : net (sans poignées), lisse (poignées alignées sur ses voisins) ou intelligent
 * (lisse, et ses poignées suivent quand ses voisins bougent).
 */
export function setAnchorKind(sps: SubPath[], keys: string[], kind: 'sharp' | 'smooth' | 'smart'): void {
  for (const k of keys) {
    const [si, ai] = parseAnchorKey(k);
    const sp = sps[si];
    const a = sp?.anchors[ai];
    if (!a) continue;
    delete a.smart;
    if (kind === 'sharp') {
      a.in = a.out = null;
      continue;
    }
    smoothHandles(sp, ai);
    if (kind === 'smart') a.smart = true;
  }
}

/** Recalcule les poignées des nœuds intelligents (après un déplacement de nœuds). */
export function refreshSmart(sps: SubPath[]): void {
  for (const sp of sps) sp.anchors.forEach((a, ai) => a.smart && smoothHandles(sp, ai));
}

/** Positions des nœuds intelligents, pour les garder dans le document (`PathNode.smartNodes`). */
export function smartMarks(sps: SubPath[]): Vec[] {
  return sps.flatMap((sp) => sp.anchors.filter((a) => a.smart).map((a) => pt(a.x, a.y)));
}

/** Marque comme intelligents les nœuds qui sont aux positions gardées dans le document. */
export function markSmart(sps: SubPath[], marks: Vec[] | undefined): SubPath[] {
  if (!marks?.length) return sps;
  for (const sp of sps)
    for (const a of sp.anchors)
      if (marks.some((m) => Math.abs(m.x - a.x) < 1e-3 && Math.abs(m.y - a.y) < 1e-3)) a.smart = true;
  return sps;
}

/**
 * Courbe un segment en le tirant par un de ses points : le point d'abscisse `t` vient en `target`,
 * les extrémités ne bougent pas.
 */
export function bendSegment(sps: SubPath[], si: number, seg: number, t: number, target: Vec): void {
  const sp = sps[si];
  const a = sp.anchors[seg],
    b = sp.anchors[(seg + 1) % sp.anchors.length];
  const cur = segmentCubic(sp, seg);
  const p = cubicPoint(cur, t);
  const tt = Math.min(0.95, Math.max(0.05, t));
  // Les deux points de contrôle bougent du même vecteur d : B(t) bouge de 3(1-t)t·d.
  const k = 1 / (3 * (1 - tt) * tt);
  const dx = (target.x - p.x) * k,
    dy = (target.y - p.y) * k;
  a.out = pt(cur[1].x + dx, cur[1].y + dy);
  b.in = pt(cur[2].x + dx, cur[2].y + dy);
}

// ————— Objets tracés —————

/** Facteurs d'échelle entre le repère du tracé (`viewBox`) et la boîte de l'objet. */
export function pathScale(node: Pick<PathNode, 'viewBox' | 'width' | 'height'>): { kx: number; ky: number } {
  const vb = node.viewBox;
  const kx = vb.width ? node.width / vb.width : vb.height ? node.height / vb.height : 1;
  const ky = vb.height ? node.height / vb.height : kx;
  return { kx: kx || 1, ky: ky || 1 };
}

/** Point du repère du tracé → monde. */
export function pathToWorld(node: PathNode, p: Vec): Vec {
  const { kx, ky } = pathScale(node);
  return localToWorld(node, pt((p.x - node.viewBox.x) * kx, (p.y - node.viewBox.y) * ky));
}

/** Point du monde → repère du tracé. */
export function worldToPath(node: PathNode, p: Vec): Vec {
  const { kx, ky } = pathScale(node);
  const l = worldToLocal(node, p);
  return pt(l.x / kx + node.viewBox.x, l.y / ky + node.viewBox.y);
}

/**
 * Remplace les données d'un tracé (exprimées dans son repère) et recale sa boîte sur le nouveau
 * contour, sans le déplacer à l'écran. Modifie l'objet reçu (brouillon).
 */
export function setPathCommands(node: PathNode, cmds: PathCommand[]): void {
  if (node.corners) remapCorners(node, cmds);
  const nb = exactBounds(cmds) ?? { x: 0, y: 0, width: 0, height: 0 };
  const { kx, ky } = pathScale(node);
  const vb = node.viewBox;
  const w = nb.width * kx,
    h = nb.height * ky;
  const x0 = (nb.x - vb.x) * kx,
    y0 = (nb.y - vb.y) * ky;
  const c = localToWorld(node, pt(x0 + w / 2, y0 + h / 2));
  node.width = w;
  node.height = h;
  node.x = c.x - w / 2;
  node.y = c.y - h / 2;
  node.viewBox = { ...nb };
  node.d = pathToSvg(cmds);
  // Des nœuds modifiés à la main : ce n'est plus une forme paramétrique.
  delete node.shape;
}

/**
 * Coins de l'outil Coin quand des nœuds sont ajoutés ou retirés : chaque coin suit son nœud (même
 * position), un coin dont le nœud a disparu est retiré. Les nœuds simplement déplacés gardent leur
 * coin (mêmes indices).
 */
function remapCorners(node: PathNode, cmds: PathCommand[]): void {
  const corners = node.corners!;
  const old = node.shape
    ? fitCommands(
        shapeCommands(node.shape, node.width, node.height),
        { x: 0, y: 0, width: node.width, height: node.height },
        node.viewBox,
      )
    : cachedSvgPath(node.d);
  const before = toSubpaths(old),
    after = toSubpaths(cmds);
  if (
    before.length === after.length &&
    before.every((sp, i) => sp.anchors.length === after[i].anchors.length)
  )
    return;
  const next: Corners = {};
  for (const [key, corner] of Object.entries(corners)) {
    if (key === '*') {
      next[key] = corner;
      continue;
    }
    const [si, ai] = parseAnchorKey(key);
    const a = before[si]?.anchors[ai];
    if (!a) continue;
    after.forEach((sp, sj) =>
      sp.anchors.forEach((b, bj) => {
        if (Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3) next[anchorKey(sj, bj)] = corner;
      }),
    );
  }
  if (Object.keys(next).length) node.corners = next;
  else delete node.corners;
}
