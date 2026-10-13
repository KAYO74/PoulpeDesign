import {
  anchorKey,
  findNode,
  nearestSegment,
  parseAnchorKey,
  pathToWorld,
  worldToPath,
  type PathNode,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import { editor, ui } from '../../store';
import type { PathTools } from '../pathTools';
import { boxHit } from './box';
import { HIT, segmentMod, type NodeSelOp } from './common';

/*
 * Outil Nœud : repérage des nœuds, poignées et segments sous le pointeur, et sélection des nœuds
 * (clic droit, zone au cadre, au lasso ou au polygone, [ et ]).
 */

function insidePolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Nœud ou poignée sous le point écran. */
export function hitAnchor(
  pt: PathTools,
  n: PathNode,
  sps: SubPath[],
  s: Vec,
): { key: string; which: 'in' | 'out' | null } | null {
  const sel = new Set(ui.get().nodeSelection);
  const scr = (p: Vec) => pt.c.toScreen(pathToWorld(n, p));
  const near = (p: Vec) => {
    const q = scr(p);
    return Math.hypot(q.x - s.x, q.y - s.y) <= HIT;
  };
  // Les poignées des nœuds sélectionnés passent en premier : elles peuvent recouvrir un nœud.
  for (let si = 0; si < sps.length; si++)
    for (let ai = 0; ai < sps[si].anchors.length; ai++) {
      const key = anchorKey(si, ai);
      if (!sel.has(key)) continue;
      const a = sps[si].anchors[ai];
      if (a.out && near(a.out)) return { key, which: 'out' };
      if (a.in && near(a.in)) return { key, which: 'in' };
    }
  for (let si = 0; si < sps.length; si++)
    for (let ai = 0; ai < sps[si].anchors.length; ai++)
      if (near(sps[si].anchors[ai])) return { key: anchorKey(si, ai), which: null };
  return null;
}

/** Clic droit sur un nœud : il est sélectionné (s'il ne l'était pas) pour le menu des nœuds. */
export function nodeMenuAt(pt: PathTools, s: Vec): boolean {
  const n = pt.editablePath();
  if (!n) return false;
  const hit = hitAnchor(pt, n, pt.subpathsOf(n), s);
  if (!hit) return false;
  if (!ui.get().nodeSelection.includes(hit.key)) ui.set({ nodeSelection: [hit.key] });
  return true;
}

/**
 * Sélection de nœuds à la zone, comme dans Affinity : Glisser = cadre, Alt = lasso, Alt+clic =
 * polygone ; Maj ajoute, bouton droit retire, Maj + bouton droit inverse la sélection.
 */
export function nodeSelectDown(pt: PathTools, e: PointerEvent, p: Vec, s: Vec): boolean {
  const n = pt.editablePath();
  if (!n) return false;
  if (pt.polygon) {
    if (e.altKey && e.button === 0) pt.polygon.points.push(p);
    else finishPolygon(pt);
    return true;
  }
  const right = e.button === 2;
  const op: NodeSelOp = right ? (e.shiftKey ? 'toggle' : 'subtract') : e.shiftKey ? 'add' : 'replace';
  pt.nodeSel = {
    id: n.id,
    mode: e.altKey ? 'lasso' : 'rect',
    points: [p, p],
    op,
    base: ui.get().nodeSelection,
    startScreen: s,
    moved: false,
  };
  return true;
}

function selectInside(
  pt: PathTools,
  id: string,
  inside: (w: Vec) => boolean,
  op: NodeSelOp,
  base: string[],
): void {
  const n = findNode(editor.doc, id)?.node;
  if (n?.type !== 'path') return;
  const hits: string[] = [];
  pt.subpathsOf(n).forEach((sp, si) =>
    sp.anchors.forEach((a, ai) => {
      if (inside(pathToWorld(n, a))) hits.push(anchorKey(si, ai));
    }),
  );
  const had = new Set(base);
  const hit = new Set(hits);
  let sel: string[];
  if (op === 'replace') sel = hits;
  else if (op === 'add') sel = [...base, ...hits.filter((k) => !had.has(k))];
  else if (op === 'subtract') sel = base.filter((k) => !hit.has(k));
  else sel = [...base.filter((k) => !hit.has(k)), ...hits.filter((k) => !had.has(k))];
  ui.set({ nodeSelection: sel });
}

export function applyNodeSel(pt: PathTools): void {
  const g = pt.nodeSel;
  if (!g) return;
  if (g.mode === 'lasso') selectInside(pt, g.id, (w) => insidePolygon(w, g.points), g.op, g.base);
  else {
    const [a, b] = [g.points[0], g.points[g.points.length - 1]];
    const x0 = Math.min(a.x, b.x),
      x1 = Math.max(a.x, b.x),
      y0 = Math.min(a.y, b.y),
      y1 = Math.max(a.y, b.y);
    selectInside(pt, g.id, (w) => w.x >= x0 && w.x <= x1 && w.y >= y0 && w.y <= y1, g.op, g.base);
  }
}

export function nodeSelectUp(pt: PathTools): void {
  const g = pt.nodeSel;
  pt.nodeSel = null;
  if (!g) return;
  if (g.moved) return applyNodeSel(pt);
  if (g.mode === 'lasso') {
    // Alt+clic sans glisser : premier sommet d'une sélection au polygone.
    pt.polygon = { id: g.id, points: [g.points[0]], hover: null, op: g.op, base: g.base };
    return;
  }
  if (g.op !== 'replace') return;
  // Simple clic dans le vide : on désélectionne les nœuds, puis l'objet.
  if (ui.get().nodeSelection.length) ui.set({ nodeSelection: [] });
  else editor.select([]);
}

export function finishPolygon(pt: PathTools): void {
  const g = pt.polygon;
  pt.polygon = null;
  if (g && g.points.length >= 3) selectInside(pt, g.id, (w) => insidePolygon(w, g.points), g.op, g.base);
  pt.c.requestDraw();
}

/** [ et ] : sélectionne le nœud précédent ou suivant du tracé édité. */
export function stepNode(pt: PathTools, step: 1 | -1): void {
  const n = pt.editablePath();
  if (!n) return;
  const sps = pt.subpathsOf(n);
  if (!sps.length) return;
  const sel = ui.get().nodeSelection;
  const last = sel[sel.length - 1];
  let [si, ai] = last ? parseAnchorKey(last) : [0, step > 0 ? -1 : 0];
  if (!sps[si]) [si, ai] = [0, -1];
  const count = sps[si].anchors.length;
  ai += step;
  if (ai >= count || ai < 0) {
    if (sps[si].closed) ai = (ai + count) % count;
    else {
      // Tracé ouvert : on passe au sous-tracé suivant (ou précédent).
      si = (si + step + sps.length) % sps.length;
      ai = step > 0 ? 0 : sps[si].anchors.length - 1;
    }
  }
  ui.set({ nodeSelection: [anchorKey(si, ai)] });
  pt.c.requestDraw();
}

/** Survol de l'outil Nœud : le segment sous le pointeur s'éclaire, avec l'effet du clic. */
export function hoverSegment(pt: PathTools, e: PointerEvent, p: Vec, s: Vec): void {
  const n = pt.editablePath();
  let next: PathTools['segHover'] = null;
  if (n) {
    const sps = pt.subpathsOf(n);
    if (!hitAnchor(pt, n, sps, s) && !boxHit(pt, n, sps, s)) {
      const seg = nearestSegment(sps, worldToPath(n, p));
      const q = seg && pt.c.toScreen(pathToWorld(n, seg.point));
      if (seg && q && Math.hypot(q.x - s.x, q.y - s.y) <= HIT)
        next = { id: n.id, si: seg.si, seg: seg.seg, point: seg.point, mod: segmentMod(e) };
    }
  }
  if (!next && !pt.segHover) return;
  pt.segHover = next;
  pt.c.requestDraw();
}
