import {
  activeEffects,
  activeFilters,
  adjustmentReach,
  alphaOf,
  bevelOffset,
  contourReach,
  effectMargin,
  filtersReach,
  hasWidthProfile,
  masterOf,
  nodeBounds,
  pageFields,
  shapePath,
  symbolContent,
  visibleStrokes,
  widthProfileOutline,
  withAlpha,
  type Artboard,
  type Box,
  type MeasureText,
  type PageFields,
  type PoulpeDocument,
  type SceneNode,
} from '@poulpe/core';
import { applyAdjustmentLayer, applyLiveFilters } from './adjustments';
import { compositeOp, makeCanvas, type AnyCanvas, type Ctx } from './canvas';
import { applyTransparency, blurred, castShadow } from './effects';
import {
  applyNodeTransform,
  applyStrokeStyle,
  arrowPath,
  inverseLocal,
  nodePath,
  paintBounds,
  toPath2D,
  touches,
} from './geometry';
import { drawableSize, renderRevision, type Drawable, type ImageSource } from './images';
import { canvasPaint } from './paints';
import { drawText } from './text';

/*
 * Parcours de la scène : un objet (contenu, opacité, mode de fusion, effets), ses calques frères
 * (calques de réglage compris) et un plan de travail. Ces fonctions s'appellent les unes les
 * autres en descendant dans l'arbre : elles restent ensemble, sans import circulaire.
 */

export interface RenderOptions {
  images: ImageSource;
  measure?: MeasureText;
  /** Objets à ne pas dessiner (par ex. le texte en cours d'édition). */
  hidden?: Set<string>;
  /** Numéro de page et nombre de pages, pour les champs des textes. */
  fields?: PageFields | null;
  /** Texte en cours d'édition : ses champs restent affichés tels quels. */
  editingId?: string | null;
  /**
   * Zone visible, dans le repère du monde : les objets qui n'y touchent pas ne sont pas dessinés.
   * Absente pour les exports, qui dessinent tout.
   */
  cull?: Box;
}

export function drawNode(ctx: Ctx, doc: PoulpeDocument, node: SceneNode, opts: RenderOptions): void {
  if (!node.visible || opts.hidden?.has(node.id)) return;
  // Un réglage agit sur les calques du dessous : c'est son parent qui l'applique (drawChildren).
  if (node.type === 'adjustment') return;
  const mask = node.mask?.enabled ? opts.images.get(doc, node.mask.assetId) : null;
  if (node.effects?.length || mask || node.transparency || node.filters?.length) {
    const effects = activeEffects(node);
    if (
      (effects.length || mask || node.transparency || activeFilters(node).length) &&
      drawWithEffects(ctx, doc, node, opts, effects, mask)
    )
      return;
  }
  ctx.save();
  ctx.globalAlpha *= node.opacity;
  ctx.globalCompositeOperation = compositeOp(node.blendMode);
  drawContent(ctx, doc, node, opts);
  ctx.restore();
}

