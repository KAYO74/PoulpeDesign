import { liquifyDab, similarDab } from '@poulpe/core';
import { ui } from '../store';
import type { BrushEngine } from './brushEngine';
import { makeCanvas } from './pixels';

/*
 * Touches particulières du pinceau de la Persona Photo (voir BrushEngine.dab) : le doigt et la
 * fluidité déplacent les pixels du calque eux-mêmes (WARP_TOOLS) ; la gomme d'arrière-plan et le
 * remplacement de couleur ne couvrent que les pixels proches de la couleur prélevée.
 */

/** Doigt : la couleur emportée est déposée, puis se mélange à ce qui est sous le pinceau. */
export function dabSmudge(brush: BrushEngine, x: number, y: number) {
  const s = brush.stroke!;
  const r = (s.settings.size / 2) * s.pxScale;
  const k = r / ((s.stamp.width - 2) / 2);
  const size = Math.max(2, Math.ceil(s.stamp.width * k));
  const ox = Math.round(x - size / 2),
    oy = Math.round(y - size / 2);
  const wc = s.work.getContext('2d')!;
  if (!s.pickup) {
    s.pickup = makeCanvas(size, size);
    s.pickup.getContext('2d')!.drawImage(s.work, ox, oy, size, size, 0, 0, size, size);
    return;
  }
  const strength = Math.max(0, Math.min(1, s.settings.opacity / 100));
  // Empreinte : la couleur emportée, découpée par le pinceau (et par la sélection).
  const t1 = brush.scratch(size, size, 1);
  const tc = t1.getContext('2d')!;
  tc.save();
  tc.globalCompositeOperation = 'copy';
  tc.drawImage(s.pickup, 0, 0);
  tc.globalCompositeOperation = 'destination-in';
  tc.drawImage(s.stamp, 0, 0, s.stamp.width, s.stamp.height, 0, 0, size, size);
  if (s.sel) tc.drawImage(s.sel, ox, oy, size, size, 0, 0, size, size);
  tc.restore();
  wc.save();
  wc.globalAlpha = strength;
  wc.globalCompositeOperation = 'source-atop';
  wc.drawImage(t1, 0, 0, size, size, ox, oy, size, size);
  wc.restore();
  // Le pinceau reprend un peu de la couleur qu'il traverse.
  const pc = s.pickup.getContext('2d')!;
  pc.globalAlpha = 1 - strength;
  pc.drawImage(s.work, ox, oy, size, size, 0, 0, size, size);
  pc.globalAlpha = 1;
  brush.dirty = { x0: ox, y0: oy, x1: ox + size, y1: oy + size };
}

/** Fluidité : déplace les pixels sous le pinceau. */
export function dabLiquify(brush: BrushEngine, x: number, y: number) {
  const s = brush.stroke!;
  const r = (s.settings.size / 2) * s.pxScale;
  const prev = s.prevDab ?? s.last;
  const dx = x - prev.x,
    dy = y - prev.y;
  s.prevDab = { x, y };
  const mode = ui.get().liquifyMode;
  if (mode === 'push' && Math.hypot(dx, dy) < 0.01) return;
  const strength = Math.max(0.02, s.settings.opacity / 100);
  const m = Math.ceil(r + Math.hypot(dx, dy) + 2);
  const x0 = Math.max(0, Math.floor(x - m)),
    y0 = Math.max(0, Math.floor(y - m));
  const x1 = Math.min(s.work.width, Math.ceil(x + m)),
    y1 = Math.min(s.work.height, Math.ceil(y + m));
  if (x1 <= x0 || y1 <= y0) return;
  const wc = s.work.getContext('2d', { willReadFrequently: true })!;
  const img = wc.getImageData(x0, y0, x1 - x0, y1 - y0);
  const alt = brush.altDown;
  const effective = alt && mode === 'bloat' ? 'pinch' : alt && mode === 'pinch' ? 'bloat' : mode;
  liquifyDab(
    { data: img.data, width: img.width, height: img.height },
    x - x0,
    y - y0,
    r,
    effective,
    mode === 'twirl' && alt ? -strength : strength,
    dx,
    dy,
  );
  wc.putImageData(img, x0, y0);
  brush.dirty = { x0, y0, x1, y1 };
}

/** Gomme d'arrière-plan, remplacement de couleur : la touche ne couvre que les pixels proches de la couleur prélevée. */
export function dabSimilar(brush: BrushEngine, x: number, y: number, pressure: number) {
  const s = brush.stroke!;
  const sim = s.similar!;
  const r = (s.settings.size / 2) * s.pxScale * Math.max(0.05, pressure);
  const x0 = Math.max(0, Math.floor(x - r)),
    y0 = Math.max(0, Math.floor(y - r));
  const x1 = Math.min(s.ref.width, Math.ceil(x + r)),
    y1 = Math.min(s.ref.height, Math.ceil(y + r));
  if (x1 <= x0 || y1 <= y0) return;
  const w = x1 - x0,
    h = y1 - y0;
  const img = s.ref.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h);
  const d = img.data;
  if (!s.sample || sim.continuous) {
    // Couleur sous le centre du pinceau (moyenne de 3 × 3 pixels, moins sensible au bruit).
    let n = 0;
    const acc = [0, 0, 0, 0];
    for (let yy = Math.floor(y) - 1; yy <= Math.floor(y) + 1; yy++)
      for (let xx = Math.floor(x) - 1; xx <= Math.floor(x) + 1; xx++) {
        if (xx < x0 || yy < y0 || xx >= x1 || yy >= y1) continue;
        const p = ((yy - y0) * w + (xx - x0)) * 4;
        for (let c = 0; c < 4; c++) acc[c] += d[p + c];
        n++;
      }
    if (n) s.sample = { r: acc[0] / n, g: acc[1] / n, b: acc[2] / n, a: acc[3] / n };
  }
  if (!s.sample) return;
  const cov = similarDab(
    { data: d, width: w, height: h },
    x - x0,
    y - y0,
    r,
    s.settings.hardness,
    s.sample,
    sim.tolerance,
    sim.contiguous,
  );
  const out = new ImageData(w, h);
  for (let i = 0; i < cov.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
    out.data[i * 4 + 3] = cov[i];
  }
  const t1 = brush.scratch(w, h, 1);
  t1.getContext('2d')!.putImageData(out, 0, 0);
  const ctx = s.buf.getContext('2d')!;
  ctx.globalAlpha = Math.max(0.01, s.settings.flow / 100);
  ctx.drawImage(t1, 0, 0, w, h, x0, y0, w, h);
  const dd = brush.dirty;
  brush.dirty = dd
    ? { x0: Math.min(dd.x0, x0), y0: Math.min(dd.y0, y0), x1: Math.max(dd.x1, x1), y1: Math.max(dd.y1, y1) }
    : { x0, y0, x1, y1 };
}
