import paper from 'paper';
import { PaperOffset } from 'paperjs-offset';
import { pathToSvg, type PathCommand } from './geometry';
import { parseSvgPath } from './path';
import type { Contour, SceneNode } from './types';

/*
 * Contour non destructif (outil Contour, comme dans Affinity) : le tracé d'une forme fermée est
 * décalé au moment de le dessiner, de l'exporter ou de le toucher. « Convertir en courbes »
 * l'applique pour de bon. Le décalage (Paper.js) coûte cher : il est mémorisé d'après le tracé
 * et ses réglages, ce qui sert aussi quand on déplace l'objet.
 */

let scope: paper.PaperScope | null = null;

function ps(): paper.PaperScope {
  if (!scope) {
    scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
  }
  scope.activate();
  return scope;
}

/** Tous les sous-tracés sont-ils fermés ? Le contour ne s'applique qu'aux formes fermées. */
export function isClosedPath(cmds: PathCommand[]): boolean {
  let open = false;
  let any = false;
  for (const c of cmds) {
    if (c.op === 'M') {
      if (open) return false;
      open = true;
      any = true;
    } else if (c.op === 'Z') open = false;
  }
  return any && !open;
}

/** Contour actif d'un objet : une forme (pas un texte ni une ligne) avec une distance non nulle. */
export function activeContour(node: SceneNode): Contour | null {
  if (
    node.type !== 'rect' &&
    node.type !== 'ellipse' &&
    node.type !== 'polygon' &&
    node.type !== 'star' &&
    node.type !== 'path'
  )
    return null;
  const c = node.contour;
  return c && Math.abs(c.radius) > 1e-3 ? c : null;
}

/** Portée du contour au-delà de la boîte de l'objet (angles vifs compris), en pixels. */
export function contourReach(node: SceneNode): number {
  const c = activeContour(node);
  if (!c || c.radius <= 0) return 0;
  return c.radius * (c.join === 'miter' ? Math.max(1, c.miterLimit) : 1.5);
}

const cache = new Map<string, PathCommand[]>();
const CACHE_SIZE = 256;

/** Tracé décalé d'un contour ; le tracé d'origine s'il est ouvert ou si le décalage échoue. */
export function contourCommands(base: PathCommand[], c: Contour): PathCommand[] {
  if (!base.length || !isClosedPath(base)) return base;
  const key = `${c.radius}|${c.join}|${c.miterLimit}|${pathToSvg(base, 2)}`;
  const hit = cache.get(key);
  if (hit) {
    // Le plus récent passe en fin de liste : on oublie d'abord les plus anciens.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let out: PathCommand[];
  try {
    const s = ps();
    const item = new s.CompoundPath({ pathData: pathToSvg(base, 4), insert: false });
    const res = PaperOffset.offset(item, c.radius, {
      join: c.join,
      limit: Math.max(1, c.miterLimit),
      insert: false,
    }) as paper.PathItem;
    // Une forme rétrécie au-delà de sa moitié disparaît.
    out =
      res.isEmpty() || Math.abs((res as paper.CompoundPath).area) < 0.01 ? [] : parseSvgPath(res.pathData);
  } catch {
    out = base;
  }
  cache.set(key, out);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return out;
}
