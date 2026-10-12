import { flattenCommands } from './bezier';
import { createText, type Defaults } from './factory';
import {
  boxesIntersect,
  clipMaskOf,
  localToWorld,
  nodeBounds,
  pathToSvg,
  shapePath,
  worldToLocal,
  type Box,
  type PathCommand,
  type Vec,
} from './geometry';
import { cachedSvgPath, fitCommands } from './path';
import type { TextRegion } from './textRegion';
import type { PoulpeDocument, SceneNode, TextNode, TextStyle, TextWrap } from './types';

/*
 * Habillage du texte (Mise en page), comme dans Affinity Publisher : un objet qui a un habillage
 * repousse le texte des cadres de texte placés sous lui dans sa page. Chaque ligne d'un cadre
 * prend les places libres à sa hauteur : dans sa colonne (marges intérieures déduites), dans la
 * forme du cadre s'il en a une, hors des objets qui l'habillent (leur boîte, leur contour, ou toute
 * la largeur pour « sauter » l'objet), à la distance voulue.
 */

type Interval = [number, number];

/** Un objet qui habille un cadre, dans le repère du cadre. */
export interface WrapObstacle {
  type: 'square' | 'tight' | 'jump';
  side: NonNullable<TextWrap['side']>;
  distance: number;
  /** Boîte de l'objet. */
  box: Box;
  /** Contours de l'objet (habillage au plus près). */
  polys: Vec[][];
}

/** L'objet repousse-t-il le texte ? (`through` et l'absence d'habillage : non). */
export function wrapsText(n: SceneNode): boolean {
  const t = n.wrap?.type;
  return t === 'square' || t === 'tight' || t === 'jump';
}

/** Marges intérieures d'un cadre de texte : haut, droite, bas, gauche (positives). */
export function frameInsets(node: Pick<TextNode, 'insets'>): [number, number, number, number] {
  const i = node.insets;
  if (!i) return [0, 0, 0, 0];
  return [Math.max(0, i[0]), Math.max(0, i[1]), Math.max(0, i[2]), Math.max(0, i[3])];
}

// ————— Objets qui habillent —————

interface WrapEntry {
  node: SceneNode;
  /** Rang dans l'ordre de dessin de la page (du dessous vers le dessus). */
  order: number;
}

interface WrapIndex {
  order: Map<string, number>;
  page: Map<string, string>;
  /** Objets qui habillent, par page, dans l'ordre de dessin. */
  wraps: Map<string, WrapEntry[]>;
}

const indexCache = new WeakMap<PoulpeDocument, WrapIndex>();

/** Ordre de dessin de chaque objet et objets qui habillent, page par page (mémorisé). */
function wrapIndex(doc: PoulpeDocument): WrapIndex {
  const frozen = Object.isFrozen(doc);
  const hit = frozen ? indexCache.get(doc) : undefined;
  if (hit) return hit;
  const order = new Map<string, number>();
  const page = new Map<string, string>();
  const wraps = new Map<string, WrapEntry[]>();
  for (const ab of doc.artboards) {
    let i = 0;
    const list: WrapEntry[] = [];
    // `blocked` : dans un objet caché ou dans un groupe qui habille déjà en entier.
    const visit = (nodes: SceneNode[], blocked: boolean) => {
      for (const n of nodes) {
        const at = i++;
        order.set(n.id, at);
        page.set(n.id, ab.id);
        const active = !blocked && n.visible && wrapsText(n);
        if (active) list.push({ node: n, order: at });
        if (n.type === 'group') visit(n.children, blocked || active || !n.visible);
      }
    };
    visit(ab.children, false);
    if (list.length) wraps.set(ab.id, list);
  }
  const out = { order, page, wraps };
  if (frozen) indexCache.set(doc, out);
  return out;
}

/** Marge que l'habillage ajoute autour d'un objet : sa distance et la moitié de son contour. */
function wrapReach(n: SceneNode): number {
  const stroke =
    'stroke' in n && n.stroke.paint.type !== 'none' && n.stroke.width > 0 ? n.stroke.width / 2 : 0;
  return Math.max(0, n.wrap?.distance ?? 0) + stroke;
}

