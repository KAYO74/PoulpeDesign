import {
  charX,
  frameShapeCommands,
  layoutTextOnPath,
  rgbaToCss,
  type PoulpeDocument,
  type TextNode,
} from '@poulpe/core';
import type { Ctx } from './canvas';
import type { RenderOptions } from './draw';
import { applyStrokeStyle, toPath2D } from './geometry';
import { measureText, textLayoutIn } from './layout';
import { canvasPaint } from './paints';

/*
 * Dessin des textes : texte sur tracé, lignes mises en page (puces, soulignement, barré) et forme
 * du cadre de texte.
 *
 * `drawText` est interne au paquet (appelée par `drawContent`, dans draw.ts) : index.ts ne la
 * réexporte pas.
 */

export function drawText(ctx: Ctx, doc: PoulpeDocument, node: TextNode, opts: RenderOptions) {
  const measure = opts.measure ?? measureText;
  const fill = canvasPaint(ctx, node.fill, node.width, node.height, doc, opts.images);
  const stroke =
    node.stroke.paint.type !== 'none' && node.stroke.width > 0
      ? canvasPaint(ctx, node.stroke.paint, node.width, node.height, doc, opts.images)
      : null;
  if (node.frameShape && !node.path) drawFrameShape(ctx, doc, node, opts);
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  applyFeatures(ctx, node.style.features);
  if (node.path) {
    // Texte sur tracé : chaque caractère est posé et tourné à sa place sur la courbe.
    for (const g of layoutTextOnPath(node, measure)) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      ctx.font = g.font;
      const f = g.style.color ? rgbaToCss(g.style.color) : fill;
      if (f) {
        ctx.fillStyle = f;
        ctx.fillText(g.char, -g.width / 2, 0);
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = node.stroke.width;
        ctx.strokeText(g.char, -g.width / 2, 0);
      }
      ctx.restore();
    }
    return;
  }
  const layout = textLayoutIn(doc, node, opts);
  if (!layout) return;
  for (const line of layout.lines) {
    const y = line.baseline;
    // Puce ou numéro d'un paragraphe de liste, dans la couleur de son premier caractère.
    const mk = line.marker;
    if (mk) {
      ctx.font = mk.font;
      const mkFill = mk.style.color ? rgbaToCss(mk.style.color) : fill;
      if (mkFill) {
        ctx.fillStyle = mkFill;
        ctx.fillText(mk.text, mk.x, y);
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = node.stroke.width;
        ctx.strokeText(mk.text, mk.x, y);
      }
    }
    for (const seg of line.segments) {
      const st = seg.style;
      const segFill = st.color ? rgbaToCss(st.color) : fill;
      ctx.font = seg.font;
      const draw = (text: string, x: number) => {
        if (segFill) {
          ctx.fillStyle = segFill;
          ctx.fillText(text, x, y);
        }
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = node.stroke.width;
          ctx.strokeText(text, x, y);
        }
      };
      // Morceaux : mots pour la justification, lettres pour l'interlettrage.
      const re = line.gap || st.letterSpacing ? (st.letterSpacing ? /[\s\S]/gu : /\s+|\S+/g) : /[\s\S]+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg.text))) {
        if (/^\s+$/.test(m[0])) continue;
        draw(m[0], charX(line, seg.start + m.index, measure));
      }
      if (st.underline || st.strike) {
        const x0 = charX(line, seg.start, measure);
        const x1 = charX(line, seg.end, measure);
        const thickness = Math.max(1, st.fontSize / 15);
        ctx.fillStyle = segFill ?? stroke ?? '#000';
        if (st.underline) ctx.fillRect(x0, y + st.fontSize * 0.1, x1 - x0, thickness);
        if (st.strike) ctx.fillRect(x0, y - st.fontSize * 0.3, x1 - x0, thickness);
      }
    }
  }
}

const frameShapeCache = new WeakMap<TextNode, Path2D>();

/** Cadre de texte de forme : le remplissage et le contour de la forme d'origine, sous le texte. */
function drawFrameShape(ctx: Ctx, doc: PoulpeDocument, node: TextNode, opts: RenderOptions): void {
  const s = node.frameShape!;
  let path = frameShapeCache.get(node);
  if (!path) {
    path = toPath2D(frameShapeCommands(node));
    if (Object.isFrozen(node)) frameShapeCache.set(node, path);
  }
  const fill = s.fill ? canvasPaint(ctx, s.fill, node.width, node.height, doc, opts.images) : null;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
  const st = s.stroke;
  const paint =
    st && st.paint.type !== 'none' && st.width > 0
      ? canvasPaint(ctx, st.paint, node.width, node.height, doc, opts.images)
      : null;
  if (st && paint) {
    ctx.save();
    ctx.strokeStyle = paint;
    applyStrokeStyle(ctx, st);
    ctx.stroke(path);
    ctx.restore();
  }
}

/**
 * Fonctions OpenType sur la toile : seules les petites capitales et le crénage sont réglables
 * (`fontVariantCaps`, `fontKerning`). Les autres fonctions n'apparaissent qu'à l'export.
 */
function applyFeatures(ctx: Ctx, features?: string[]): void {
  const c = ctx as unknown as { fontVariantCaps?: string; fontKerning?: string };
  const list = features ?? [];
  if ('fontVariantCaps' in c)
    c.fontVariantCaps = list.includes('c2sc')
      ? 'all-small-caps'
      : list.includes('smcp')
        ? 'small-caps'
        : 'normal';
  if ('fontKerning' in c) c.fontKerning = features && !list.includes('kern') ? 'none' : 'auto';
}
