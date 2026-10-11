import { fixRedEye, floodMask, removeBlemish, type Vec } from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { t } from '../../i18n';
import { brushSettings, toast, ui } from '../../store';
import type { ToolDelegate } from '../types';
import { pixelStore } from './store';
import { limitToSelection, pixelTarget, toTarget, type PixelTarget } from './target';

/*
 * Outils d'un clic de la Persona Photo : gomme de zone (efface la zone de couleur proche, comme
 * baguette magique + Suppr), retouche des imperfections (un petit défaut remplacé par la texture
 * voisine) et yeux rouges (cliquer sur l'œil, ou tracer un cadre autour). Une étape d'historique
 * par clic, limitée à la sélection de pixels.
 */

/** Gomme de zone : efface les pixels semblables à celui cliqué. */
function floodErase(p: Vec) {
  const tg = pixelTarget(p);
  if (!tg) return;
  const W = tg.base.width,
    H = tg.base.height;
  const q = toTarget(tg, p);
  if (q.x < 0 || q.y < 0 || q.x >= W || q.y >= H) return;
  const ctx = tg.base.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, W, H);
  const s = pixelStore.get();
  const mask = floodMask(
    { data: img.data, width: W, height: H },
    q.x,
    q.y,
    s.floodTolerance,
    s.floodContiguous,
  );
  const sd = tg.sel?.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const d = img.data;
  let changed = false;
  for (let i = 0; i < mask.length; i++) {
    const k = (mask[i] / 255) * (sd ? sd[i * 4 + 3] / 255 : 1);
    if (k <= 0 || !d[i * 4 + 3]) continue;
    d[i * 4 + 3] *= 1 - k;
    changed = true;
  }
  if (!changed) return;
  ctx.putImageData(img, 0, 0);
  tg.commit(tg.base, 'history.floodEraser');
}

/** Applique `fix` à une fenêtre des pixels de la cible ; renvoie false si rien n'a changé. */
function retouchWindow(
  tg: PixelTarget,
  cx: number,
  cy: number,
  reach: number,
  fix: (px: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) => boolean,
): boolean {
  const W = tg.base.width,
    H = tg.base.height;
  const x0 = Math.max(0, Math.floor(cx - reach)),
    y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach)),
    y1 = Math.min(H, Math.ceil(cy + reach));
  if (x1 <= x0 || y1 <= y0) return false;
  const w = x1 - x0,
    h = y1 - y0;
  const ctx = tg.base.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(x0, y0, w, h);
  const before = new Uint8ClampedArray(img.data);
  if (!fix({ data: img.data, width: w, height: h }, cx - x0, cy - y0)) return false;
  limitToSelection(tg, before, img.data, x0, y0, w, h);
  let changed = false;
  for (let i = 0; i < before.length && !changed; i++) if (before[i] !== img.data[i]) changed = true;
  if (!changed) return false;
  ctx.putImageData(img, x0, y0);
  return true;
}

function blemish(p: Vec) {
  const tg = pixelTarget(p);
  if (!tg) return;
  const q = toTarget(tg, p);
  const r = Math.max(1, (brushSettings('blemish').size / 2) * tg.pxScale);
  const found = { source: true };
  const done = retouchWindow(tg, q.x, q.y, r * 5.4, (px, x, y) => {
    found.source = removeBlemish(px, x, y, r);
    return found.source;
  });
  if (done) tg.commit(tg.base, 'history.blemish');
  else if (!found.source) toast(t('pixel.blemishEdge'));
}

/** Yeux rouges : `a` à `b` est le cadre tracé autour de l'œil (ou un simple clic en `a`). */
function redEye(a: Vec, b: Vec) {
  const z = ui.get().view.zoom;
  const click = Math.hypot(b.x - a.x, b.y - a.y) * z < 4;
  const r = brushSettings('redEye').size / 2;
  const center = click ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const rx = click ? r : Math.abs(b.x - a.x) / 2,
    ry = click ? r : Math.abs(b.y - a.y) / 2;
  const tg = pixelTarget(center);
  if (!tg) return;
  const q = toTarget(tg, center);
  const k = tg.pxScale;
  const darken = pixelStore.get().redEyeDarken / 100;
  const done = retouchWindow(tg, q.x, q.y, Math.max(rx, ry) * k + 2, (px, x, y) => {
    fixRedEye(px, x, y, rx * k, ry * k, darken);
    return true;
  });
  if (done) tg.commit(tg.base, 'history.redEye');
  else toast(t('pixel.noRedEye'));
}

export function retouchDelegate(c: CanvasController): ToolDelegate {
  let eye: { start: Vec; cur: Vec } | null = null;
  const tool = () => (ui.get().persona === 'photo' ? ui.get().tool : null);
  return {
    get busy() {
      return !!eye;
    },
    pointerDown(e, p) {
      const tl = tool();
      if (tl !== 'floodEraser' && tl !== 'blemish' && tl !== 'redEye') return false;
      if (ui.get().busy) return true;
      if (tl === 'floodEraser') floodErase(p);
      else if (tl === 'blemish') blemish(p);
      else eye = { start: p, cur: p };
      return true;
    },
    pointerMove(e, p) {
      if (!eye) return false;
      eye.cur = p;
      c.requestDraw();
      return true;
    },
    pointerUp() {
      const g = eye;
      if (!g) return false;
      eye = null;
      redEye(g.start, g.cur);
      return true;
    },
    cancel() {
      eye = null;
    },
    draw(ctx) {
      if (!eye) return;
      const a = c.toScreen(eye.start),
        b = c.toScreen(eye.cur);
      ctx.save();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        Math.abs(b.x - a.x) / 2,
        Math.abs(b.y - a.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#000000';
      ctx.stroke();
      ctx.restore();
    },
  };
}
