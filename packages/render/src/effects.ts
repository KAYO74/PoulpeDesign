import { rgbaToCss, transparencyFrame, transparencyPaint, type SceneNode } from '@poulpe/core';
import { makeCanvas, type AnyCanvas, type AnyCtx } from './canvas';
import { fillEverywhere } from './paints';

/*
 * Briques des effets, appliquées au calque où un objet est rendu à part (voir `drawWithEffects`,
 * dans draw.ts) : flou, ombres et lueurs, puis transparence de l'objet.
 *
 * `blurred`, `castShadow` et `applyTransparency` sont internes au paquet : index.ts ne les
 * réexporte pas.
 */

let filterSupport: boolean | null = null;

/** Le canevas sait-il flouter (`ctx.filter`) ? Ce n'est pas le cas de Safari. */
function canFilter(): boolean {
  if (filterSupport === null) {
    const { ctx } = makeCanvas(1, 1);
    ctx.filter = 'blur(2px)';
    filterSupport = ctx.filter === 'blur(2px)';
  }
  return filterSupport;
}

/** Copie floutée d'un calque (écart type `sigma` en pixels). */
export function blurred(src: AnyCanvas, sigma: number): AnyCanvas {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  if (sigma <= 0.01) {
    ctx.drawImage(src, 0, 0);
    return canvas;
  }
  if (canFilter()) {
    ctx.filter = `blur(${sigma}px)`;
    ctx.drawImage(src, 0, 0);
    return canvas;
  }
  // Repli : réduction puis agrandissement lissé, ce qui approche un flou.
  const k = Math.max(1, sigma / 1.5);
  const small = makeCanvas(Math.max(1, Math.round(src.width / k)), Math.max(1, Math.round(src.height / k)));
  small.ctx.imageSmoothingQuality = 'high';
  small.ctx.drawImage(src, 0, 0, small.canvas.width, small.canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small.canvas, 0, 0, src.width, src.height);
  return canvas;
}

const FAR = 100000;

/** Ombre seule d'un calque (sans le calque lui-même), ajoutée sur `out`. */
export function castShadow(
  out: AnyCtx,
  src: AnyCanvas,
  color: string,
  dx: number,
  dy: number,
  blur: number,
  op: GlobalCompositeOperation = 'source-over',
) {
  out.save();
  out.globalCompositeOperation = op;
  out.shadowColor = rgbaToCss(color);
  out.shadowBlur = blur;
  // Le calque est dessiné très loin, seule son ombre retombe à sa place.
  out.shadowOffsetX = dx + FAR;
  out.shadowOffsetY = dy;
  out.drawImage(src, -FAR, 0);
  out.restore();
}

/**
 * Transparence de l'objet (outil Transparence) : le calque déjà composé (contenu et effets) ne
 * garde que l'opacité du dégradé. `m` est la transformation du monde vers la toile d'origine,
 * décalée de (x0, y0) dans le calque.
 */
export function applyTransparency(c: AnyCtx, node: SceneNode, m: DOMMatrix, x0: number, y0: number): void {
  const t = node.transparency;
  if (!t) return;
  const f = transparencyFrame(node);
  c.save();
  c.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
  c.translate(f.x + f.width / 2, f.y + f.height / 2);
  if (f.rotation) c.rotate((f.rotation * Math.PI) / 180);
  c.translate(-f.width / 2, -f.height / 2);
  c.globalCompositeOperation = 'destination-in';
  fillEverywhere(c, transparencyPaint(t), f.width, f.height);
  c.restore();
}
