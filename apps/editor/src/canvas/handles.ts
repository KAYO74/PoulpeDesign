import { findNode, localToWorld, type Box, type Vec } from '@poulpe/core';
import { editor } from '../store';
import type { CanvasController } from './controller';
import { isFrameText } from './textFrames';

/*
 * Cadre de transformation de la sélection sur le canevas : poignées de redimensionnement et de
 * rotation, leur détection sous le pointeur, leur curseur et leur dessin.
 */

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Record<HandleId, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};
const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 22;

/** Boîte de transformation : celle de l'objet s'il est seul (tourné), sinon la boîte englobante. */
export interface Frame extends Box {
  rotation: number;
}

function handlePoints(f: Frame): { id: HandleId; p: Vec }[] {
  return (Object.keys(HANDLES) as HandleId[]).map((id) => {
    const [hx, hy] = HANDLES[id];
    return { id, p: localToWorld(f, { x: hx * f.width, y: hy * f.height }) };
  });
}

function rotateHandle(ctl: CanvasController, f: Frame): Vec {
  const z = ctl.view.zoom;
  return localToWorld(f, { x: f.width / 2, y: -ROTATE_OFFSET / z });
}

/** Poignée de redimensionnement ou de rotation de la sélection sous le point écran. */
export function hitHandle(ctl: CanvasController, sx: number, sy: number): HandleId | 'rotate' | null {
  // Outil Nœud sur un tracé : pas de poignées de transformation, on modifie les nœuds.
  if (ctl.paths.editablePath()) return null;
  const f = ctl.selectionFrame();
  if (!f || anySelectedLocked()) return null;
  const rp = ctl.toScreen(rotateHandle(ctl, f));
  if (!ctl.cropNode() && Math.hypot(rp.x - sx, rp.y - sy) <= HANDLE_SIZE) return 'rotate';
  const sel = editor.selection;
  const single = sel.length === 1 ? findNode(editor.doc, sel[0])?.node : null;
  for (const { id, p } of handlePoints(f)) {
    // La hauteur d'un texte suit son contenu : pas de poignées haut et bas (sauf un cadre de texte).
    if (single?.type === 'text' && !isFrameText(editor.doc, single) && (id === 'n' || id === 's')) continue;
    const s = ctl.toScreen(p);
    if (Math.abs(s.x - sx) <= HANDLE_SIZE && Math.abs(s.y - sy) <= HANDLE_SIZE) return id;
  }
  return null;
}

function anySelectedLocked(): boolean {
  const doc = editor.doc;
  return editor.selection.some((id) => findNode(doc, id)?.node.locked);
}

export function drawHandles(ctl: CanvasController) {
  if (ctl.paths.editablePath()) return;
  const f = ctl.selectionFrame();
  if (!f) return;
  const ctx = ctl.ctx;
  const corners = [
    { x: 0, y: 0 },
    { x: f.width, y: 0 },
    { x: f.width, y: f.height },
    { x: 0, y: f.height },
  ].map((c) => ctl.toScreen(localToWorld(f, c)));
  ctx.save();
  ctx.strokeStyle = ctl.colors.sel;
  ctx.lineWidth = 1;
  ctx.beginPath();
  corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
  ctx.closePath();
  ctx.stroke();
  if (anySelectedLocked()) {
    ctx.restore();
    return;
  }
  ctx.fillStyle = '#ffffff';
  if (!ctl.cropNode()) {
    const top = ctl.toScreen(localToWorld(f, { x: f.width / 2, y: 0 }));
    const rot = ctl.toScreen(rotateHandle(ctl, f));
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rot.x, rot.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rot.x, rot.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const s = HANDLE_SIZE;
  for (const { p } of handlePoints(f)) {
    const q = ctl.toScreen(p);
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate((f.rotation * Math.PI) / 180);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeRect(-s / 2 + 0.5, -s / 2 + 0.5, s - 1, s - 1);
    ctx.restore();
  }
  ctx.restore();
}

export function handleCursor(h: HandleId, rotation: number): string {
  const base: Record<HandleId, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const a = (((base[h] + rotation) % 180) + 180) % 180;
  const names = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  return names[Math.round(a / 45) % 4];
}
