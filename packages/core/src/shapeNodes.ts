import { baseOutline, nodeCorners, pathToSvg, type PathCommand, type Vec } from './geometry';
import { createPath, type Defaults } from './factory';
import { cachedSvgPath, fitCommands } from './path';
import { cornerAt, cornerPoints, defaultShapeParams, shapeCommands } from './shapes';
import type { Corner, Corners, CornerType, PathNode, SceneNode, ShapeKind } from './types';

/*
 * Formes paramétriques et coins non destructifs, côté objets : création, mise à jour des
 * réglages, coins posés par l'outil Coin. La géométrie elle-même est dans shapes.ts.
 */

type BoxArgs = { x: number; y: number; width: number; height: number; name?: string };

/** Nouvelle forme paramétrique (triangle, flèche…), avec les réglages donnés ou ceux par défaut. */
export function createShape(
  kind: ShapeKind,
  b: BoxArgs,
  d: Defaults,
  params: Record<string, number> = {},
): PathNode {
  const shape = { kind, params: { ...defaultShapeParams(kind), ...params } };
  const w = Math.max(1, b.width),
    h = Math.max(1, b.height);
  const node = createPath(
    {
      ...b,
      d: pathToSvg(shapeCommands(shape, w, h)),
      viewBox: { x: 0, y: 0, width: w, height: h },
    },
    d,
  );
  node.shape = shape;
  // Une spirale est un tracé ouvert : un trait, sans remplissage.
  if (kind === 'spiral') {
    node.fill = { type: 'none' };
    if (node.stroke.paint.type === 'none' || node.stroke.width <= 0)
      node.stroke = { ...node.stroke, paint: { type: 'solid', color: '#1a1a1d' }, width: 2 };
  }
  return node;
}

/** Recopie dans `d` le contour d'une forme paramétrique à sa taille actuelle (brouillon). */
export function syncShape(node: PathNode): void {
  if (!node.shape) return;
  const w = node.width || 1,
    h = node.height || 1;
  node.viewBox = { x: 0, y: 0, width: w, height: h };
  node.d = pathToSvg(shapeCommands(node.shape, w, h));
}

/**
 * Contour de base d'un tracé (sans ses coins) dans le repère de `d` : celui que modifie l'outil
 * Nœud. Pour une forme paramétrique, il est recalculé à la taille actuelle.
 */
export function basePathCommands(node: PathNode): PathCommand[] {
  if (!node.shape) return cachedSvgPath(node.d);
  const local = { x: 0, y: 0, width: node.width, height: node.height };
  return fitCommands(shapeCommands(node.shape, node.width, node.height), local, node.viewBox);
}

/** L'objet peut-il recevoir des coins (outil Coin) ? */
export function acceptsCorners(node: SceneNode): boolean {
  return node.type === 'rect' || node.type === 'polygon' || node.type === 'star' || node.type === 'path';
}

/** Coin d'un objet pour l'outil Coin : position (repère local), réglage actuel. */
export interface CornerSite {
  key: string;
  p: Vec;
  corner: Corner | null;
}

/** Les nœuds anguleux d'un objet, là où l'outil Coin peut poser un coin. */
export function cornerSites(node: SceneNode): CornerSite[] {
  const base = baseOutline(node);
  if (!base) return [];
  const corners = nodeCorners(node);
  return cornerPoints(base).map((c) => ({
    key: c.key,
    p: { x: c.x, y: c.y },
    corner: cornerAt(corners, c.key),
  }));
}

const cornerOf = (radius: number, type: CornerType | undefined): Corner =>
  type && type !== 'round' ? { radius, type } : { radius };

/**
 * Pose des coins sur un objet (brouillon) : rayon et forme, sur les nœuds `keys` ou sur tous
 * (`null`). Un rayon nul retire le coin. Un rectangle garde ses coins dans ses rayons.
 */
export function setCorners(node: SceneNode, keys: string[] | null, radius: number, type?: CornerType): void {
  const r = Math.max(0, radius);
  if (node.type === 'rect') {
    if (type) {
      if (type === 'round') delete node.cornerType;
      else node.cornerType = type;
    }
    if (!keys) {
      node.cornerRadius = r;
      delete node.radii;
      return;
    }
    const radii = node.radii ? [...node.radii] : [0, 1, 2, 3].map(() => node.cornerRadius);
    for (const key of keys) {
      const i = Number(key.split(':')[1]);
      if (i >= 0 && i < 4) radii[i] = r;
    }
    // Quatre rayons égaux : le rectangle redevient « lié ».
    if (radii.every((v) => v === radii[0])) {
      node.cornerRadius = radii[0];
      delete node.radii;
    } else node.radii = radii as [number, number, number, number];
    return;
  }
  if (node.type !== 'polygon' && node.type !== 'star' && node.type !== 'path') return;
  if (!keys) {
    if (r > 0) node.corners = { '*': cornerOf(r, type) };
    else delete node.corners;
    return;
  }
  const map: Corners = { ...(node.corners ?? {}) };
  for (const key of keys) {
    const prev = map[key] ?? map['*'];
    if (r > 0) map[key] = cornerOf(r, type ?? prev?.type);
    // Sous un réglage commun, un coin retiré garde un rayon nul pour rester net.
    else if (map['*']) map[key] = { radius: 0 };
    else delete map[key];
  }
  if (Object.keys(map).length) node.corners = map;
  else delete node.corners;
}

/** Change la forme de tous les coins d'un objet (brouillon), sans toucher à leurs rayons. */
export function setCornerType(node: SceneNode, type: CornerType, keys: string[] | null = null): void {
  if (node.type === 'rect') {
    if (type === 'round') delete node.cornerType;
    else node.cornerType = type;
    return;
  }
  if ((node.type !== 'polygon' && node.type !== 'star' && node.type !== 'path') || !node.corners) return;
  const map: Corners = { ...node.corners };
  for (const k of keys ?? Object.keys(map)) {
    const c = map[k] ?? (keys ? map['*'] : undefined);
    if (c) map[k] = cornerOf(c.radius, type);
  }
  node.corners = map;
}
