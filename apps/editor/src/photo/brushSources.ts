import { luma, parseColor, type Pixels } from '@poulpe/core';
import type { Rect } from './photoHooks';
import { makeCanvas } from './pixels';

/*
 * Ce que dépose le pinceau de la Persona Photo (voir brushEngine.ts) : pixels d'origine transformés
 * à la demande, valeur peinte dans un masque, empreinte ronde.
 */

/** Pixels d'origine transformés à la demande, par tuiles (densité, flou, netteté au pinceau). */
export class LazySource {
  readonly canvas: HTMLCanvasElement;
  private done: Uint8Array;
  private cols: number;
  private static TILE = 256;
  constructor(
    private base: HTMLCanvasElement,
    private compute: (px: Pixels, x0: number, y0: number) => void,
    private margin: number,
  ) {
    this.canvas = makeCanvas(base.width, base.height);
    this.cols = Math.ceil(base.width / LazySource.TILE);
    this.done = new Uint8Array(this.cols * Math.ceil(base.height / LazySource.TILE));
  }

  ensure(r: Rect): void {
    const T = LazySource.TILE;
    const bctx = this.base.getContext('2d', { willReadFrequently: true })!;
    const sctx = this.canvas.getContext('2d')!;
    for (let ty = Math.floor(r.y0 / T); ty <= Math.floor((r.y1 - 1) / T); ty++)
      for (let tx = Math.floor(r.x0 / T); tx <= Math.floor((r.x1 - 1) / T); tx++) {
        const i = ty * this.cols + tx;
        if (tx < 0 || ty < 0 || tx >= this.cols || i >= this.done.length || this.done[i]) continue;
        this.done[i] = 1;
        const m = Math.ceil(this.margin);
        const x0 = Math.max(0, tx * T - m),
          y0 = Math.max(0, ty * T - m);
        const x1 = Math.min(this.base.width, (tx + 1) * T + m),
          y1 = Math.min(this.base.height, (ty + 1) * T + m);
        const img = bctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        this.compute({ data: img.data, width: img.width, height: img.height }, x0, y0);
        const ix = tx * T - x0,
          iy = ty * T - y0;
        sctx.putImageData(
          img,
          x0,
          y0,
          ix,
          iy,
          Math.min(T, this.base.width - tx * T),
          Math.min(T, this.base.height - ty * T),
        );
      }
  }
}

export function luminance(color: string): number {
  const c = parseColor(color);
  return luma(c.r, c.g, c.b) / 255;
}

/** Empreinte ronde du pinceau, au rayon donné, bord plus ou moins doux. */
export function makeStamp(radius: number, hardness: number, color: string): HTMLCanvasElement {
  const r = Math.max(0.5, radius);
  const size = Math.ceil(r * 2) + 2;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, r);
  const h = Math.min(0.99, Math.max(0, hardness / 100));
  const col = parseColor(color);
  const rgba = (a: number) => `rgba(${col.r},${col.g},${col.b},${a})`;
  g.addColorStop(0, rgba(1));
  g.addColorStop(h, rgba(1));
  // Bord doux : décroissance en douceur (courbe en cloche approchée).
  g.addColorStop(h + (1 - h) * 0.5, rgba(0.5));
  g.addColorStop(1, rgba(0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
