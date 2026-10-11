import { patchBlend, type Vec } from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { copyDrawable, makeCanvas } from '../../photo/pixels';
import { ui, type ToolId } from '../../store';
import type { ToolDelegate } from '../types';
import { pixelStore } from './store';
import { pixelTarget, toTarget, type PixelTarget } from './target';

/*
 * Outil Correctif de la Persona Photo : on entoure le défaut à main levée, puis on fait glisser
 * la zone sur une partie propre de l'image. Le défaut est remplacé par la texture de cette
 * partie, fondue dans la lumière et les couleurs de son entourage (aperçu pendant le glissement,
 * une étape d'historique au relâchement). En mode Destination, c'est l'inverse : la zone tracée
 * est recopiée là où on la dépose. La zone reste tracée pour recommencer ; Échap l'efface.
 */

interface Drag {
  tg: PixelTarget;
  start: Vec;
  off: Vec;
  work: HTMLCanvasElement;
  /** Fenêtre recalculée au dernier aperçu (à remettre d'origine au suivant). */
  last: { x: number; y: number; w: number; h: number } | null;
  raf: number;
}

function inside(p: Vec, poly: Vec[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Adoucit le bord du masque (deux passes de moyenne 3 × 3) pour cacher la couture. */
function soften(m: Uint8Array, w: number, h: number): void {
  const tmp = new Uint8Array(m.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0,
          n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            s += m[yy * w + xx];
            n++;
          }
        tmp[y * w + x] = s / n;
      }
    m.set(tmp);
  }
}

/** Recalcule le correctif pour le décalage courant, dans `work`. */
function compute(d: Drag, region: Vec[]): void {
  const { tg, work } = d;
  const W = work.width,
    H = work.height;
  const wc = work.getContext('2d')!;
  if (d.last) {
    const l = d.last;
    wc.clearRect(l.x, l.y, l.w, l.h);
    wc.drawImage(tg.base, l.x, l.y, l.w, l.h, l.x, l.y, l.w, l.h);
    d.last = null;
  }
  const pts = region.map((p) => toTarget(tg, p));
  const o0 = toTarget(tg, { x: 0, y: 0 }),
    o1 = toTarget(tg, d.off);
  const off = { x: Math.round(o1.x - o0.x), y: Math.round(o1.y - o0.y) };
  if (!off.x && !off.y) return;
  const source = pixelStore.get().patchMode === 'source';
  // Mode Source : la zone tracée est corrigée avec ce qui est sous la zone déplacée.
  const dest = source ? pts : pts.map((q) => ({ x: q.x + off.x, y: q.y + off.y }));
  const shift = source ? off : { x: -off.x, y: -off.y };
  let bx0 = Infinity,
    by0 = Infinity,
    bx1 = -Infinity,
    by1 = -Infinity;
  for (const q of dest) {
    bx0 = Math.min(bx0, q.x);
    by0 = Math.min(by0, q.y);
    bx1 = Math.max(bx1, q.x);
    by1 = Math.max(by1, q.y);
  }
  const m = Math.max(6, Math.max(bx1 - bx0, by1 - by0) * 0.4);
  const x0 = Math.max(0, Math.floor(bx0 - m)),
    y0 = Math.max(0, Math.floor(by0 - m));
  const x1 = Math.min(W, Math.ceil(bx1 + m)),
    y1 = Math.min(H, Math.ceil(by1 + m));
  const w = x1 - x0,
    h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const bctx = tg.base.getContext('2d', { willReadFrequently: true })!;
  const destPx = bctx.getImageData(x0, y0, w, h);
  // Hors de l'image, la source est transparente : elle ne compte pas.
  const srcPx = bctx.getImageData(x0 + shift.x, y0 + shift.y, w, h);
  const mc = makeCanvas(w, h);
  const mctx = mc.getContext('2d', { willReadFrequently: true })!;
  mctx.fillStyle = '#fff';
  mctx.beginPath();
  dest.forEach((q, i) => (i ? mctx.lineTo(q.x - x0, q.y - y0) : mctx.moveTo(q.x - x0, q.y - y0)));
  mctx.closePath();
  mctx.fill();
  const md = mctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = md[i * 4 + 3];
  soften(mask, w, h);
  const out = patchBlend(
    { data: destPx.data, width: w, height: h },
    { data: srcPx.data, width: w, height: h },
    mask,
  );
  wc.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, w, h), x0, y0);
  d.last = { x: x0, y: y0, w, h };
}