/**
 * Objets qui habillent ce cadre : ceux de sa page placés au-dessus de lui dans les calques, qui
 * touchent sa boîte. Rien si le cadre ignore l'habillage.
 */
export function wrapSources(doc: PoulpeDocument, frame: TextNode): SceneNode[] {
  if (frame.ignoreWrap || frame.path) return [];
  const idx = wrapIndex(doc);
  const pageId = idx.page.get(frame.id);
  const list = pageId ? idx.wraps.get(pageId) : undefined;
  if (!list) return [];
  const at = idx.order.get(frame.id)!;
  const fb = nodeBounds(frame);
  const out: SceneNode[] = [];
  for (const e of list) {
    if (e.order <= at || e.node.id === frame.id) continue;
    const r = wrapReach(e.node);
    const b = nodeBounds(e.node);
    const grown = { x: b.x - r, y: b.y - r, width: b.width + 2 * r, height: b.height + 2 * r };
    // Un objet qui saute le texte agit sur toute la largeur : seule sa hauteur compte.
    const jump = e.node.wrap?.type === 'jump';
    if (jump ? grown.y <= fb.y + fb.height && fb.y <= grown.y + grown.height : boxesIntersect(grown, fb))
      out.push(e.node);
  }
  return out;
}

/** Contours d'un objet dans son repère local (un cadre d'image : son cadre). */
function outlines(n: SceneNode): { node: SceneNode; polys: Vec[][] }[] {
  if (!n.visible) return [];
  if (n.type === 'group') {
    const mask = clipMaskOf(n);
    if (mask) return outlines(mask);
    return n.children.flatMap(outlines);
  }
  if (n.type === 'adjustment') return [];
  const polys = flattenCommands(shapePath(n), 1).map((p) => p.points);
  return [{ node: n, polys }];
}

/** Objets qui habillent ce cadre, ramenés dans son repère. */
export function wrapObstacles(doc: PoulpeDocument, frame: TextNode): WrapObstacle[] {
  return wrapSources(doc, frame).map((n) => {
    const wrap = n.wrap!;
    const toFrame = (owner: SceneNode, p: Vec) => worldToLocal(frame, localToWorld(owner, p));
    const b = nodeBounds(n);
    const corners = [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
      { x: b.x, y: b.y + b.height },
    ].map((p) => worldToLocal(frame, p));
    // Objet tourné par rapport au cadre : sa boîte dans le repère du cadre.
    const local = n.type !== 'group' ? [0, 1, 2, 3].map((k) => toFrame(n, cornerOf(n, k))) : corners;
    const polys =
      wrap.type === 'tight'
        ? outlines(n).flatMap((o) => o.polys.map((poly) => poly.map((p) => toFrame(o.node, p))))
        : [];
    return {
      type: wrap.type as WrapObstacle['type'],
      side: wrap.side ?? 'both',
      distance: wrapReach(n),
      box: bounds(local),
      polys,
    };
  });
}

function cornerOf(n: SceneNode, k: number): Vec {
  return [
    { x: 0, y: 0 },
    { x: n.width, y: 0 },
    { x: n.width, y: n.height },
    { x: 0, y: n.height },
  ][k];
}

function bounds(points: Vec[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ————— Géométrie des bandes —————

/** Étendue horizontale des contours entre les hauteurs y0 et y1 (null s'ils n'y passent pas). */
export function polysExtent(polys: Vec[][], y0: number, y1: number): Interval | null {
  let a = Infinity,
    b = -Infinity;
  for (const poly of polys) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i],
        q = poly[(i + 1) % n];
      const lo = Math.max(y0, Math.min(p.y, q.y)),
        hi = Math.min(y1, Math.max(p.y, q.y));
      if (lo > hi) continue;
      if (p.y === q.y) {
        a = Math.min(a, p.x, q.x);
        b = Math.max(b, p.x, q.x);
        continue;
      }
      for (const yy of [lo, hi]) {
        const x = p.x + ((yy - p.y) / (q.y - p.y)) * (q.x - p.x);
        a = Math.min(a, x);
        b = Math.max(b, x);
      }
    }
  }
  return a <= b ? [a, b] : null;
}

