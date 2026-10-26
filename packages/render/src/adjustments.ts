import {
  activeFilters,
  applyAdjustment,
  blendRangeAlpha,
  hasBlendRanges,
  nodeBounds,
  type AdjustmentNode,
  type Box,
  type PoulpeDocument,
  type SceneNode,
} from '@poulpe/core';
import { compositeOp, makeCanvas, type AnyCanvas, type AnyCtx } from './canvas';
import type { RenderOptions } from './draw';
import { applyNodeTransform } from './geometry';

/*
 * Calques de réglage : application d'un réglage à la toile où ses calques frères sont composés
 * (voir `drawChildren`, dans draw.ts).
 *
 * Filtres en direct d'un calque : les mêmes calculs, sur la toile où le calque seul est rendu.
 *
 * Plages de fusion : le calque rendu s'efface selon sa luminosité et celle de ce qui est dessous.
 *
 * Ces fonctions sont internes au paquet : index.ts ne les réexporte pas.
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

/**
 * Applique les filtres en direct d'un calque à la toile où il vient d'être rendu. `m` : matrice
 * du document vers l'écran ; (x0, y0) : coin de la toile dans l'écran.
 */
export function applyLiveFilters(
  layer: { canvas: AnyCanvas; ctx: AnyCtx },
  node: SceneNode,
  scale: number,
  m: DOMMatrix,
  x0: number,
  y0: number,
): void {
  const filters = activeFilters(node);
  if (!filters.length) return;
  const { width: w, height: h } = layer.canvas;
  const img = layer.ctx.getImageData(0, 0, w, h);
  const px = { data: img.data, width: w, height: h };
  // Repère de la vignette : la boîte du calque, en pixels de la toile.
  const b = nodeBounds(node);
  const corners = [
    [b.x, b.y],
    [b.x + b.width, b.y + b.height],
  ].map(([x, y]) => [m.a * x + m.c * y + m.e - x0, m.b * x + m.d * y + m.f - y0]);
  const frame = {
    x: Math.min(corners[0][0], corners[1][0]),
    y: Math.min(corners[0][1], corners[1][1]),
    width: Math.abs(corners[1][0] - corners[0][0]),
    height: Math.abs(corners[1][1] - corners[0][1]),
  };
  const origin = { x: m.e - x0, y: m.f - y0 };
  for (const f of filters) applyAdjustment(px, f.adjustment, { scale, origin, frame });
  layer.ctx.putImageData(img, 0, 0);
}

/**
 * Plages de fusion : efface la toile du calque (posée en (x0, y0) sur `ctx`) selon sa luminosité
 * et celle de ce qui est déjà dessiné dessous sur `ctx`.
 */
export function applyBlendRanges(
  layer: { canvas: AnyCanvas; ctx: AnyCtx },
  ctx: AnyCtx,
  node: SceneNode,
  x0: number,
  y0: number,
): void {
  const r = node.blendRanges;
  if (!r || !hasBlendRanges(node)) return;
  const { width: w, height: h } = layer.canvas;
  const img = layer.ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let under: Uint8ClampedArray | null = null;
  try {
    under = ctx.getImageData(x0, y0, w, h).data;
  } catch {
    // Toile illisible (image d'une autre origine) : seule la plage du calque compte.
  }
  // Tables : part gardée pour chaque luminosité, du calque et du dessous.
  const top = new Float32Array(256),
    below = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    top[v] = blendRangeAlpha(r.layer, v);
    below[v] = blendRangeAlpha(r.under, v);
  }
  const luma = (a: Uint8ClampedArray, i: number) =>
    Math.round(0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]);
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const k = top[luma(d, i)] * (under ? below[luma(under, i)] : 1);
    if (k < 1) d[i + 3] = d[i + 3] * k;
  }
  layer.ctx.putImageData(img, 0, 0);
}
