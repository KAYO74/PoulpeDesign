import { editor, ui } from '../store';
import type { CanvasController } from './controller';
import { collectSnapLines, snapPoint } from './snapping';

/*
 * Repères du document (règles affichées) : repère sous le pointeur, glissement d'un repère nouveau
 * ou existant, et leur dessin sur le canevas.
 */

/** Repère sous le point écran, à 4 px près. */
export function hitGuide(
  ctl: CanvasController,
  sx: number,
  sy: number,
): { axis: 'x' | 'y'; index: number } | null {
  const g = editor.doc.guides;
  if (!g || !ui.get().settings.rulers) return null;
  const v = ctl.view;
  const ix = g.x.findIndex((x) => Math.abs(x * v.zoom + v.panX - sx) <= 4);
  if (ix >= 0) return { axis: 'x', index: ix };
  const iy = g.y.findIndex((y) => Math.abs(y * v.zoom + v.panY - sy) <= 4);
  return iy >= 0 ? { axis: 'y', index: iy } : null;
}

/**
 * Glisse un repère : nouveau (`index` null, tiré depuis une règle) ou existant. Relâché hors
 * du canevas (sur une règle), le repère est supprimé.
 */
export function dragGuide(
  ctl: CanvasController,
  axis: 'x' | 'y',
  index: number | null,
  e: PointerEvent,
): void {
  const target = e.target as Element;
  target.setPointerCapture?.(e.pointerId);
  editor.begin();
  const idx = index;
  const pos = (ev: PointerEvent) => {
    const r = ctl.canvas.getBoundingClientRect();
    const p = ctl.toWorld(ev.clientX - r.left, ev.clientY - r.top);
    let v = axis === 'x' ? p.x : p.y;
    if (ctl.snapping() && !ev.ctrlKey) {
      const lines = collectSnapLines(editor.doc, new Set(), false);
      const s = snapPoint(p, lines, ctl.snapThreshold(), ctl.gridStep());
      v = axis === 'x' ? s.x : s.y;
    }
    return Math.round(v * 100) / 100;
  };
  const inside = (ev: PointerEvent) => {
    const r = ctl.canvas.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientY >= r.top && ev.clientX <= r.right && ev.clientY <= r.bottom;
  };
  const move = (ev: PointerEvent) => {
    const v = pos(ev);
    const show = inside(ev);
    editor.preview((d) => {
      const g = (d.guides ??= { x: [], y: [] });
      const list = g[axis];
      if (idx === null) {
        if (!show) return;
        list.push(v);
      } else if (show) list[idx] = v;
      else list.splice(idx, 1);
    });
  };
  const up = (ev: PointerEvent) => {
    target.removeEventListener('pointermove', move as EventListener);
    target.removeEventListener('pointerup', up as EventListener);
    target.removeEventListener('pointercancel', up as EventListener);
    if (ev.type === 'pointercancel' || (idx === null && !inside(ev))) {
      editor.cancel();
      return;
    }
    move(ev);
    editor.commit('history.guide');
  };
  target.addEventListener('pointermove', move as EventListener);
  target.addEventListener('pointerup', up as EventListener);
  target.addEventListener('pointercancel', up as EventListener);
}

export function drawDocGuides(ctl: CanvasController, guides: { x: number[]; y: number[] }) {
  const ctx = ctl.ctx;
  ctx.save();
  ctx.strokeStyle = ctl.colors.docGuide;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const gx of guides.x) {
    const x = Math.round(ctl.toScreen({ x: gx, y: 0 }).x) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ctl.height);
  }
  for (const gy of guides.y) {
    const y = Math.round(ctl.toScreen({ x: 0, y: gy }).y) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(ctl.width, y);
  }
  ctx.stroke();
  ctx.restore();
}
