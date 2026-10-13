import { anchorsOf, pathToWorld, type PathNode, type SubPath, type Vec } from '@poulpe/core';
import { ui } from '../../store';
import type { PathTools } from '../pathTools';
import type { Box4, BoxHandle, NodeDrag } from './common';

/*
 * Outil Nœud : cadre de transformation des nœuds sélectionnés (option « Transformer »), ses
 * poignées et la transformation que leur glissement applique aux nœuds.
 */

/** Cadre des nœuds sélectionnés (monde) et sa version écran, agrandie d'une marge. */
export function nodeBox(
  pt: PathTools,
  n: PathNode,
  sps: SubPath[],
): { box: Box4; center: Vec; scr: Box4 } | null {
  if (!ui.get().nodeOptions.transform) return null;
  const keys = ui.get().nodeSelection;
  if (keys.length < 2) return null;
  const pts = [...anchorsOf(sps, keys)].map((a) => pathToWorld(n, a));
  if (pts.length < 2) return null;
  const box = {
    x0: Math.min(...pts.map((q) => q.x)),
    y0: Math.min(...pts.map((q) => q.y)),
    x1: Math.max(...pts.map((q) => q.x)),
    y1: Math.max(...pts.map((q) => q.y)),
  };
  const a = pt.c.toScreen({ x: box.x0, y: box.y0 }),
    b = pt.c.toScreen({ x: box.x1, y: box.y1 });
  const pad = 10;
  return {
    box,
    center: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 },
    scr: { x0: a.x - pad, y0: a.y - pad, x1: b.x + pad, y1: b.y + pad },
  };
}

export function boxHandles(b: Box4): [BoxHandle, Vec][] {
  const mx = (b.x0 + b.x1) / 2,
    my = (b.y0 + b.y1) / 2;
  return [
    ['nw', { x: b.x0, y: b.y0 }],
    ['n', { x: mx, y: b.y0 }],
    ['ne', { x: b.x1, y: b.y0 }],
    ['e', { x: b.x1, y: my }],
    ['se', { x: b.x1, y: b.y1 }],
    ['s', { x: mx, y: b.y1 }],
    ['sw', { x: b.x0, y: b.y1 }],
    ['w', { x: b.x0, y: my }],
  ];
}

/** Poignée du cadre de transformation sous le point écran (un peu en dehors d'un coin : rotation). */
export function boxHit(pt: PathTools, n: PathNode, sps: SubPath[], s: Vec): BoxHandle | null {
  const nb = nodeBox(pt, n, sps);
  if (!nb) return null;
  let rotate = false;
  for (const [h, q] of boxHandles(nb.scr)) {
    const d = Math.hypot(q.x - s.x, q.y - s.y);
    if (d <= 6) return h;
    const outside = s.x < nb.scr.x0 || s.x > nb.scr.x1 || s.y < nb.scr.y0 || s.y > nb.scr.y1;
    if (h.length === 2 && outside && d <= 20) rotate = true;
  }
  return rotate ? 'rotate' : null;
}

/** Transformation (monde → monde) du glissement en cours sur le cadre. */
export function boxTransform(g: Extract<NodeDrag, { kind: 'box' }>, p: Vec, shift: boolean): (w: Vec) => Vec {
  const c = g.center;
  if (g.handle === 'rotate') {
    let ang = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(g.start.y - c.y, g.start.x - c.x);
    if (shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
    const cos = Math.cos(ang),
      sin = Math.sin(ang);
    return (w) => ({
      x: c.x + (w.x - c.x) * cos - (w.y - c.y) * sin,
      y: c.y + (w.x - c.x) * sin + (w.y - c.y) * cos,
    });
  }
  const b = g.box;
  const hx = g.handle.includes('w') ? -1 : g.handle.includes('e') ? 1 : 0;
  const hy = g.handle.includes('n') ? -1 : g.handle.includes('s') ? 1 : 0;
  // Le côté opposé à la poignée ne bouge pas.
  const ox = hx < 0 ? b.x1 : b.x0,
    oy = hy < 0 ? b.y1 : b.y0;
  const ratio = (cur: number, start: number, o: number) => {
    const r = (cur - o) / (start - o);
    return isFinite(r) ? r : 1;
  };
  let sx = hx ? ratio(p.x, g.start.x, ox) : 1,
    sy = hy ? ratio(p.y, g.start.y, oy) : 1;
  if (shift && hx && hy) sx = sy = Math.abs(sx) > Math.abs(sy) ? sx : sy;
  return (w) => ({ x: ox + (w.x - ox) * sx, y: oy + (w.y - oy) * sy });
}
