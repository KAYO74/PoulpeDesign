import { openCanvasMenu } from '../components/CanvasMenu';
import { editor, ui } from '../store';
import type { CanvasController } from './controller';
import { beginTextEdit } from './textEdit';

/*
 * Autres entrées du canevas : clic droit (menu du canevas), double-clic, molette (défilement et
 * zoom) et barre d'espace (main temporaire). Le reste du pointeur est dans pointer.ts.
 */

/** Clic droit relâché sans glisser : sélectionne l'objet visé, puis ouvre le menu du canevas. */
export function rightUp(ctl: CanvasController, e: PointerEvent): void {
  const start = ctl.rightDown;
  ctl.rightDown = null;
  if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
  if (ctl.busy()) return;
  const r = ctl.canvas.getBoundingClientRect();
  const tool = ctl.effectiveTool();
  // Outil Nœud : clic droit sur un nœud, menu des nœuds (comme dans Affinity).
  if (tool === 'direct' && ctl.paths.nodeMenuAt({ x: e.clientX - r.left, y: e.clientY - r.top })) {
    ctl.requestDraw();
    openCanvasMenu(e.clientX, e.clientY, 'nodes');
    return;
  }
  if (ui.get().persona !== 'photo') {
    const hit = ctl.hitTest(ctl.toWorld(e.clientX - r.left, e.clientY - r.top), tool === 'direct');
    if (hit && !editor.selection.includes(hit.id)) editor.select([hit.id]);
  }
  openCanvasMenu(e.clientX, e.clientY);
}

/** Le clic droit ouvre le menu de l'appli (au relâchement), jamais celui du navigateur. */
export function onContextMenu(e: MouseEvent) {
  e.preventDefault();
}

export function onDoubleClick(ctl: CanvasController, e: MouseEvent) {
  // Main ou Zoom maintenus : deux clics de zoom ne ferment pas un tracé en cours.
  if (ctl.heldView || ctl.spaceDown) return;
  const tool = ui.get().tool;
  const rect = ctl.canvas.getBoundingClientRect();
  const p = ctl.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  const s = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  for (const m of ctl.modules) {
    if (m.doubleClick?.(e, p, s)) {
      ctl.requestDraw();
      return;
    }
  }
  if (tool !== 'select' && tool !== 'direct') return;
  if (ctl.paths.doubleClick(p, { x: e.clientX - rect.left, y: e.clientY - rect.top })) return;
  const hit = ctl.hitTest(p, true);
  if (!hit) return;
  if (hit.type === 'text') {
    editor.select([hit.id]);
    beginTextEdit(hit.id, false);
    return;
  }
  if (hit.type === 'image') {
    editor.select([hit.id]);
    ui.set({ cropId: hit.id });
    return;
  }
  // Double-clic dans un groupe : sélectionne l'objet à l'intérieur.
  editor.select([hit.id]);
}

export function onWheel(ctl: CanvasController, e: WheelEvent) {
  e.preventDefault();
  const rect = ctl.canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left,
    sy = e.clientY - rect.top;
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
    ctl.zoomAt(ctl.view.zoom * factor, sx, sy);
    return;
  }
  const v = ctl.view;
  const k = e.deltaMode === 1 ? 16 : 1;
  const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
  const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
  ui.set({ view: { ...v, panX: v.panX - dx * k, panY: v.panY - dy * k } });
}

export function onKey(ctl: CanvasController, e: KeyboardEvent) {
  if (e.code !== 'Space') return;
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const down = e.type === 'keydown';
  if (down) e.preventDefault();
  if (ctl.spaceDown !== down) {
    ctl.spaceDown = down;
    ctl.updateCursor();
  }
}
