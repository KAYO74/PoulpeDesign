import { findNode, nodeBounds, type Box, type PoulpeDocument } from '@poulpe/core';
import { ui } from '../store';

const SQRT3_2 = Math.sqrt(3) / 2;

/**
 * Point de la grille isométrique le plus proche. Les lignes verticales sont espacées de
 * `step·√3/2` et les obliques (±30°) se croisent tous les `step/2` en hauteur, une colonne sur deux
 * décalée d'un demi-cran.
 */
export function snapIso(p: { x: number; y: number }, step: number): { x: number; y: number } {
  const a = step * SQRT3_2,
    b = step / 2;
  const i = Math.round(p.x / a);
  let j = Math.round(p.y / b);
  if ((i + j) % 2 !== 0) j += p.y / b > j ? 1 : -1;
  return { x: i * a, y: j * b };
}

const isoOn = () => ui.get().settings.gridIso;

/** Lignes de magnétisme : repères, bords et centres des plans de travail et des autres objets. */
export interface SnapLines {
  xs: number[];
  ys: number[];
}

export interface SnapGuide {
  axis: 'x' | 'y';
  pos: number;
}

export function collectSnapLines(doc: PoulpeDocument, exclude: Set<string>, guides = true): SnapLines {
  const xs: number[] = guides ? [...(doc.guides?.x ?? [])] : [];
  const ys: number[] = guides ? [...(doc.guides?.y ?? [])] : [];
  const add = (b: Box) => {
    xs.push(b.x, b.x + b.width / 2, b.x + b.width);
    ys.push(b.y, b.y + b.height / 2, b.y + b.height);
  };
  for (const ab of doc.artboards) {
    add(ab);
    for (const n of ab.children) {
      if (exclude.has(n.id) || !n.visible) continue;
      add(nodeBounds(n));
    }
  }
  return { xs, ys };
}

function nearest(values: number[], v: number, threshold: number): number | null {
  let best: number | null = null;
  let bestD = threshold;
  for (const c of values) {
    const d = Math.abs(c - v);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Ajuste un déplacement (dx, dy) pour qu'un bord ou le centre de la boîte colle à une ligne. */
export function snapMove(
  box: Box,
  dx: number,
  dy: number,
  lines: SnapLines,
  threshold: number,
  grid: number | null,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  if (grid && isoOn()) {
    // Grille isométrique : le coin haut-gauche va sur le point le plus proche, sauf repère plus près.
    const raw = snapMove(box, dx, dy, lines, threshold, null);
    if (raw.guides.length) return raw;
    const q = snapIso({ x: box.x + dx, y: box.y + dy }, grid);
    return { dx: q.x - box.x, dy: q.y - box.y, guides };
  }
  const fx = [box.x + dx, box.x + dx + box.width / 2, box.x + dx + box.width];
  const fy = [box.y + dy, box.y + dy + box.height / 2, box.y + dy + box.height];
  let bestX: { delta: number; pos: number } | null = null;
  for (const f of fx) {
    const c = nearest(lines.xs, f, threshold);
    if (c !== null && (!bestX || Math.abs(c - f) < Math.abs(bestX.delta))) bestX = { delta: c - f, pos: c };
  }
  let bestY: { delta: number; pos: number } | null = null;
  for (const f of fy) {
    const c = nearest(lines.ys, f, threshold);
    if (c !== null && (!bestY || Math.abs(c - f) < Math.abs(bestY.delta))) bestY = { delta: c - f, pos: c };
  }
  if (bestX) {
    dx += bestX.delta;
    guides.push({ axis: 'x', pos: bestX.pos });
  } else if (grid) dx = Math.round((box.x + dx) / grid) * grid - box.x;
  if (bestY) {
    dy += bestY.delta;
    guides.push({ axis: 'y', pos: bestY.pos });
  } else if (grid) dy = Math.round((box.y + dy) / grid) * grid - box.y;
  return { dx, dy, guides };
}

/** Colle un point aux lignes proches (pour dessiner ou redimensionner). */
export function snapPoint(
  p: { x: number; y: number },
  lines: SnapLines,
  threshold: number,
  grid: number | null,
): { x: number; y: number; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  const { xs, ys } = lines;
  let x = p.x,
    y = p.y;
  if (grid && isoOn()) {
    const cx = nearest(xs, p.x, threshold),
      cy = nearest(ys, p.y, threshold);
    if (cx === null && cy === null) return { ...snapIso(p, grid), guides };
  }
  const cx = nearest(xs, p.x, threshold);
  if (cx !== null) {
    x = cx;
    guides.push({ axis: 'x', pos: cx });
  } else if (grid) x = Math.round(p.x / grid) * grid;
  const cy = nearest(ys, p.y, threshold);
  if (cy !== null) {
    y = cy;
    guides.push({ axis: 'y', pos: cy });
  } else if (grid) y = Math.round(p.y / grid) * grid;
  return { x, y, guides };
}

export function idsWithDescendants(doc: PoulpeDocument, ids: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const n = findNode(doc, id)?.node;
    if (!n) continue;
    const visit = (m: typeof n) => {
      out.add(m.id);
      if (m.type === 'group') m.children.forEach(visit);
    };
    visit(n);
  }
  return out;
}