/** Dessine un objet sans son opacité, son mode de fusion ni ses effets. */
function drawContent(ctx: Ctx, doc: PoulpeDocument, node: SceneNode, opts: RenderOptions): void {
  if (node.type === 'group') {
    const kids = node.children;
    if (node.clip && kids.length > 1 && kids[0].type !== 'group') {
      const mask = kids[0];
      drawNode(ctx, doc, mask, opts);
      ctx.save();
      ctx.translate(mask.x + mask.width / 2, mask.y + mask.height / 2);
      ctx.rotate((mask.rotation * Math.PI) / 180);
      ctx.translate(-mask.width / 2, -mask.height / 2);
      ctx.clip(nodePath(mask));
      ctx.setTransform(ctx.getTransform().multiply(inverseLocal(mask)));
      drawChildren(ctx, doc, kids.slice(1), opts, nodeBounds(mask));
      ctx.restore();
    } else {
      drawChildren(ctx, doc, kids, opts, nodeBounds(node));
    }
    return;
  }
  if (node.type === 'symbol') {
    drawChildren(ctx, doc, symbolContent(doc, node), opts, nodeBounds(node));
    return;
  }
  ctx.save();
  applyNodeTransform(ctx, node);
  const w = node.width,
    h = node.height;
  if (node.type === 'image') {
    const img = opts.images.get(doc, node.assetId);
    if (img) {
      const c = node.crop;
      if (c) {
        const { width: iw, height: ih } = drawableSize(img);
        ctx.drawImage(img, c.x * iw, c.y * ih, c.width * iw, c.height * ih, 0, 0, w, h);
      } else ctx.drawImage(img, 0, 0, w, h);
    }
  } else if (node.type === 'text') {
    drawText(ctx, doc, node, opts);
  } else if (node.type !== 'adjustment') {
    const path = nodePath(node);
    if (node.type !== 'line') {
      const fill = canvasPaint(ctx, node.fill, w, h, doc, opts.images);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill(path, node.type === 'path' && node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
      }
    }
    // Les contours supplémentaires passent sous le contour principal.
    for (const st of visibleStrokes(node)) {
      const paint = canvasPaint(ctx, st.paint, w, h, doc, opts.images);
      if (!paint) continue;
      if (hasWidthProfile(st)) {
        // Largeur variable : le contour devient une forme pleine.
        ctx.fillStyle = paint;
        ctx.fill(toPath2D(widthProfileOutline(shapePath(node), st)));
        continue;
      }
      ctx.strokeStyle = paint;
      applyStrokeStyle(ctx, st);
      ctx.stroke(path);
      const heads = arrowPath(node, st);
      if (heads) {
        ctx.fillStyle = paint;
        ctx.fill(heads);
      }
    }
  }
  ctx.restore();
}

// ————— Effets —————

/**
 * Dessine un objet avec ses effets : l'objet est rendu dans un calque à part (en pixels de
 * l'écran ou de l'export), puis ombres, lueurs et flou sont composés autour de lui.
 * Renvoie false si le calque n'a pas pu être créé (on dessine alors sans effets).
 */
