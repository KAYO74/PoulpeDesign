import { artboardAt, findNode, nodesAbove, type SceneNode, type Vec } from '@poulpe/core';
import { drawArtboard, drawNode } from '@poulpe/render';
import { images, makeCanvas } from '../../photo/pixels';
import { editor } from '../../store';

/*
 * Pixels visibles du document pour les pinceaux de la Persona Photo : couleur sous le pointeur
 * (Alt + clic), et calques composés dans le repère d'un calque (sources « tous les calques » ou
 * « calques du dessous » du pot de peinture, de la baguette magique, du tampon et du correcteur).
 */

/** Objets peints au-dessus d'un calque (et lui-même sauf si `includeSelf`), à cacher. */
export function nodesAboveOf(id: string, includeSelf: boolean): Set<string> {
  return nodesAbove(editor.doc, id, includeSelf);
}

/**
 * Plan de travail du calque composé dans une toile `w` × `h`, avec `m` qui passe du document à
 * la toile (par exemple aux pixels du calque). `hidden` : objets à ne pas dessiner.
 */
export function compositeIn(
  node: SceneNode,
  w: number,
  h: number,
  m: DOMMatrix,
  hidden?: Set<string>,
): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ab = findNode(editor.doc, node.id)?.artboard;
  if (!ab) return c;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(m);
  drawArtboard(ctx, editor.doc, ab, { images: images(), hidden });
  return c;
}

/** Dessine un seul calque, en coordonnées du document (source « calque actuel »). */
export function paintNode(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  drawNode(ctx, editor.doc, node, { images: images() });
}

/** Dessine tout le plan de travail sous un point, en coordonnées du document. */
export function paintArtboardAt(ctx: CanvasRenderingContext2D, p: Vec): boolean {
  const ab = artboardAt(editor.doc, p);
  if (!ab) return false;
  drawArtboard(ctx, editor.doc, ab, { images: images() });
  return true;
}

const probe = typeof document !== 'undefined' ? makeCanvas(1, 1) : null;

/**
 * Couleur visible en un point du document (tous les calques, fond du plan de travail compris),
 * ou null hors d'un plan de travail ou sur du transparent.
 */
export function sampleColor(p: Vec): string | null {
  const ab = artboardAt(editor.doc, p);
  if (!ab || !probe) return null;
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 1, 1);
  // Le pixel du document sous le point remplit la petite toile ; seuls les objets proches sont dessinés.
  ctx.setTransform(1, 0, 0, 1, -Math.floor(p.x), -Math.floor(p.y));
  drawArtboard(ctx, editor.doc, ab, {
    images: images(),
    cull: { x: Math.floor(p.x) - 1, y: Math.floor(p.y) - 1, width: 3, height: 3 },
  });
  const d = ctx.getImageData(0, 0, 1, 1).data;
  if (d[3] < 8) return null;
  return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
}
