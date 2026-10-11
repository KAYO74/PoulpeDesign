import { distanceToPolylines, flattenCommands, pointInPolylines } from './bezier';
import { cachedSvgPath, fitCommands } from './path';
import type { SceneNode, Artboard, GroupNode, Paint } from './types';

export interface Vec {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Commandes de tracé partagées par le rendu, l'export SVG et l'export PDF. */
export type PathCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

const DEG = Math.PI / 180;
/** Constante de l'approximation d'un quart de cercle par une courbe de Bézier cubique. */
const KAPPA = 0.5522847498;

export const rad = (deg: number) => deg * DEG;

export function rotatePoint(p: Vec, center: Vec, deg: number): Vec {
  if (!deg) return { x: p.x, y: p.y };
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

export function boxCenter(b: Box): Vec {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Passe d'un point du monde aux coordonnées locales de l'objet (0..width, 0..height). */
export function worldToLocal(node: Box & { rotation: number }, p: Vec): Vec {
  const c = boxCenter(node);
  const q = rotatePoint(p, c, -node.rotation);
  return { x: q.x - node.x, y: q.y - node.y };
}

export function localToWorld(node: Box & { rotation: number }, p: Vec): Vec {
  return rotatePoint({ x: node.x + p.x, y: node.y + p.y }, boxCenter(node), node.rotation);
}

/** Les quatre coins d'une boîte tournée, dans le monde. */
export function corners(node: Box & { rotation: number }): Vec[] {
  return [
    localToWorld(node, { x: 0, y: 0 }),
    localToWorld(node, { x: node.width, y: 0 }),
    localToWorld(node, { x: node.width, y: node.height }),
    localToWorld(node, { x: 0, y: node.height }),
  ];
}

export function boundsOfPoints(points: Vec[]): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return boundsOfPoints(
    boxes.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
    ]),
  );
}

/** Masque d'un groupe écrêté (son premier enfant), comme le dessinent le rendu et l'export SVG. */
export function clipMaskOf(g: GroupNode): SceneNode | null {
  const kids = g.children;
  return g.clip && kids.length > 1 && kids[0].type !== 'group' ? kids[0] : null;
}

