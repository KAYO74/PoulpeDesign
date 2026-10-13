import type { BlendMode } from '@poulpe/core';

/*
 * Outils de toile partagés par les modules du rendu : contexte de dessin, toiles de travail
 * (calques des effets, motifs des dégradés, composition des réglages) et modes de fusion.
 *
 * `AnyCanvas`, `AnyCtx` et `makeCanvas` sont internes au paquet : index.ts ne les réexporte pas.
 */

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function compositeOp(mode: BlendMode): GlobalCompositeOperation {
  return mode === 'normal' ? 'source-over' : mode;
}

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): { canvas: AnyCanvas; ctx: AnyCtx } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d')! };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}
