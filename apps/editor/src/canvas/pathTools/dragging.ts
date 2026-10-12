import {
  anchorKey,
  anchorsOf,
  bendSegment,
  cloneSubpaths,
  deleteSegment,
  findNode,
  insertAnchor,
  isSmooth,
  moveAnchors,
  moveHandle,
  nearestSegment,
  parseAnchorKey,
  pathToWorld,
  refreshSmart,
  straightenSegment,
  worldToPath,
  type PathNode,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import { editor, ui } from '../../store';
import type { PathTools } from '../pathTools';
import { collectSnapLines, snapPoint } from '../snapping';
import { commitNodes } from './actions';
import { boxHit, boxTransform, nodeBox } from './box';
import { HIT, segmentMod, writePath, type NodeDrag } from './common';
import { hitAnchor } from './selection';

/*
 * Outil Nœud : glissement des nœuds, de leurs poignées, d'un segment (ou simple clic dessus) et du
 * cadre de transformation, avec l'aimantation des nœuds et des poignées. Chaque glissement est un
 * geste de l'éditeur : il s'annule en une fois.
 */

const unit = (v: Vec): Vec | null => {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-9 ? null : { x: v.x / l, y: v.y / l };
};

function constrain45(from: Vec, p: Vec): Vec {
  const dx = p.x - from.x,
    dy = p.y - from.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy) * Math.cos(Math.atan2(dy, dx) - ang);
  return { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
}

function dist(pt: PathTools, a: Vec, b: Vec): number {
  const sa = pt.c.toScreen(a),
    sb = pt.c.toScreen(b);
  return Math.hypot(sa.x - sb.x, sa.y - sb.y);
}

export function nodeDown(pt: PathTools, e: PointerEvent, p: Vec, s: Vec, n: PathNode): boolean {
  const sps = pt.subpathsOf(n);
  const handle = boxHit(pt, n, sps, s);
  const nb = handle && nodeBox(pt, n, sps);
  if (handle && nb) {
    editor.begin();
    pt.drag = {
      kind: 'box',
      id: n.id,
      base: sps,
      keys: ui.get().nodeSelection,
      handle,
      box: nb.box,
      center: nb.center,
      start: p,
      startScreen: s,
      moved: false,
    };
    return true;
  }
  const hit = hitAnchor(pt, n, sps, s);
  const pp = worldToPath(n, p);
  if (hit?.which) {
    const [si, ai] = parseAnchorKey(hit.key);
    editor.begin();
    pt.drag = {
      kind: 'handle',
      id: n.id,
      base: sps,
      key: hit.key,
      which: hit.which,
      smooth: isSmooth(sps[si].anchors[ai]),
    };
    return true;
  }
  if (hit) {
    if (e.altKey) {
      // Alt+clic sur un nœud : il devient net, comme dans Affinity.
      ui.set({ nodeSelection: [hit.key] });
      pt.editNodes('sharp');
      return true;
    }
    let sel = ui.get().nodeSelection;
    if (e.shiftKey) sel = sel.includes(hit.key) ? sel.filter((k) => k !== hit.key) : [...sel, hit.key];
    else if (!sel.includes(hit.key)) sel = [hit.key];
    ui.set({ nodeSelection: sel });
    if (!sel.includes(hit.key)) return true;
    const [si, ai] = parseAnchorKey(hit.key);
    const grab = sps[si].anchors[ai];
    const chosen = new Set(sel);
    const targets: Vec[] = [];
    sps.forEach((sp, i) =>
      sp.anchors.forEach((a, j) => !chosen.has(anchorKey(i, j)) && targets.push(pathToWorld(n, a))),
    );
    editor.begin();
    pt.drag = {
      kind: 'anchors',
      id: n.id,
      base: sps,
      start: pp,
      keys: sel,
      moved: false,
      grab: { x: grab.x, y: grab.y },
      targets,
      lines: pt.c.snapping() ? collectSnapLines(editor.doc, new Set([n.id])) : null,
    };
    return true;
  }
  const seg = nearestSegment(sps, pp);
  if (seg) {
    const q = pt.c.toScreen(pathToWorld(n, seg.point));
    if (Math.hypot(q.x - s.x, q.y - s.y) <= HIT) {
      editor.begin();
      pt.drag = {
        kind: 'segment',
        id: n.id,
        base: sps,
        si: seg.si,
        seg: seg.seg,
        t: seg.t,
        startScreen: s,
        moved: false,
        mod: segmentMod(e),
      };
      return true;
    }
  }
  return false;
}

function previewNodes(id: string, sps: SubPath[]): void {
  editor.preview((d) => {
    const n = findNode(d, id)?.node;
    if (n?.type === 'path') writePath(n, sps);
  });
}

/**
 * Aimantation du nœud saisi : sur les autres nœuds du tracé (alignement horizontal ou vertical),
 * puis sur les repères du document. Renvoie le déplacement corrigé (repère du tracé).
 */
function snapAnchors(
  pt: PathTools,
  origin: PathNode,
  g: Extract<NodeDrag, { kind: 'anchors' }>,
  dx: number,
  dy: number,
  free: boolean,
): [number, number] {
  if (free) return [dx, dy];
  const w = pathToWorld(origin, { x: g.grab.x + dx, y: g.grab.y + dy });
  const thr = pt.c.snapThreshold();
  let x: number | null = null,
    y: number | null = null;
  if (ui.get().nodeOptions.alignNodes) {
    let bx = thr,
      by = thr;
    for (const t of g.targets) {
      if (Math.abs(t.x - w.x) < bx) {
        bx = Math.abs(t.x - w.x);
        x = t.x;
      }
      if (Math.abs(t.y - w.y) < by) {
        by = Math.abs(t.y - w.y);
        y = t.y;
      }
    }
  }
  if (g.lines && (x === null || y === null)) {
    const r = snapPoint(w, g.lines, thr, pt.c.gridStep());
    if (x === null && r.x !== w.x) x = r.x;
    if (y === null && r.y !== w.y) y = r.y;
  }
  const q = { x: x ?? w.x, y: y ?? w.y };
  // Repères : du nœud aligné jusqu'au nœud déplacé.
  for (const t of g.targets) {
    if (x !== null && t.x === x) pt.snapGuides.push({ a: t, b: q });
    if (y !== null && t.y === y) pt.snapGuides.push({ a: t, b: q });
  }
  const pq = worldToPath(origin, q);
  return [pq.x - g.grab.x, pq.y - g.grab.y];
}

/**
 * Aimantation de construction d'une poignée : alignée sur le nœud voisin, à 90° de lui, ou dans le
 * prolongement de l'autre poignée. Renvoie la position corrigée (repère du tracé).
 */
function snapHandle(
  pt: PathTools,
  origin: PathNode,
  sp: SubPath,
  ai: number,
  which: 'in' | 'out',
  q: Vec,
  mirrored: boolean,
): Vec {
  const a = sp.anchors[ai];
  const n = sp.anchors.length;
  const nb =
    which === 'out'
      ? (sp.anchors[ai + 1] ?? (sp.closed ? sp.anchors[0] : null))
      : (sp.anchors[ai - 1] ?? (sp.closed ? sp.anchors[n - 1] : null));
  const W = (v: Vec) => pathToWorld(origin, v);
  const wa = W(a),
    wq = W(q);
  const v = { x: wq.x - wa.x, y: wq.y - wa.y };
  const len = Math.hypot(v.x, v.y);
  const dir = unit(v);
  if (!dir) return q;
  const cands: Vec[] = [];
  const toNb = nb && unit({ x: W(nb).x - wa.x, y: W(nb).y - wa.y });
  if (toNb) cands.push(toNb, { x: -toNb.y, y: toNb.x }, { x: toNb.y, y: -toNb.x });
  const other = which === 'out' ? a.in : a.out;
  const away = !mirrored && other && unit({ x: wa.x - W(other).x, y: wa.y - W(other).y });
  if (away) cands.push(away);
  let best: Vec | null = null,
    bestCos = Math.cos((4 * Math.PI) / 180);
  for (const c of cands) {
    const cos = c.x * dir.x + c.y * dir.y;
    if (cos > bestCos) {
      bestCos = cos;
      best = c;
    }
  }
  if (!best) return q;
  const snapped = { x: wa.x + best.x * len, y: wa.y + best.y * len };
  const reach = Math.max(len, 40 / pt.c.view.zoom);
  pt.snapGuides.push({
    a: { x: wa.x - best.x * reach, y: wa.y - best.y * reach },
    b: { x: wa.x + best.x * reach * 2, y: wa.y + best.y * reach * 2 },
  });
  return worldToPath(origin, snapped);
}

export function nodeMove(pt: PathTools, e: PointerEvent, p: Vec, s: Vec): void {
  const g = pt.drag;
  if (!g) return;
  // Les conversions passent par le tracé tel qu'il était au début du geste.
  const base = findNode(editor.getState().doc, g.id)?.node;
  const origin = pt.gestureNode(g.id) ?? (base?.type === 'path' ? base : null);
  if (!origin) return;
  const pp = worldToPath(origin, p);
  const sps = cloneSubpaths(g.base);
  pt.snapGuides = [];
  if (g.kind === 'anchors') {
    let dx = pp.x - g.start.x,
      dy = pp.y - g.start.y;
    if (!g.moved && dist(pt, pathToWorld(origin, g.start), p) < 3) return;
    g.moved = true;
    if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    else [dx, dy] = snapAnchors(pt, origin, g, dx, dy, e.ctrlKey || e.metaKey);
    moveAnchors(sps, g.keys, dx, dy);
  } else if (g.kind === 'handle') {
    const [si, ai] = parseAnchorKey(g.key);
    const a = sps[si].anchors[ai];
    // Tirer la poignée d'un nœud intelligent le rend lisse.
    delete a.smart;
    const mirrored = g.smooth && !e.altKey;
    let q = e.shiftKey ? constrain45(a, pp) : pp;
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && ui.get().nodeOptions.snapHandles)
      q = snapHandle(pt, origin, sps[si], ai, g.which, q, mirrored);
    moveHandle(a, g.which, q, mirrored ? 'angle' : false);
  } else if (g.kind === 'box') {
    if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return;
    g.moved = true;
    const f = boxTransform(g, p, e.shiftKey);
    const conv = (v: Vec) => worldToPath(origin, f(pathToWorld(origin, v)));
    for (const a of anchorsOf(sps, g.keys)) {
      const q = conv(a);
      a.in = a.in && conv(a.in);
      a.out = a.out && conv(a.out);
      a.x = q.x;
      a.y = q.y;
    }
  } else {
    if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return;
    g.moved = true;
    const sp = sps[g.si];
    delete sp.anchors[g.seg].smart;
    delete sp.anchors[(g.seg + 1) % sp.anchors.length].smart;
    bendSegment(sps, g.si, g.seg, g.t, pp);
  }
  refreshSmart(sps);
  previewNodes(g.id, sps);
}

export function nodeUp(pt: PathTools): void {
  const g = pt.drag;
  pt.drag = null;
  pt.gestureBase = null;
  pt.snapGuides = [];
  if (!g) return;
  if (g.kind === 'segment' && !g.moved) {
    editor.cancel();
    let sps = cloneSubpaths(g.base);
    let sel: string[] = [];
    if (g.mod === 'straighten') straightenSegment(sps, g.si, g.seg);
    else if (g.mod === 'delete') sps = deleteSegment(sps, g.si, g.seg);
    else sel = [insertAnchor(sps, g.si, g.seg, g.t)];
    refreshSmart(sps);
    commitNodes(g.id, sps, g.mod === 'delete' ? 'history.deleteSegment' : 'history.nodes');
    ui.set({ nodeSelection: sel });
    return;
  }
  if ((g.kind === 'anchors' || g.kind === 'box') && !g.moved) {
    editor.cancel();
    return;
  }
  editor.commit('history.nodes');
}
