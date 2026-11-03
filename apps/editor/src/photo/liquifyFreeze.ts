import { makeCanvas } from './pixels';

/*
 * Masque de gel de la fluidité (comme dans Photoshop) : les zones peintes en mode « Geler » ne
 * bougent plus sous le pinceau de fluidité. Un masque par calque, gardé tant que l'appli est
 * ouverte (il n'est pas enregistré dans le document), montré en rouge quand l'outil est actif.
 */

export interface FreezeMask {
  width: number;
  height: number;
  /** Un octet par pixel du calque : 255 = gelé. */
  data: Uint8Array;
  /** Aperçu rouge, à la taille du calque. */
  overlay: HTMLCanvasElement;
  /** Pixels du calque par rapport au document, au dernier coup de pinceau. */
  toPx: DOMMatrix;
}

const masks = new Map<string, FreezeMask>();

/** Masque du calque, ou null s'il n'a rien de gelé. */
export function freezeMask(nodeId: string): FreezeMask | null {
  return masks.get(nodeId) ?? null;
}

/** Peint (geler) ou efface (dégeler) un disque de rayon `r` pixels du calque, adouci au bord. */
export function paintFreeze(
  nodeId: string,
  width: number,
  height: number,
  toPx: DOMMatrix,
  cx: number,
  cy: number,
  r: number,
  freeze: boolean,
  strength: number,
): void {
  let m = masks.get(nodeId);
  if (!m || m.width !== width || m.height !== height) {
    if (!freeze) return;
    m = { width, height, data: new Uint8Array(width * height), overlay: makeCanvas(width, height), toPx };
    masks.set(nodeId, m);
  }
  m.toPx = toPx;
  const x0 = Math.max(0, Math.floor(cx - r)),
    y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(width, Math.ceil(cx + r)),
    y1 = Math.min(height, Math.ceil(cy + r));
  if (x1 <= x0 || y1 <= y0) return;
  const r2 = r * r;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const ox = x + 0.5 - cx,
        oy = y + 0.5 - cy;
      const d2 = ox * ox + oy * oy;
      if (d2 >= r2) continue;
      // Bord adouci sur le dernier quart du rayon.
      const edge = Math.min(1, (1 - Math.sqrt(d2) / r) * 4) * strength;
      const i = y * width + x;
      m.data[i] = freeze ? Math.max(m.data[i], Math.round(255 * edge)) : Math.round(m.data[i] * (1 - edge));
    }
  drawOverlay(m, x0, y0, x1 - x0, y1 - y0);
}

function drawOverlay(m: FreezeMask, x0: number, y0: number, w: number, h: number): void {
  const ctx = m.overlay.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = m.data[(y0 + y) * m.width + x0 + x];
      const o = (y * w + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 60;
      img.data[o + 2] = 90;
      img.data[o + 3] = Math.round(v * 0.5);
    }
  ctx.putImageData(img, x0, y0);
}

/** Masque de gel d'une zone du calque (pour `liquifyDab`), ou undefined si rien n'y est gelé. */
export function freezeRegion(
  nodeId: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
): Uint8Array | undefined {
  const m = masks.get(nodeId);
  if (!m) return undefined;
  const out = new Uint8Array(w * h);
  let any = false;
  for (let y = 0; y < h; y++) {
    const yy = y0 + y;
    if (yy < 0 || yy >= m.height) continue;
    for (let x = 0; x < w; x++) {
      const xx = x0 + x;
      if (xx < 0 || xx >= m.width) continue;
      const v = m.data[yy * m.width + xx];
      out[y * w + x] = v;
      if (v) any = true;
    }
  }
  return any ? out : undefined;
}

/** Tout dégeler (un calque, ou tous). */
export function thawAll(nodeId?: string): void {
  if (nodeId) masks.delete(nodeId);
  else masks.clear();
}

/** Un calque a-t-il des zones gelées ? */
export function hasFreeze(nodeId: string): boolean {
  const m = masks.get(nodeId);
  return !!m && m.data.some((v) => v > 0);
}
