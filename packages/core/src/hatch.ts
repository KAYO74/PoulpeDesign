import type { HatchStyle, Paint } from './types';

/*
 * Hachures : une tuile carrée de `spacing` pixels, répétée puis tournée de `angle` degrés. La
 * toile (paquet render) et le SVG dessinent la même tuile.
 */

export type HatchPaint = Extract<Paint, { type: 'hatch' }>;

export const HATCH_STYLES: HatchStyle[] = ['lines', 'cross', 'dots'];

/** Hachures par défaut, de la couleur donnée. */
export function defaultHatch(color: string): HatchPaint {
  return { type: 'hatch', style: 'lines', color, spacing: 10, width: 2, angle: 45 };
}

/** Formes d'une tuile de hachures, en pixels de la tuile (côté `size`). */
export type HatchShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'dot'; cx: number; cy: number; r: number };

export function hatchTile(p: HatchPaint): { size: number; shapes: HatchShape[] } {
  const size = Math.max(1, p.spacing);
  const t = Math.min(size, Math.max(0.1, p.width));
  const c = size / 2;
  const shapes: HatchShape[] = [];
  if (p.style === 'dots') shapes.push({ kind: 'dot', cx: c, cy: c, r: t / 2 });
  else {
    shapes.push({ kind: 'rect', x: 0, y: c - t / 2, w: size, h: t });
    if (p.style === 'cross') shapes.push({ kind: 'rect', x: c - t / 2, y: 0, w: t, h: size });
  }
  return { size, shapes };
}