/** Boîte englobante alignée sur les axes, dans le monde. */
export function nodeBounds(node: SceneNode): Box {
  if (node.type === 'group') {
    // Un masque d'écrêtage borne ce qu'on voit du groupe (cadre d'image : le cadre, pas l'image).
    const mask = clipMaskOf(node);
    if (mask) return nodeBounds(mask);
    return unionBoxes(node.children.map(nodeBounds)) ?? { x: node.x, y: node.y, width: 0, height: 0 };
  }
  return boundsOfPoints(corners(node));
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function boxContains(b: Box, p: Vec): boolean {
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

function regularPoints(n: number, w: number, h: number, inner?: number): Vec[] {
  const pts: Vec[] = [];
  const count = inner === undefined ? n : n * 2;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const r = inner !== undefined && i % 2 === 1 ? inner : 1;
    pts.push({ x: w / 2 + (Math.cos(a) * r * w) / 2, y: h / 2 + (Math.sin(a) * r * h) / 2 });
  }
  return pts;
}

function polyline(pts: Vec[], close = true): PathCommand[] {
  const cmds: PathCommand[] = pts.map((p, i) => ({ op: i ? 'L' : 'M', x: p.x, y: p.y }) as PathCommand);
  if (close) cmds.push({ op: 'Z' });
  return cmds;
}

export function ellipsePath(x: number, y: number, w: number, h: number): PathCommand[] {
  const rx = w / 2,
    ry = h / 2,
    cx = x + rx,
    cy = y + ry,
    ox = rx * KAPPA,
    oy = ry * KAPPA;
  return [
    { op: 'M', x: cx + rx, y: cy },
    { op: 'C', x1: cx + rx, y1: cy + oy, x2: cx + ox, y2: cy + ry, x: cx, y: cy + ry },
    { op: 'C', x1: cx - ox, y1: cy + ry, x2: cx - rx, y2: cy + oy, x: cx - rx, y: cy },
    { op: 'C', x1: cx - rx, y1: cy - oy, x2: cx - ox, y2: cy - ry, x: cx, y: cy - ry },
    { op: 'C', x1: cx + ox, y1: cy - ry, x2: cx + rx, y2: cy - oy, x: cx + rx, y: cy },
    { op: 'Z' },
  ];
}

export function roundRectPath(x: number, y: number, w: number, h: number, radius: number): PathCommand[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (!r) {
    return polyline([
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]);
  }
  const k = r * (1 - KAPPA);
  return [
    { op: 'M', x: x + r, y },
    { op: 'L', x: x + w - r, y },
    { op: 'C', x1: x + w - k, y1: y, x2: x + w, y2: y + k, x: x + w, y: y + r },
    { op: 'L', x: x + w, y: y + h - r },
    { op: 'C', x1: x + w, y1: y + h - k, x2: x + w - k, y2: y + h, x: x + w - r, y: y + h },
    { op: 'L', x: x + r, y: y + h },
    { op: 'C', x1: x + k, y1: y + h, x2: x, y2: y + h - k, x, y: y + h - r },
    { op: 'L', x, y: y + r },
    { op: 'C', x1: x, y1: y + k, x2: x + k, y2: y, x: x + r, y },
    { op: 'Z' },
  ];
}

/** Tracé d'une forme dans ses coordonnées locales (0..width, 0..height). */
export function shapePath(node: SceneNode): PathCommand[] {
  const { width: w, height: h } = node;
  switch (node.type) {
    case 'rect':
      return roundRectPath(0, 0, w, h, node.cornerRadius);
    case 'ellipse':
      return ellipsePath(0, 0, w, h);
    case 'polygon':
      return polyline(regularPoints(Math.max(3, Math.round(node.sides)), w, h));
    case 'star':
      return polyline(regularPoints(Math.max(3, Math.round(node.points)), w, h, node.innerRatio));
    case 'line':
      return node.direction === 1
        ? polyline(
            [
              { x: 0, y: 0 },
              { x: w, y: h },
            ],
            false,
          )
        : polyline(
            [
              { x: 0, y: h },
              { x: w, y: 0 },
            ],
            false,
          );
    case 'path':
      return fitCommands(cachedSvgPath(node.d), node.viewBox, { x: 0, y: 0, width: w, height: h });
    case 'text':
    case 'image':
    case 'group':
    case 'adjustment':
    case 'symbol':
      return roundRectPath(0, 0, w, h, 0);
  }
}

export function pathToSvg(cmds: PathCommand[], precision = 3): string {
  const f = (n: number) => String(+n.toFixed(precision));
  return cmds
    .map((c) => {
      switch (c.op) {
        case 'M':
        case 'L':
          return `${c.op}${f(c.x)} ${f(c.y)}`;
        case 'C':
          return `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join('');
}

/** Points de départ et d'arrivée d'un dégradé linéaire, comme en CSS : la ligne couvre toute la boîte. */
export function linearGradientPoints(angle: number, w: number, h: number): [Vec, Vec] {
  const a = angle * DEG;
  const dx = Math.cos(a),
    dy = Math.sin(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = w / 2,
    cy = h / 2;
  return [
    { x: cx - dx * half, y: cy - dy * half },
    { x: cx + dx * half, y: cy + dy * half },
  ];
}

/** Rayon d'un dégradé radial en pixels : `r` est une fraction de la plus grande dimension de la boîte. */
export function radialGradientRadius(
  paint: Extract<Paint, { type: 'radial' }>,
  w: number,
  h: number,
): number {
  return paint.r * Math.max(w, h);
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const flatCache = new WeakMap<SceneNode, ReturnType<typeof flattenCommands>>();

/** Le point du monde touche-t-il l'objet ? `tolerance` en unités du monde. */
export function hitNode(node: SceneNode, p: Vec, tolerance = 0): boolean {
  // Un calque de réglage couvre tout le plan de travail : on le choisit dans le panneau Calques.
  if (!node.visible || node.type === 'adjustment') return false;
  if (node.type === 'group') {
    // Groupe écrêté : seul ce qui est dans le masque se voit, donc se touche.
    const mask = clipMaskOf(node);
    if (mask && !hitNode(mask, p, tolerance)) {
      const b = nodeBounds(mask);
      const t = tolerance;
      if (p.x < b.x - t || p.y < b.y - t || p.x > b.x + b.width + t || p.y > b.y + b.height + t) return false;
      return node.children.some((c, i) => i > 0 && hitNode(c, p, tolerance));
    }
    return !!mask || node.children.some((c) => hitNode(c, p, tolerance));
  }
  const l = worldToLocal(node, p);
  if (node.type === 'line') {
    const a = node.direction === 1 ? { x: 0, y: 0 } : { x: 0, y: node.height };
    const b = node.direction === 1 ? { x: node.width, y: node.height } : { x: node.width, y: 0 };
    return distToSegment(l, a, b) <= Math.max(tolerance, node.stroke.width / 2 + tolerance);
  }
  const t = tolerance;
  if (l.x < -t || l.y < -t || l.x > node.width + t || l.y > node.height + t) return false;
  if (node.type === 'ellipse') {
    const rx = node.width / 2 + t,
      ry = node.height / 2 + t;
    const nx = (l.x - node.width / 2) / rx,
      ny = (l.y - node.height / 2) / ry;
    return nx * nx + ny * ny <= 1;
  }
  if (node.type === 'path' || node.type === 'polygon' || node.type === 'star') {
    // Forme libre : on touche le remplissage ou le trait, pas la boîte entière.
    let polys = flatCache.get(node);
    if (!polys) {
      polys = flattenCommands(shapePath(node), 1);
      if (Object.isFrozen(node)) flatCache.set(node, polys);
    }
    const stroked = node.stroke.paint.type !== 'none' && node.stroke.width > 0;
    if (
      node.fill.type !== 'none' &&
      pointInPolylines(polys, l, node.type === 'path' ? node.fillRule : 'nonzero')
    )
      return true;
    const reach = (stroked ? node.stroke.width / 2 : 0) + Math.max(t, 1);
    return distanceToPolylines(polys, l) <= reach;
  }
  return true;
}

export function artboardBox(a: Artboard): Box {
  return { x: a.x, y: a.y, width: a.width, height: a.height };
}
