import {
  activeEffects,
  arrowPaths,
  contourReach,
  dashPattern,
  effectMargin,
  filtersReach,
  nodeBounds,
  shapePath,
  strokeCap,
  strokeJoin,
  visibleStrokes,
  type Box,
  type PathCommand,
  type SceneNode,
  type ShapeNode,
  type Stroke,
} from '@poulpe/core';
import type { Ctx } from './canvas';

/*
 * Géométrie des objets sur la toile : tracés (`Path2D`) mémorisés, style des contours et flèches,
 * repère local d'un objet et boîte de tout ce qu'il peut peindre.
 *
 * `touches`, `applyNodeTransform`, `arrowPath` et `inverseLocal` sont internes au paquet :
 * index.ts ne les réexporte pas.
 */

/** Tracés des objets, mémorisés comme les mises en page de texte (voir les caches de layout.ts). */
const pathCache = new WeakMap<SceneNode, Path2D>();

/** Tracé d'un objet dans son repère local, mémorisé tant que l'objet ne change pas. */
export function nodePath(node: SceneNode): Path2D {
  if (!Object.isFrozen(node)) return toPath2D(shapePath(node));
  let p = pathCache.get(node);
  if (!p) {
    p = toPath2D(shapePath(node));
    pathCache.set(node, p);
  }
  return p;
}

export function toPath2D(cmds: PathCommand[]): Path2D {
  const p = new Path2D();
  for (const c of cmds) {
    if (c.op === 'M') p.moveTo(c.x, c.y);
    else if (c.op === 'L') p.lineTo(c.x, c.y);
    else if (c.op === 'C') p.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else p.closePath();
  }
  return p;
}

const reachCache = new WeakMap<SceneNode, Box>();

/**
 * Boîte de tout ce qu'un objet peut peindre : sa boîte, élargie de ses contours (angles vifs et
 * flèches compris), de ses effets et, pour un texte, de ce qui peut dépasser de son cadre.
 */
export function paintBounds(node: SceneNode): Box {
  const frozen = Object.isFrozen(node);
  const hit = frozen ? reachCache.get(node) : undefined;
  if (hit) return hit;
  let b = nodeBounds(node);
  let pad = 2;
  if (node.type === 'group') {
    // Les contours des enfants peuvent dépasser de la boîte du groupe.
    const kids = node.children.map(paintBounds);
    const x0 = Math.min(b.x, ...kids.map((k) => k.x)),
      y0 = Math.min(b.y, ...kids.map((k) => k.y));
    const x1 = Math.max(b.x + b.width, ...kids.map((k) => k.x + k.width)),
      y1 = Math.max(b.y + b.height, ...kids.map((k) => k.y + k.height));
    b = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  } else if (node.type === 'symbol') {
    // Contenu d'un symbole : ses contours sont inconnus ici, on garde une large marge.
    pad += Math.max(node.width, node.height) / 2;
  } else if ('stroke' in node) {
    for (const st of visibleStrokes(node)) pad = Math.max(pad, 2 + st.width * 6);
    pad += contourReach(node);
  }
  if (node.type === 'text') {
    let size = node.style.fontSize;
    for (const r of node.runs ?? []) size = Math.max(size, r.style.fontSize ?? 0);
    pad += size * 2;
  }
  if (node.effects?.length) pad += effectMargin(activeEffects(node));
  if (node.filters?.length) pad += filtersReach(node);
  const box = { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
  if (frozen) reachCache.set(node, box);
  return box;
}

export function touches(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function applyNodeTransform(ctx: Ctx, node: SceneNode) {
  ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
  if (node.rotation) ctx.rotate((node.rotation * Math.PI) / 180);
  ctx.translate(-node.width / 2, -node.height / 2);
}

/** Applique le style d'un contour (épaisseur, extrémités, jonctions, pointillés). */
export function applyStrokeStyle(ctx: Ctx, stroke: Stroke): void {
  ctx.lineWidth = stroke.width;
  ctx.lineJoin = strokeJoin(stroke);
  ctx.lineCap = strokeCap(stroke);
  ctx.miterLimit = 10;
  ctx.setLineDash(dashPattern(stroke));
}

const arrowCache = new WeakMap<Stroke, Path2D | null>();

/** Flèches d'un tracé ouvert, mémorisées tant que le contour ne change pas. */
export function arrowPath(node: ShapeNode, stroke: Stroke): Path2D | null {
  if ((!stroke.start || stroke.start === 'none') && (!stroke.end || stroke.end === 'none')) return null;
  if (Object.isFrozen(stroke) && arrowCache.has(stroke)) return arrowCache.get(stroke)!;
  const cmds = arrowPaths(shapePath(node), stroke);
  const p = cmds.length ? toPath2D(cmds) : null;
  if (Object.isFrozen(stroke)) arrowCache.set(stroke, p);
  return p;
}

/** Inverse de la transformation locale d'un objet (pour revenir au repère du monde après un écrêtage). */
export function inverseLocal(node: SceneNode): DOMMatrix {
  return new DOMMatrix()
    .translate(node.x + node.width / 2, node.y + node.height / 2)
    .rotate(node.rotation)
    .translate(-node.width / 2, -node.height / 2)
    .inverse();
}
