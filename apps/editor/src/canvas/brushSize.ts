import { brushSettings, isBrushTool, setBrush, ui } from '../store';
import { pathsState } from '../tools/paths/state';
import type { CanvasController } from './controller';

/**
 * Le geste « taille du pinceau » de Photoshop : Alt + clic droit glissé. (Ctrl + Alt + glissé, celui
 * d'Affinity, est géré par les pinceaux eux-mêmes.)
 */
export function isBrushSizeGesture(e: PointerEvent): boolean {
  return e.altKey && e.button === 2;
}

/**
 * Pendant l'utilisation d'un pinceau, glisser vers la droite grossit le pinceau, vers la gauche
 * l'affine ; le cercle du pinceau suit à l'écran. Rend `false` si l'outil n'est pas un pinceau.
 */
export function startBrushSizeDrag(ctl: CanvasController, e: PointerEvent): boolean {
  const tool = ui.get().tool;
  const photo = ui.get().persona === 'photo' && isBrushTool(tool);
  if (!photo && tool !== 'vectorBrush') return false;
  e.preventDefault();
  ctl.canvas.setPointerCapture(e.pointerId);
  const x0 = e.clientX;
  const start = photo ? brushSettings(tool).size : pathsState.get().brushWidth;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    if (photo) setBrush({ size: Math.round(Math.max(1, Math.min(2000, start + dx))) }, tool);
    else pathsState.set({ brushWidth: Math.round(Math.max(0.5, Math.min(500, start + dx / 4)) * 10) / 10 });
    ctl.requestDraw();
  };
  const up = () => {
    ctl.canvas.removeEventListener('pointermove', move);
    ctl.canvas.removeEventListener('pointerup', up);
    ctl.canvas.removeEventListener('pointercancel', up);
  };
  ctl.canvas.addEventListener('pointermove', move);
  ctl.canvas.addEventListener('pointerup', up);
  ctl.canvas.addEventListener('pointercancel', up);
  return true;
}
