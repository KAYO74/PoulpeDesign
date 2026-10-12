import { applyAdjustment, type AdjustmentNode, type Box, type PoulpeDocument } from '@poulpe/core';
import { compositeOp, makeCanvas, type AnyCanvas, type AnyCtx } from './canvas';
import type { RenderOptions } from './draw';
import { applyNodeTransform } from './geometry';

/*
 * Calques de réglage : application d'un réglage à la toile où ses calques frères sont composés
 * (voir `drawChildren`, dans draw.ts).
 *
 * `applyAdjustmentLayer` est interne au paquet : index.ts ne la réexporte pas.
 */

/** Applique un calque de réglage à la toile de composition, selon son opacité et son masque. */
export function applyAdjustmentLayer(
  buf: { canvas: AnyCanvas; ctx: AnyCtx },
  doc: PoulpeDocument,
  node: AdjustmentNode,
  opts: RenderOptions,
  scale: number,
  origin: { x: number; y: number },
  frame: Box,
): void {
  const { width: w, height: h } = buf.canvas;
  const src = buf.ctx.getImageData(0, 0, w, h);
  let adjusted = new Uint8ClampedArray(src.data);
  applyAdjustment({ data: adjusted, width: w, height: h }, node.adjustment, { scale, origin, frame });
  if (node.blendMode !== 'normal') {
    // Mode de fusion : l'image réglée est fondue sur l'image d'origine, comme un calque.
    const top = makeCanvas(w, h);
    top.ctx.putImageData(new ImageData(adjusted, w, h), 0, 0);
    const mixed = makeCanvas(w, h);
    mixed.ctx.putImageData(src, 0, 0);
    mixed.ctx.globalCompositeOperation = compositeOp(node.blendMode);
    mixed.ctx.drawImage(top.canvas, 0, 0);
    adjusted = mixed.ctx.getImageData(0, 0, w, h).data;
  }
  const out = src.data;
  const op = Math.max(0, Math.min(1, node.opacity));
  const maskImg = node.mask?.enabled ? opts.images.get(doc, node.mask.assetId) : null;
  let maskData: Uint8ClampedArray | null = null;
  if (maskImg) {
    const mc = makeCanvas(w, h);
    mc.ctx.setTransform(buf.ctx.getTransform());
    applyNodeTransform(mc.ctx, node);
    mc.ctx.drawImage(maskImg, 0, 0, node.width, node.height);
    maskData = mc.ctx.getImageData(0, 0, w, h).data;
  }
  for (let i = 0; i < out.length; i += 4) {
    const k = maskData ? (op * maskData[i + 3]) / 255 : op;
    if (k <= 0) continue;
    out[i] += (adjusted[i] - out[i]) * k;
    out[i + 1] += (adjusted[i + 1] - out[i + 1]) * k;
    out[i + 2] += (adjusted[i + 2] - out[i + 2]) * k;
  }
  buf.ctx.putImageData(src, 0, 0);
}
