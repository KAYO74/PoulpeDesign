import { getController } from '../../components/Viewport';
import type { Rect, StrokeRedirect } from '../../photo/photoTools';
import { makeCanvas } from '../../photo/pixels';
import {
  getSelection,
  selectionForEdit,
  selectionVersion,
  setSelectionMask,
  type SelectionMask,
} from '../../photo/selection';
import { ui, type ToolId } from '../../store';
import { pixelStore } from './store';

/*
 * Masque rapide (Q), comme dans Affinity Photo : ce qui n'est pas sélectionné est couvert d'un
 * voile rouge, et le pinceau, la gomme et le dégradé modifient la sélection au lieu du calque
 * (blanc : sélectionné, noir : hors de la sélection ; la gomme retire de la sélection). Rien n'est
 * converti en le quittant : c'est la sélection elle-même qui a été peinte, on la retrouve telle quelle.
 */

export function quickMaskOn(): boolean {
  return pixelStore.get().quickMask && ui.get().persona === 'photo';
}

export function toggleQuickMask(): void {
  pixelStore.set((s) => ({ quickMask: !s.quickMask }));
  overlay = null;
  getController()?.requestDraw();
}

/** Voile rouge à la résolution de la sélection : opaque là où rien n'est sélectionné. */
let overlay: { version: number; canvas: HTMLCanvasElement; x: number; y: number; scale: number } | null =
  null;
/** Un coup de pinceau peint la sélection : le voile suit le geste, pas la sélection enregistrée. */
let painting = false;

function paintOverlay(target: HTMLCanvasElement, mask: HTMLCanvasElement, r?: Rect) {
  const x = Math.max(0, Math.floor(r?.x0 ?? 0)),
    y = Math.max(0, Math.floor(r?.y0 ?? 0));
  const w = Math.min(target.width, Math.ceil(r?.x1 ?? target.width)) - x,
    h = Math.min(target.height, Math.ceil(r?.y1 ?? target.height)) - y;
  if (w <= 0 || h <= 0) return;
  const ctx = target.getContext('2d')!;
  ctx.save();
  ctx.clearRect(x, y, w, h);
  ctx.fillStyle = '#ff2a3c';
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, x, y, w, h, x, y, w, h);
  ctx.restore();
}

function buildOverlay(m: SelectionMask): void {
  const canvas = makeCanvas(m.canvas.width, m.canvas.height);
  paintOverlay(canvas, m.canvas);
  overlay = { version: selectionVersion(), canvas, x: m.x, y: m.y, scale: m.scale };
}

function currentOverlay() {
  if (!painting && (!overlay || overlay.version !== selectionVersion())) {
    const m = getSelection() ?? selectionForEdit();
    if (!m) return null;
    buildOverlay(m);
  }
  return overlay;
}

/** Cible des coups de pinceau et de gomme pendant le masque rapide : la sélection. */
export function quickMaskRedirect(tool: ToolId): StrokeRedirect | null {
  if (!quickMaskOn() || (tool !== 'brush' && tool !== 'eraser')) return null;
  return selectionTarget();
}

/** La sélection comme toile à peindre (opacité = sélectionné), avec son aperçu et son enregistrement. */
export function selectionTarget(): StrokeRedirect | null {
  const m = selectionForEdit();
  if (!m) return null;
  if (!overlay || overlay.x !== m.x || overlay.y !== m.y || overlay.canvas.width !== m.canvas.width)
    buildOverlay(m);
  return {
    base: m.canvas,
    toPx: new DOMMatrix().scale(m.scale).translate(-m.x, -m.y),
    live: (canvas, dirty) => {
      painting = !!canvas;
      if (canvas && overlay) paintOverlay(overlay.canvas, canvas, dirty);
      getController()?.requestDraw();
    },
    commit: (canvas) => setSelectionMask({ ...m, canvas }, 'history.quickMask'),
  };
}

/** Le voile rouge, par-dessus le document (en pixels d'écran). */
export function drawQuickMask(ctx: CanvasRenderingContext2D): void {
  if (!quickMaskOn()) return;
  const o = currentOverlay();
  if (!o) return;
  const { zoom, panX, panY } = ui.get().view;
  const dpr = ctx.getTransform().a;
  const k = (dpr * zoom) / o.scale;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, dpr * (panX + o.x * zoom), dpr * (panY + o.y * zoom));
  ctx.globalAlpha = 0.5;
  ctx.drawImage(o.canvas, 0, 0);
  ctx.restore();
}
