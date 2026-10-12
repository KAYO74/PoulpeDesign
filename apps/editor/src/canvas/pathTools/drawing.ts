import {
  anchorKey,
  isSmooth,
  pathToWorld,
  segmentCount,
  segmentCubic,
  type PathNode,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import { ui } from '../../store';
import type { PathTools } from '../pathTools';
import { boxHandles, nodeBox } from './box';

/*
 * Outil Nœud : dessin dans le repère de l'écran (zone de sélection, nœuds, poignées, segment
 * survolé, cadre de transformation et repères d'aimantation).
 */

export function draw(pt: PathTools, ctx: CanvasRenderingContext2D, color: string): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  const handle = (a: Vec, h: Vec | null) => {
    if (!h) return;
    const qa = pt.c.toScreen(a),
      qh = pt.c.toScreen(h);
    ctx.beginPath();
    ctx.moveTo(qa.x, qa.y);
    ctx.lineTo(qh.x, qh.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(qh.x, qh.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
  };

  const zone = pt.nodeSel?.moved ? pt.nodeSel : null;
  const poly = pt.polygon;
  if (zone || poly) {
    const pts = zone
      ? zone.mode === 'lasso'
        ? zone.points
        : [
            zone.points[0],
            { x: zone.points[1].x, y: zone.points[0].y },
            zone.points[1],
            { x: zone.points[0].x, y: zone.points[1].y },
          ]
      : [...poly!.points, ...(poly!.hover ? [poly!.hover] : [])];
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    pts.forEach((w, i) => {
      const q = pt.c.toScreen(w);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    if (zone) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  const n = pt.editablePath();
  if (n) drawNodes(pt, ctx, color, n, handle);
  ctx.restore();
}

/** Nœuds du tracé édité : net = carré, lisse = rond, intelligent = rond pointé (comme dans Affinity). */
function drawNodes(
  pt: PathTools,
  ctx: CanvasRenderingContext2D,
  color: string,
  n: PathNode,
  handle: (a: Vec, h: Vec | null) => void,
): void {
  const sps = pt.subpathsOf(n);
  const sel = new Set(ui.get().nodeSelection);
  const w = (p: Vec) => pathToWorld(n, p);
  const opts = ui.get().nodeOptions;
  const curve = (sp: SubPath, i: number) => {
    const b = segmentCubic(sp, i).map((q) => pt.c.toScreen(w(q)));
    ctx.beginPath();
    ctx.moveTo(b[0].x, b[0].y);
    ctx.bezierCurveTo(b[1].x, b[1].y, b[2].x, b[2].y, b[3].x, b[3].y);
    ctx.stroke();
  };
  if (opts.orientation) {
    // Sens du tracé : le segment qui mène au dernier nœud est en rouge.
    ctx.save();
    ctx.strokeStyle = '#e5484d';
    ctx.lineWidth = 2;
    for (const sp of sps) {
      const count = segmentCount(sp);
      if (count) curve(sp, count - 1);
    }
    ctx.restore();
  }
  const hov = pt.segHover?.id === n.id && !pt.drag ? pt.segHover : null;
  const hsp = hov && sps[hov.si];
  if (hov && hsp && hov.seg < segmentCount(hsp)) {
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = hov.mod === 'delete' ? '#e5484d' : color;
    if (hov.mod === 'straighten') {
      // Alt : aperçu du segment redressé.
      ctx.setLineDash([4, 3]);
      const a = pt.c.toScreen(w(hsp.anchors[hov.seg])),
        b = pt.c.toScreen(w(hsp.anchors[(hov.seg + 1) % hsp.anchors.length]));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else curve(hsp, hov.seg);
    if (hov.mod === 'add') {
      const q = pt.c.toScreen(w(hov.point));
      ctx.lineWidth = 1.5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  sps.forEach((sp, si) =>
    sp.anchors.forEach((a, ai) => {
      if (!sel.has(anchorKey(si, ai))) return;
      handle(w(a), a.in && w(a.in));
      handle(w(a), a.out && w(a.out));
    }),
  );
  sps.forEach((sp, si) =>
    sp.anchors.forEach((a, ai) => {
      const q = pt.c.toScreen(w(a));
      const on = sel.has(anchorKey(si, ai));
      ctx.fillStyle = on ? color : '#ffffff';
      if (a.smart || isSmooth(a)) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (a.smart) {
          ctx.fillStyle = on ? '#ffffff' : color;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillRect(q.x - 3.5, q.y - 3.5, 7, 7);
        ctx.strokeRect(q.x - 3, q.y - 3, 6, 6);
      }
    }),
  );
  const nb = pt.drag?.kind === 'box' && pt.drag.moved ? null : nodeBox(pt, n, sps);
  if (nb) {
    const b = nb.scr;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    for (const [, q] of boxHandles(b)) {
      ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
      ctx.strokeRect(q.x - 2.5, q.y - 2.5, 5, 5);
    }
    ctx.restore();
  }
  if (pt.snapGuides.length) {
    ctx.save();
    ctx.strokeStyle = '#e5484d';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (const g of pt.snapGuides) {
      const a = pt.c.toScreen(g.a),
        b = pt.c.toScreen(g.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