function drawWithEffects(
  ctx: Ctx,
  doc: PoulpeDocument,
  node: SceneNode,
  opts: RenderOptions,
  effects: ReturnType<typeof activeEffects>,
  mask: Drawable | null = null,
): boolean {
  const m = ctx.getTransform();
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  // Avec une transparence, le calque couvre aussi les contours qui débordent de la boîte ; le
  // décalage de l'outil Contour aussi.
  const b = node.transparency ? paintBounds(node) : nodeBounds(node);
  const margin =
    effectMargin(effects) + 2 + (node.transparency ? 0 : contourReach(node)) + filtersReach(node);
  const pts = [
    [b.x - margin, b.y - margin],
    [b.x + b.width + margin, b.y - margin],
    [b.x + b.width + margin, b.y + b.height + margin],
    [b.x - margin, b.y + b.height + margin],
  ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
  let x0 = Math.floor(Math.min(...pts.map((p) => p.x)));
  let y0 = Math.floor(Math.min(...pts.map((p) => p.y)));
  let x1 = Math.ceil(Math.max(...pts.map((p) => p.x)));
  let y1 = Math.ceil(Math.max(...pts.map((p) => p.y)));
  // Inutile de rendre ce qui sort de la zone visible (plus la portée des effets).
  const reach = Math.ceil(margin * scale);
  x0 = Math.max(x0, -reach);
  y0 = Math.max(y0, -reach);
  x1 = Math.min(x1, ctx.canvas.width + reach);
  y1 = Math.min(y1, ctx.canvas.height + reach);
  const w = x1 - x0,
    h = y1 - y0;
  if (w <= 0 || h <= 0) return true;
  if (w * h > 64e6) return false;
  const layer = makeCanvas(w, h);
  layer.ctx.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
  drawContent(layer.ctx, doc, node, opts);
  // Filtres en direct : sur les pixels du calque seul, avant son masque et ses effets.
  applyLiveFilters(layer, node, scale, m, x0, y0);
  if (mask) {
    // Masque de calque : appliqué au contenu, avant les effets (l'ombre suit la partie visible).
    layer.ctx.save();
    layer.ctx.globalCompositeOperation = 'destination-in';
    applyNodeTransform(layer.ctx, node);
    layer.ctx.drawImage(mask, 0, 0, node.width, node.height);
    layer.ctx.restore();
  }
  if (!effects.length) {
    applyTransparency(layer.ctx, node, m, x0, y0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= node.opacity;
    ctx.globalCompositeOperation = compositeOp(node.blendMode);
    ctx.drawImage(layer.canvas, x0, y0);
    ctx.restore();
    return true;
  }

  const out = makeCanvas(w, h);
  const o = out.ctx;
  for (const e of effects) {
    if (e.type === 'dropShadow')
      castShadow(o, layer.canvas, e.color, e.x * scale, e.y * scale, e.blur * scale);
    else if (e.type === 'outerGlow') castShadow(o, layer.canvas, e.color, 0, 0, e.blur * scale);
  }
  const blur = effects.find((e) => e.type === 'blur');
  o.drawImage(
    blur && blur.type === 'blur' ? blurred(layer.canvas, (blur.radius * scale) / 2) : layer.canvas,
    0,
    0,
  );
  const inner = effects.filter(
    (e) => e.type === 'innerShadow' || e.type === 'innerGlow' || e.type === 'bevel',
  );
  if (inner.length) {
    // Inverse du calque : ce qui est hors de l'objet, dont l'ombre tombe à l'intérieur.
    const inv = makeCanvas(w, h);
    inv.ctx.fillStyle = '#000';
    inv.ctx.fillRect(0, 0, w, h);
    inv.ctx.globalCompositeOperation = 'destination-out';
    inv.ctx.drawImage(layer.canvas, 0, 0);
    /** Ombre tombant à l'intérieur de l'objet, posée sur le résultat. */
    const castInner = (color: string, dx: number, dy: number, blur: number) => {
      const tmp = makeCanvas(w, h);
      castShadow(tmp.ctx, inv.canvas, color, dx, dy, blur);
      tmp.ctx.globalCompositeOperation = 'destination-in';
      tmp.ctx.drawImage(layer.canvas, 0, 0);
      o.drawImage(tmp.canvas, 0, 0);
    };
    for (const e of inner) {
      if (e.type === 'bevel') {
        // Biseau : la lumière d'un côté de l'arête, l'ombre de l'autre.
        const [bx, by] = bevelOffset(e);
        const k = Math.max(0, Math.min(1, e.intensity / 100));
        castInner(withAlpha(e.light, alphaOf(e.light) * k), bx * scale, by * scale, e.softness * scale);
        castInner(withAlpha(e.shadow, alphaOf(e.shadow) * k), -bx * scale, -by * scale, e.softness * scale);
        continue;
      }
      if (e.type !== 'innerShadow' && e.type !== 'innerGlow') continue;
      const dx = e.type === 'innerShadow' ? e.x * scale : 0,
        dy = e.type === 'innerShadow' ? e.y * scale : 0;
      castInner(e.color, dx, dy, e.blur * scale);
    }
  }
  // La transparence s'applique à tout l'objet, effets compris.
  applyTransparency(o, node, m, x0, y0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= node.opacity;
  ctx.globalCompositeOperation = compositeOp(node.blendMode);
  ctx.drawImage(out.canvas, x0, y0);
  ctx.restore();
  return true;
}

/** Dessine le fond et le contenu d'un plan de travail, dans le repère du monde. */
export function drawArtboard(
  ctx: Ctx,
  doc: PoulpeDocument,
  ab: Artboard,
  opts: RenderOptions & { background?: boolean; clip?: boolean },
): void {
  ctx.save();
  if (opts.clip !== false) {
    ctx.beginPath();
    ctx.rect(ab.x, ab.y, ab.width, ab.height);
    ctx.clip();
  }
  if (opts.background !== false) {
    ctx.save();
    ctx.translate(ab.x, ab.y);
    const bg = canvasPaint(ctx, ab.background, ab.width, ab.height, doc, opts.images);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, ab.width, ab.height);
    }
    ctx.restore();
  }
  const pageOpts = { ...opts, fields: pageFields(doc, ab) };
  // Les objets de la page maître passent sous ceux de la page, au même endroit relatif.
  const master = masterOf(doc, ab);
  if (master) {
    ctx.save();
    ctx.translate(ab.x - master.x, ab.y - master.y);
    drawChildren(ctx, doc, master.children, pageOpts, {
      x: master.x,
      y: master.y,
      width: master.width,
      height: master.height,
    });
    ctx.restore();
  }
  drawChildren(ctx, doc, ab.children, pageOpts, { x: ab.x, y: ab.y, width: ab.width, height: ab.height });
  ctx.restore();
}

// ————— Calques de réglage —————

/** Résultat mémorisé de la composition d'une liste d'enfants qui contient des réglages. */
const adjustCache = new WeakMap<SceneNode[], { key: string; canvas: AnyCanvas; x: number; y: number }>();

/**
 * Dessine des calques frères, du dessous vers le dessus. S'il y a des calques de réglage, les
 * calques sont composés dans une toile à part (en pixels de l'écran ou de l'export) et chaque
 * réglage transforme ce qui est déjà composé sous lui. `frame` : boîte du parent (plan de travail
 * ou groupe), qui borne la zone calculée et sert de cadre à la vignette.
 */
export function drawChildren(
  ctx: Ctx,
  doc: PoulpeDocument,
  nodes: SceneNode[],
  opts: RenderOptions,
  frame: Box,
): void {
  let last = -1;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type === 'adjustment' && n.visible && !opts.hidden?.has(n.id)) {
      last = i;
      break;
    }
  }
  if (last < 0) {
    const cull = opts.cull;
    for (const n of nodes) if (!cull || touches(paintBounds(n), cull)) drawNode(ctx, doc, n, opts);
    return;
  }
  const m = ctx.getTransform();
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  let reach = 0;
  for (let i = 0; i <= last; i++) {
    const n = nodes[i];
    if (n.type === 'adjustment') reach = Math.max(reach, adjustmentReach(n.adjustment));
  }
  const pts = [
    [frame.x, frame.y],
    [frame.x + frame.width, frame.y],
    [frame.x + frame.width, frame.y + frame.height],
    [frame.x, frame.y + frame.height],
  ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
  const fx0 = Math.floor(Math.min(...pts.map((p) => p.x)));
  const fy0 = Math.floor(Math.min(...pts.map((p) => p.y)));
  const fx1 = Math.ceil(Math.max(...pts.map((p) => p.x)));
  const fy1 = Math.ceil(Math.max(...pts.map((p) => p.y)));
  // Zone visible (plus ce que les filtres lisent autour), bornée par le parent.
  const pad = Math.ceil(reach * scale);
  const x0 = Math.max(fx0, -pad),
    y0 = Math.max(fy0, -pad);
  const x1 = Math.min(fx1, ctx.canvas.width + pad),
    y1 = Math.min(fy1, ctx.canvas.height + pad);
  const w = x1 - x0,
    h = y1 - y0;
  if (w > 0 && h > 0 && w * h <= 64e6) {
    const key = [
      m.a,
      m.b,
      m.c,
      m.d,
      m.e,
      m.f,
      x0,
      y0,
      w,
      h,
      renderRevision,
      [...(opts.hidden ?? [])].join(),
      opts.fields?.page,
      opts.editingId,
    ].join('|');
    let hit = Object.isFrozen(nodes) ? adjustCache.get(nodes) : undefined;
    if (!hit || hit.key !== key) {
      const buf = makeCanvas(w, h);
      buf.ctx.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
      for (let i = 0; i <= last; i++) {
        const n = nodes[i];
        if (n.type === 'adjustment') {
          if (n.visible && !opts.hidden?.has(n.id))
            applyAdjustmentLayer(
              buf,
              doc,
              n,
              opts,
              scale,
              { x: m.e - x0, y: m.f - y0 },
              {
                x: fx0 - x0,
                y: fy0 - y0,
                width: fx1 - fx0,
                height: fy1 - fy0,
              },
            );
        } else drawNode(buf.ctx, doc, n, opts);
      }
      hit = { key, canvas: buf.canvas, x: x0, y: y0 };
      if (Object.isFrozen(nodes)) adjustCache.set(nodes, hit);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(hit.canvas, hit.x, hit.y);
    ctx.restore();
  } else if (w > 0 && h > 0) {
    // Zone trop grande pour une toile : on dessine sans les réglages.
    for (let i = 0; i <= last; i++) drawNode(ctx, doc, nodes[i], opts);
  }
  for (let i = last + 1; i < nodes.length; i++) drawNode(ctx, doc, nodes[i], opts);
}