/** Intervalles à l'intérieur des contours sur la ligne horizontale `y` (pair-impair). */
function insideAt(polys: Vec[][], y: number): Interval[] {
  const xs: number[] = [];
  for (const poly of polys) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i],
        q = poly[(i + 1) % n];
      if (p.y <= y === q.y <= y) continue;
      xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
    }
  }
  xs.sort((u, v) => u - v);
  const out: Interval[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [p, q] of a)
    for (const [r, s] of b) {
      const lo = Math.max(p, r),
        hi = Math.min(q, s);
      if (hi > lo) out.push([lo, hi]);
    }
  return out.sort((u, v) => u[0] - v[0]);
}

function subtract(a: Interval[], [r, s]: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [p, q] of a) {
    if (s <= p || r >= q) out.push([p, q]);
    else {
      if (r > p) out.push([p, r]);
      if (s < q) out.push([s, q]);
    }
  }
  return out;
}

/**
 * Intervalles où toute la bande [y0, y1] est dans la forme : l'intersection des coupes aux bords
 * de la bande et aux sommets qu'elle contient (le contour est une ligne brisée).
 */
export function insideBand(polys: Vec[][], y0: number, y1: number): Interval[] {
  const ys = new Set([y0 + 1e-6, y1 - 1e-6, (y0 + y1) / 2]);
  for (const poly of polys) for (const p of poly) if (p.y > y0 && p.y < y1) ys.add(p.y);
  let out: Interval[] | null = null;
  for (const yy of ys) {
    const cut = insideAt(polys, yy);
    out = out ? intersect(out, cut) : cut;
    if (!out.length) return [];
  }
  return out ?? [];
}

/** Partie d'une bande qu'un objet interdit au texte, dans une colonne [c0, c1]. */
function blocked(o: WrapObstacle, y0: number, y1: number, c0: number, c1: number): Interval | null {
  const d = o.distance;
  if (y1 <= o.box.y - d || y0 >= o.box.y + o.box.height + d) return null;
  let a: number, b: number;
  if (o.type === 'jump') return [-Infinity, Infinity];
  if (o.type === 'square') {
    a = o.box.x - d;
    b = o.box.x + o.box.width + d;
  } else {
    const e = polysExtent(o.polys, y0 - d, y1 + d);
    if (!e) return null;
    a = e[0] - d;
    b = e[1] + d;
  }
  if (b <= c0 || a >= c1) return null;
  switch (o.side) {
    case 'left':
      return [a, Infinity];
    case 'right':
      return [-Infinity, b];
    case 'largest':
      return a - c0 >= c1 - b ? [a, Infinity] : [-Infinity, b];
    default:
      return [a, b];
  }
}

// ————— Forme d'un cadre —————

/** Contour d'un cadre de texte de forme, dans le repère de sa boîte (vide sans forme). */
export function frameShapeCommands(node: Pick<TextNode, 'frameShape' | 'width' | 'height'>): PathCommand[] {
  const s = node.frameShape;
  if (!s) return [];
  return fitCommands(cachedSvgPath(s.d), s.viewBox, { x: 0, y: 0, width: node.width, height: node.height });
}

/** Forme d'un cadre de texte prise sur une forme (son contour, son remplissage et son contour). */
export function frameShapeOf(shape: SceneNode): NonNullable<TextNode['frameShape']> {
  const out: NonNullable<TextNode['frameShape']> = {
    d: pathToSvg(shapePath(shape)),
    viewBox: { x: 0, y: 0, width: shape.width || 1, height: shape.height || 1 },
  };
  if ('fill' in shape && shape.type !== 'line' && shape.fill.type !== 'none') out.fill = shape.fill;
  if ('stroke' in shape && shape.stroke.paint.type !== 'none' && shape.stroke.width > 0)
    out.stroke = shape.stroke;
  return out;
}