export function patchDelegate(c: CanvasController): ToolDelegate {
  let region: Vec[] | null = null;
  let lasso: Vec[] | null = null;
  let drag: Drag | null = null;
  let hoverInside = false;
  const active = () => ui.get().tool === 'patch' && ui.get().persona === 'photo';
  const setRegion = (r: Vec[] | null) => {
    region = r;
    pixelStore.set({ patchRegion: !!r });
    c.requestDraw();
  };
  const unsub = ui.subscribe(() => {
    if (!active() && (region || lasso || drag)) {
      if (drag) drag.tg.live(null);
      drag = null;
      lasso = null;
      setRegion(null);
    }
  });

  const render = () => {
    if (!drag || !region) return;
    drag.raf = 0;
    compute(drag, region);
    drag.tg.live(drag.work);
    c.requestDraw();
  };

  const outline = (ctx: CanvasRenderingContext2D, pts: Vec[], closed: boolean) => {
    if (pts.length < 2) return;
    const q = pts.map((p) => c.toScreen(p));
    ctx.beginPath();
    q.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
    if (closed) ctx.closePath();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -((Date.now() / 60) % 8);
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  };

  return {
    get busy() {
      return !!(lasso || drag);
    },
    pointerDown(e, p) {
      if (!active()) return false;
      if (ui.get().busy) return true;
      if (region && inside(p, region)) {
        const tg = pixelTarget(p);
        if (!tg) return true;
        drag = { tg, start: p, off: { x: 0, y: 0 }, work: copyDrawable(tg.base), last: null, raf: 0 };
        return true;
      }
      setRegion(null);
      lasso = [p];
      return true;
    },
    pointerMove(e, p) {
      if (lasso) {
        const last = lasso[lasso.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * ui.get().view.zoom > 2) lasso.push(p);
        c.requestDraw();
        return true;
      }
      if (drag) {
        drag.off = { x: p.x - drag.start.x, y: p.y - drag.start.y };
        if (!drag.raf) drag.raf = requestAnimationFrame(render);
        c.requestDraw();
        return true;
      }
      if (active()) hoverInside = !!region && inside(p, region);
      return false;
    },
    pointerUp() {
      if (lasso) {
        const pts = lasso;
        lasso = null;
        setRegion(pts.length > 2 ? pts : null);
        return true;
      }
      const d = drag;
      if (!d || !region) return false;
      drag = null;
      if (d.raf) cancelAnimationFrame(d.raf);
      if (Math.hypot(d.off.x, d.off.y) * ui.get().view.zoom < 2) {
        d.tg.live(null);
        return true;
      }
      compute(d, region);
      d.tg.commit(d.work, 'history.patch');
      c.requestDraw();
      return true;
    },
    cancel() {
      if (drag) {
        if (drag.raf) cancelAnimationFrame(drag.raf);
        drag.tg.live(null);
      }
      drag = null;
      lasso = null;
    },
    key(e) {
      if (!active() || e.key !== 'Escape' || !region) return false;
      setRegion(null);
      return true;
    },
    cursor(tool: ToolId) {
      return tool === 'patch' && (hoverInside || drag) ? 'move' : null;
    },
    draw(ctx) {
      if (!active()) return;
      ctx.save();
      ctx.lineWidth = 1;
      if (lasso) outline(ctx, lasso, false);
      if (region) {
        outline(ctx, region, true);
        if (drag) {
          const o = drag.off;
          outline(
            ctx,
            region.map((p) => ({ x: p.x + o.x, y: p.y + o.y })),
            true,
          );
        }
      }
      ctx.restore();
    },
    dispose() {
      unsub();
    },
  };
}
