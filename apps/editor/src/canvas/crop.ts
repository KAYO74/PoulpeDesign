import {
  findNode,
  localToWorld,
  worldToLocal,
  type Box,
  type ImageNode,
  type PoulpeDocument,
  type Vec,
} from '@poulpe/core';
import { editor } from '../store';
import type { CanvasController } from './controller';
import type { Gesture } from './gestures';
import { HANDLES } from './handles';

/*
 * Recadrage d'une image sur le canevas (double-clic sur l'image) : les poignées changent le cadre,
 * un glissement dedans déplace l'image, et la partie masquée se voit en transparence.
 */

export function dragCropResize(g: Extract<Gesture, { kind: 'cropResize' }>, p: Vec) {
  const o = g.node;
  const full = g.full;
  const [hx, hy] = HANDLES[g.handle];
  const l = worldToLocal(o, p);
  let x0 = 0,
    y0 = 0,
    x1 = o.width,
    y1 = o.height;
  const clampX = (v: number) => Math.min(full.x + full.width, Math.max(full.x, v));
  const clampY = (v: number) => Math.min(full.y + full.height, Math.max(full.y, v));
  if (hx === 0) x0 = Math.min(clampX(l.x), x1 - 1);
  if (hx === 1) x1 = Math.max(clampX(l.x), x0 + 1);
  if (hy === 0) y0 = Math.min(clampY(l.y), y1 - 1);
  if (hy === 1) y1 = Math.max(clampY(l.y), y0 + 1);
  const c = localToWorld(o, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  editor.preview((d) => {
    const n = findNode(d, o.id)!.node;
    if (n.type !== 'image') return;
    n.width = x1 - x0;
    n.height = y1 - y0;
    n.x = c.x - n.width / 2;
    n.y = c.y - n.height / 2;
    n.crop = {
      x: (x0 - full.x) / full.width,
      y: (y0 - full.y) / full.height,
      width: (x1 - x0) / full.width,
      height: (y1 - y0) / full.height,
    };
  });
}

export function dragCropPan(ctl: CanvasController, g: Extract<Gesture, { kind: 'cropPan' }>, p: Vec) {
  const o = g.node;
  const a = worldToLocal(o, g.start);
  const b = worldToLocal(o, p);
  if (!g.moved && Math.hypot(b.x - a.x, b.y - a.y) * ctl.view.zoom < 2) return;
  g.moved = true;
  const full = g.full;
  // Le cadre reste à l'intérieur de l'image.
  const fx = Math.min(0, Math.max(o.width - full.width, full.x + b.x - a.x));
  const fy = Math.min(0, Math.max(o.height - full.height, full.y + b.y - a.y));
  editor.preview((d) => {
    const n = findNode(d, o.id)!.node;
    if (n.type !== 'image') return;
    n.crop = {
      x: -fx / full.width,
      y: -fy / full.height,
      width: o.width / full.width,
      height: o.height / full.height,
    };
  });
}

/** Partie masquée de l'image recadrée, en transparence autour du cadre. */
export function drawCropGhost(ctl: CanvasController, doc: PoulpeDocument, n: ImageNode) {
  const img = ctl.images.get(doc, n.assetId);
  const full = cropFull(n);
  const ctx = ctl.ctx;
  const v = ctl.view;
  ctx.save();
  ctx.translate(v.panX, v.panY);
  ctx.scale(v.zoom, v.zoom);
  ctx.translate(n.x + n.width / 2, n.y + n.height / 2);
  ctx.rotate((n.rotation * Math.PI) / 180);
  ctx.translate(-n.width / 2, -n.height / 2);
  ctx.beginPath();
  ctx.rect(full.x, full.y, full.width, full.height);
  ctx.rect(0, 0, n.width, n.height);
  ctx.save();
  ctx.clip('evenodd');
  ctx.globalAlpha = 0.4;
  if (img) ctx.drawImage(img, full.x, full.y, full.width, full.height);
  ctx.restore();
  ctx.setLineDash([4 / v.zoom, 3 / v.zoom]);
  ctx.lineWidth = 1 / v.zoom;
  ctx.strokeStyle = ctl.colors.sel;
  ctx.strokeRect(full.x, full.y, full.width, full.height);
  ctx.restore();
}

/** Image entière dans le repère local d'une image recadrée. */
export function cropFull(n: ImageNode): Box {
  const c = n.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = n.width / c.width,
    height = n.height / c.height;
  return { x: -c.x * width, y: -c.y * height, width, height };
}