/** La forme est-elle fermée (elle peut devenir un cadre de texte) ? */
export function isClosedShape(n: SceneNode): boolean {
  if (n.type === 'rect' || n.type === 'ellipse' || n.type === 'polygon' || n.type === 'star') return true;
  if (n.type !== 'path') return false;
  const subs = flattenCommands(shapePath(n), 1);
  return subs.length > 0 && subs.every((s) => s.closed && s.points.length > 2);
}

/**
 * Cadre de texte de la forme d'une forme fermée (outil Cadre de texte cliqué dans la forme, ou
 * « Convertir en cadre de texte ») : même place, même rotation, même apparence ; le texte se pose
 * dans son contour.
 */
export function shapeToTextFrame(shape: SceneNode, name: string, defaults?: Defaults): TextNode {
  const t = createText(
    { x: shape.x, y: shape.y, width: shape.width, height: shape.height, name, autoWidth: false },
    defaults,
  );
  t.frame = true;
  t.frameShape = frameShapeOf(shape);
  t.rotation = shape.rotation;
  t.opacity = shape.opacity;
  t.blendMode = shape.blendMode;
  t.visible = shape.visible;
  if (shape.effects?.length) t.effects = shape.effects;
  if (shape.wrap) t.wrap = shape.wrap;
  return t;
}

// ————— Zone de texte d'un cadre —————

/** Zone où se posent les lignes d'un cadre : colonnes, marges intérieures, forme et habillage. */
export function frameRegion(
  frame: Pick<TextNode, 'width' | 'height' | 'insets' | 'frameShape'>,
  style: Pick<TextStyle, 'columns'>,
  obstacles: WrapObstacle[] = [],
): TextRegion {
  const [it, ir, ib, il] = frameInsets(frame);
  const count = Math.max(1, Math.round(style.columns?.count ?? 1));
  const gap = Math.max(0, style.columns?.gap ?? 0);
  const inner = frame.width - il - ir;
  const colW = count > 1 ? Math.max(1, (inner - gap * (count - 1)) / count) : Math.max(1, inner);
  const shape = frame.frameShape
    ? flattenCommands(frameShapeCommands(frame), 0.5).map((p) => p.points)
    : null;
  const column = (c: number): Interval => [il + c * (colW + gap), il + c * (colW + gap) + colW];
  /** Places de la colonne dans la forme du cadre, sans tenir compte de l'habillage. */
  const inShape = (col: number, y0: number, y1: number): Interval[] => {
    const free: Interval[] = [column(col)];
    if (!shape) return free;
    const inside = insideBand(shape, y0, y1).map(([a, b]) => [a + il, b - ir] as Interval);
    return intersect(
      free,
      inside.filter(([a, b]) => b > a),
    );
  };
  const slots = (col: number, y0: number, y1: number): Interval[] => {
    const [c0, c1] = column(col);
    let free = inShape(col, y0, y1);
    for (const o of obstacles) {
      if (!free.length) break;
      const cut = blocked(o, y0, y1, c0, c1);
      if (cut) free = subtract(free, cut);
    }
    return free.filter(([a, b]) => b - a > 0.5);
  };
  let widest = colW;
  if (shape) {
    // Forme : sa plus large place pour une ligne de 1 px, de haut en bas (jamais plus qu'une colonne).
    let w = 0;
    const steps = 64;
    for (let k = 0; k <= steps; k++) {
      const yy = it + ((frame.height - it - ib) * k) / steps;
      for (const [a, b] of inShape(0, yy - 0.5, yy + 0.5)) w = Math.max(w, b - a);
    }
    widest = Math.max(1, Math.min(colW, w));
  }
  return {
    columns: count,
    top: it,
    bottom: Math.max(it, frame.height - ib),
    widest,
    slots,
    shaped: !!shape || obstacles.length > 0,
  };
}
