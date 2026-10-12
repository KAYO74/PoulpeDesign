import {
  activeEffects,
  adjustmentReach,
  applyAdjustment,
  chainHead,
  flowDependencies,
  flowText,
  frameShapeCommands,
  masterOf,
  needsFlow,
  pageFields,
  type PageFields,
  type TextFlow,
  arrowPaths,
  bevelOffset,
  charX,
  dashPattern,
  effectMargin,
  featureSettings,
  hasWidthProfile,
  sampleStops,
  symbolContent,
  visibleStrokes,
  widthProfileOutline,
  withAlpha,
  alphaOf,
  CANVAS_FEATURES,
  layoutTextOnPath,
  nodeBounds,
  strokeCap,
  strokeJoin,
  layoutText,
  contourReach,
  isElliptical,
  linearPoints,
  radialFrame,
  transparencyFrame,
  transparencyPaint,
  rgbaToCss,
  shapePath,
  type AdjustmentNode,
  type Artboard,
  type BlendMode,
  type Box,
  type MeasureText,
  type Paint,
  type PathCommand,
  type PoulpeDocument,
  type SceneNode,
  type ShapeNode,
  type Stroke,
  type SymbolNode,
  type TextLayout,
  type TextNode,
} from '@poulpe/core';

/*
 * Rendu du document sur un canevas 2D.
 *
 * C'est la première implémentation de l'interface de rendu. Tout le dessin passe par ce module,
 * ce qui permet de lui substituer un rendu CanvasKit (Skia / WebGL) sans toucher au reste.
 */

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

import { bitmapSource, isBitmapRef, resolveData } from './bitmaps';

export * from './bitmaps';
export * from './cache';

/**
 * Image prête à dessiner : décodée depuis le fichier, toile modifiée dans l'appli, ou copie
 * envoyée à un fil de dessin (voir `ParallelPainter`).
 */
export type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

export function drawableSize(img: Drawable): { width: number; height: number } {
  return typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : { width: img.width, height: img.height };
}

/** Source des images du document pour le dessin (`ImageCache` dans la page). */
export interface ImageSource {
  get(doc: PoulpeDocument, assetId: string): Drawable | null;
}

/*
 * Révision du rendu : augmente quand ce qui est dessiné change sans que le document change
 * (une image finit de se décoder, un coup de pinceau en cours). Les calques de réglage s'en
 * servent pour savoir si leur résultat mémorisé est encore bon.
 */
let renderRevision = 0;
/** Comme `renderRevision`, sans les retouches en cours, suivies image par image (`assetRevision`). */
let sharedRevision = 0;
const assetRevisions = new Map<string, number>();
export function bumpRenderRevision(): void {
  renderRevision++;
  sharedRevision++;
}

/** Révision de tout ce qui n'est pas une image en cours de retouche. */
export function getSharedRevision(): number {
  return sharedRevision;
}

/** Révision d'une image en cours de retouche (pinceau, aperçu d'un filtre). */
export function getAssetRevision(assetId: string): number {
  return assetRevisions.get(assetId) ?? 0;
}

/** Révision courante du rendu (voir `bumpRenderRevision`). */
export function getRenderRevision(): number {
  return renderRevision;
}

/** Révision des mesures de texte : augmente quand une police se charge. */
let layoutRevision = 0;
export function getLayoutRevision(): number {
  return layoutRevision;
}

/** Toiles affichées à la place d'une image pendant qu'on la modifie (pinceau, aperçu d'un filtre). */
const liveOverrides = new Map<string, HTMLCanvasElement>();

export function setLiveBitmap(assetId: string, canvas: HTMLCanvasElement | null): void {
  if (canvas) liveOverrides.set(assetId, canvas);
  else liveOverrides.delete(assetId);
  renderRevision++;
  assetRevisions.set(assetId, getAssetRevision(assetId) + 1);
}

/** Cache des images du document, décodées à partir de leurs données. */
export class ImageCache implements ImageSource {
  private images = new Map<string, { data: string; img: HTMLImageElement }>();
  constructor(private onLoad: () => void = () => {}) {}

  private loaded = () => {
    renderRevision++;
    sharedRevision++;
    this.onLoad();
  };

  get(doc: PoulpeDocument, assetId: string): HTMLImageElement | HTMLCanvasElement | null {
    const live = liveOverrides.get(assetId);
    if (live) return live;
    const asset = doc.assets[assetId];
    if (!asset) return null;
    if (isBitmapRef(asset.data)) return bitmapSource(asset.data, this.loaded);
    let entry = this.images.get(assetId);
    if (!entry || entry.data !== asset.data) {
      const img = new Image();
      img.onload = this.loaded;
      img.src = asset.data;
      entry = { data: asset.data, img };
      this.images.set(assetId, entry);
    }
    const img = entry.img;
    return img.complete && img.naturalWidth ? img : null;
  }

  /** Attend que toutes les images du document soient décodées (avant un export). */
  async ready(doc: PoulpeDocument): Promise<void> {
    await Promise.all(
      Object.keys(doc.assets).map(async (id) => {
        const data = doc.assets[id].data;
        if (isBitmapRef(data)) {
          if (!bitmapSource(data)) {
            // Toile libérée : on attend le décodage du PNG.
            await resolveData(data);
            for (let i = 0; i < 100 && !bitmapSource(data); i++) await new Promise((r) => setTimeout(r, 20));
          }
          return;
        }
        this.get(doc, id);
        const img = this.images.get(id)?.img;
        if (img && !img.complete) await img.decode().catch(() => {});
      }),
    );
  }
}

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

/** Mesure du texte par le navigateur, partagée par le rendu, l'éditeur et l'export SVG. */
export const measureText: MeasureText = (text, font) => {
  if (!measureCtx) {
    measureCtx =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d')!
        : document.createElement('canvas').getContext('2d')!;
  }
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};

/*
 * Caches : les documents sont immuables, un objet inchangé garde son identité d'une image à
 * l'autre. Sa mise en page de texte et son tracé sont donc calculés une seule fois. Les objets
 * modifiables (brouillons immer) ne sont jamais mis en cache.
 */
let layoutCache = new WeakMap<TextNode, { measure: MeasureText; layout: TextLayout }>();
const pathCache = new WeakMap<SceneNode, Path2D>();

/** Mise en page d'un texte, mémorisée tant que l'objet ne change pas. */
export function cachedLayout(node: TextNode, measure: MeasureText = measureText): TextLayout {
  if (!Object.isFrozen(node)) return layoutText(node, measure);
  const hit = layoutCache.get(node);
  if (hit && hit.measure === measure) return hit.layout;
  const layout = layoutText(node, measure);
  layoutCache.set(node, { measure, layout });
  return layout;
}

let flowCache = new WeakMap<PoulpeDocument, Map<string, TextFlow>>();
/**
 * Répartitions par chaîne (clé : son premier cadre), avec ce dont elles dépendent : quand une
 * autre partie du document change, une chaîne dont les cadres et les objets qui l'habillent sont
 * les mêmes garde sa répartition.
 */
let chainCache = new WeakMap<TextNode, Map<string, { deps: unknown[]; flow: TextFlow }>>();

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Répartition d'un texte de mise en page (cadre, chaîne de cadres liés ou champs), mémorisée tant
 * que le document ne change pas. `fields` null : champs laissés tels quels (texte en édition).
 */
export function cachedFlow(
  doc: PoulpeDocument,
  id: string,
  fields: PageFields | null,
  measure: MeasureText = measureText,
): TextFlow {
  const head = chainHead(doc, id);
  const key = `${head?.id ?? id}|${fields ? `${fields.page}/${fields.pages}` : ''}`;
  if (!Object.isFrozen(doc) || measure !== measureText) return flowText(doc, id, measure, fields);
  let map = flowCache.get(doc);
  if (!map) flowCache.set(doc, (map = new Map()));
  let flow = map.get(key);
  if (!flow) {
    const deps = flowDependencies(doc, id);
    let per = head && Object.isFrozen(head) ? chainCache.get(head) : undefined;
    if (head && Object.isFrozen(head) && !per) chainCache.set(head, (per = new Map()));
    const hit = per?.get(key);
    if (hit && sameDeps(hit.deps, deps)) flow = hit.flow;
    else {
      flow = flowText(doc, id, measure, fields);
      per?.set(key, { deps, flow });
    }
    map.set(key, flow);
  }
  return flow;
}

/**
 * Mise en page d'un texte telle qu'affichée : seul, ou sa part d'une chaîne de cadres liés.
 * Null : le cadre n'affiche rien (tout le texte tient dans les cadres précédents).
 */
export function textLayoutIn(
  doc: PoulpeDocument,
  node: TextNode,
  opts: { measure?: MeasureText; fields?: PageFields | null; editingId?: string | null } = {},
): TextLayout | null {
  const measure = opts.measure ?? measureText;
  if (!needsFlow(doc, node)) return cachedLayout(node, measure);
  const raw = !!opts.editingId && chainHead(doc, node.id)?.id === opts.editingId;
  const flow = cachedFlow(doc, node.id, raw ? null : (opts.fields ?? null), measure);
  return flow.parts.find((p) => p.node.id === node.id)?.layout ?? null;
}

/** À appeler quand les mesures changent (une police vient de se charger). */
export function clearLayoutCache(): void {
  layoutCache = new WeakMap();
  flowCache = new WeakMap();
  chainCache = new WeakMap();
  renderRevision++;
  sharedRevision++;
  layoutRevision++;
}

/** Tracé d'un objet dans son repère local, mémorisé tant que l'objet ne change pas. */
export function nodePath(node: SceneNode): Path2D {
  if (!Object.isFrozen(node)) return toPath2D(shapePath(node));
  let p = pathCache.get(node);
  if (!p) {
    p = toPath2D(shapePath(node));
    pathCache.set(node, p);
  }
  return p;
}

export function toPath2D(cmds: PathCommand[]): Path2D {
  const p = new Path2D();
  for (const c of cmds) {
    if (c.op === 'M') p.moveTo(c.x, c.y);
    else if (c.op === 'L') p.lineTo(c.x, c.y);
    else if (c.op === 'C') p.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else p.closePath();
  }
  return p;
}

export function compositeOp(mode: BlendMode): GlobalCompositeOperation {
  return mode === 'normal' ? 'source-over' : mode;
}

/** Style de peinture dans le repère local d'un objet de taille w × h. */
export function canvasPaint(
  ctx: Ctx,
  paint: Paint,
  w: number,
  h: number,
  doc?: PoulpeDocument,
  images?: ImageSource,
): string | CanvasGradient | CanvasPattern | null {
  switch (paint.type) {
    case 'none':
      return null;
    case 'solid':
      return rgbaToCss(paint.color);
    case 'linear': {
      const [a, b] = linearPoints(paint, w, h);
      // Début et fin confondus : la toile ne peindrait rien.
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) b.x += 1e-3;
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), rgbaToCss(s.color));
      return g;
    }
    case 'radial': {
      if (isElliptical(paint) && Math.abs((paint.ratio ?? 1) - 1) > 1e-3)
        return ellipticalPattern(ctx, paint, w, h);
      const f = radialFrame(paint, w, h);
      const g = ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, f.r);
      for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), rgbaToCss(s.color));
      return g;
    }
    case 'conic': {
      const cx = paint.cx * w,
        cy = paint.cy * h;
      // `createConicGradient` manque à quelques navigateurs : on approche alors par des secteurs.
      const make = (
        ctx as unknown as { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }
      ).createConicGradient;
      if (typeof make !== 'function') return conicFallback(ctx, paint, w, h);
      const g = make.call(ctx, (paint.angle * Math.PI) / 180, cx, cy);
      for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), rgbaToCss(s.color));
      return g;
    }
    case 'pattern': {
      if (!doc || !images) return null;
      const img = images.get(doc, paint.assetId);
      if (!img) return null;
      const pat = ctx.createPattern(img as CanvasImageSource, 'repeat');
      if (!pat) return null;
      const k = Math.max(0.01, paint.scale);
      pat.setTransform(
        new DOMMatrix()
          .translate((paint.x ?? 0) * w, (paint.y ?? 0) * h)
          .rotate(paint.angle)
          .scale(k, k),
      );
      return pat;
    }
  }
}

type RadialPaint = Extract<Paint, { type: 'radial' }>;

/** Repère d'un dégradé elliptique : le cercle de rayon `r` centré en 0 devient l'ellipse dans la boîte. */
function ellipseMatrix(f: ReturnType<typeof radialFrame>): DOMMatrix {
  return new DOMMatrix().translate(f.cx, f.cy).rotate(f.angle).scale(1, f.ratio);
}

function radialStops(g: CanvasGradient, paint: RadialPaint): CanvasGradient {
  for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), rgbaToCss(s.color));
  return g;
}

/** Images des dégradés elliptiques, gardées tant que la peinture et la taille ne changent pas. */
const ellipseCache = new WeakMap<RadialPaint, { key: string; canvas: AnyCanvas }>();

/**
 * Dégradé elliptique : la toile ne sait faire que des cercles. Le cercle est peint dans une image
 * qui couvre la boîte (et une marge pour les contours), puis étiré en ellipse par un motif.
 */
function ellipticalPattern(ctx: Ctx, paint: RadialPaint, w: number, h: number): CanvasPattern | null {
  const f = radialFrame(paint, w, h);
  const m = ellipseMatrix(f);
  const inv = m.inverse();
  // Zone à couvrir, ramenée dans le repère du cercle.
  const pad = Math.max(w, h) * 0.5 + 4;
  let k = f.r * 1.01;
  for (const [x, y] of [
    [-pad, -pad],
    [w + pad, -pad],
    [w + pad, h + pad],
    [-pad, h + pad],
  ]) {
    const q = inv.transformPoint(new DOMPoint(x, y));
    k = Math.max(k, Math.abs(q.x), Math.abs(q.y));
  }
  const t = ctx.getTransform();
  const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
  const n = Math.max(16, Math.min(1024, Math.ceil(2 * k * scale * Math.max(1, f.ratio))));
  const key = `${w}|${h}|${n}|${k}`;
  let hit = Object.isFrozen(paint) ? ellipseCache.get(paint) : undefined;
  if (!hit || hit.key !== key) {
    const tile = makeCanvas(n, n);
    const px = n / (2 * k);
    tile.ctx.fillStyle = radialStops(
      tile.ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, f.r * px),
      paint,
    );
    tile.ctx.fillRect(0, 0, n, n);
    hit = { key, canvas: tile.canvas };
    if (Object.isFrozen(paint)) ellipseCache.set(paint, hit);
  }
  const pat = ctx.createPattern(hit.canvas as CanvasImageSource, 'no-repeat');
  if (!pat) return null;
  pat.setTransform(m.translate(-k, -k).scale((2 * k) / n));
  return pat;
}

/**
 * Peint toute la zone visible avec une peinture exprimée dans le repère courant (boîte w × h) :
 * sert au masque de transparence, qui doit couvrir l'objet et ses effets. Les dégradés
 * elliptiques y sont exacts (repère étiré au lieu d'une image).
 */
function fillEverywhere(ctx: AnyCtx, paint: Paint, w: number, h: number): void {
  if (paint.type === 'radial' && isElliptical(paint)) {
    const f = radialFrame(paint, w, h);
    const e = ellipseMatrix(f);
    ctx.transform(e.a, e.b, e.c, e.d, e.e, e.f);
    ctx.fillStyle = radialStops(ctx.createRadialGradient(0, 0, 0, 0, 0, f.r), paint);
  } else {
    const style = canvasPaint(ctx, paint, w, h);
    if (!style) return;
    ctx.fillStyle = style;
  }
  // Coins de la toile ramenés dans le repère courant : le rectangle les couvre tous.
  const inv = ctx.getTransform().inverse();
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const pts = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
  const x0 = Math.min(...pts.map((p) => p.x)),
    y0 = Math.min(...pts.map((p) => p.y));
  const x1 = Math.max(...pts.map((p) => p.x)),
    y1 = Math.max(...pts.map((p) => p.y));
  ctx.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
}

/**
 * Transparence de l'objet (outil Transparence) : le calque déjà composé (contenu et effets) ne
 * garde que l'opacité du dégradé. `m` est la transformation du monde vers la toile d'origine,
 * décalée de (x0, y0) dans le calque.
 */
function applyTransparency(c: AnyCtx, node: SceneNode, m: DOMMatrix, x0: number, y0: number): void {
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

/** Dégradé conique dessiné en secteurs, pour les navigateurs sans `createConicGradient`. */
function conicFallback(
  ctx: Ctx,
  paint: Extract<Paint, { type: 'conic' }>,
  w: number,
  h: number,
): CanvasPattern | null {
  const size = Math.max(1, Math.ceil(Math.max(w, h)));
  const tile = makeCanvas(size, size);
  const cx = paint.cx * w,
    cy = paint.cy * h;
  const r = Math.hypot(w, h);
  const steps = 90;
  for (let i = 0; i < steps; i++) {
    const a0 = ((paint.angle + (i * 360) / steps) * Math.PI) / 180;
    const a1 = ((paint.angle + ((i + 1.02) * 360) / steps) * Math.PI) / 180;
    tile.ctx.beginPath();
    tile.ctx.moveTo(cx, cy);
    tile.ctx.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    tile.ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    tile.ctx.closePath();
    tile.ctx.fillStyle = rgbaToCss(sampleStops(paint.stops, (i + 0.5) / steps));
    tile.ctx.fill();
  }
  return ctx.createPattern(tile.canvas as CanvasImageSource, 'no-repeat');
}

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

const reachCache = new WeakMap<SceneNode, Box>();

/**
 * Boîte de tout ce qu'un objet peut peindre : sa boîte, élargie de ses contours (angles vifs et
 * flèches compris), de ses effets et, pour un texte, de ce qui peut dépasser de son cadre.
 */
export function paintBounds(node: SceneNode): Box {
  const frozen = Object.isFrozen(node);
  const hit = frozen ? reachCache.get(node) : undefined;
  if (hit) return hit;
  let b = nodeBounds(node);
  let pad = 2;
  if (node.type === 'group') {
    // Les contours des enfants peuvent dépasser de la boîte du groupe.
    const kids = node.children.map(paintBounds);
    const x0 = Math.min(b.x, ...kids.map((k) => k.x)),
      y0 = Math.min(b.y, ...kids.map((k) => k.y));
    const x1 = Math.max(b.x + b.width, ...kids.map((k) => k.x + k.width)),
      y1 = Math.max(b.y + b.height, ...kids.map((k) => k.y + k.height));
    b = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  } else if (node.type === 'symbol') {
    // Contenu d'un symbole : ses contours sont inconnus ici, on garde une large marge.
    pad += Math.max(node.width, node.height) / 2;
  } else if ('stroke' in node) {
    for (const st of visibleStrokes(node)) pad = Math.max(pad, 2 + st.width * 6);
    pad += contourReach(node);
  }
  if (node.type === 'text') {
    let size = node.style.fontSize;
    for (const r of node.runs ?? []) size = Math.max(size, r.style.fontSize ?? 0);
    pad += size * 2;
  }
  if (node.effects?.length) pad += effectMargin(activeEffects(node));
  const box = { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
  if (frozen) reachCache.set(node, box);
  return box;
}

function touches(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

function applyNodeTransform(ctx: Ctx, node: SceneNode) {
  ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
  if (node.rotation) ctx.rotate((node.rotation * Math.PI) / 180);
  ctx.translate(-node.width / 2, -node.height / 2);
}

function drawText(ctx: Ctx, doc: PoulpeDocument, node: TextNode, opts: RenderOptions) {
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

export function drawNode(ctx: Ctx, doc: PoulpeDocument, node: SceneNode, opts: RenderOptions): void {
  if (!node.visible || opts.hidden?.has(node.id)) return;
  // Un réglage agit sur les calques du dessous : c'est son parent qui l'applique (drawChildren).
  if (node.type === 'adjustment') return;
  const mask = node.mask?.enabled ? opts.images.get(doc, node.mask.assetId) : null;
  if (node.effects?.length || mask || node.transparency) {
    const effects = activeEffects(node);
    if ((effects.length || mask || node.transparency) && drawWithEffects(ctx, doc, node, opts, effects, mask))
      return;
  }
  ctx.save();
  ctx.globalAlpha *= node.opacity;
  ctx.globalCompositeOperation = compositeOp(node.blendMode);
  drawContent(ctx, doc, node, opts);
  ctx.restore();
}

/** Applique le style d'un contour (épaisseur, extrémités, jonctions, pointillés). */
export function applyStrokeStyle(ctx: Ctx, stroke: Stroke): void {
  ctx.lineWidth = stroke.width;
  ctx.lineJoin = strokeJoin(stroke);
  ctx.lineCap = strokeCap(stroke);
  ctx.miterLimit = 10;
  ctx.setLineDash(dashPattern(stroke));
}

const arrowCache = new WeakMap<Stroke, Path2D | null>();

/** Flèches d'un tracé ouvert, mémorisées tant que le contour ne change pas. */
function arrowPath(node: ShapeNode, stroke: Stroke): Path2D | null {
  if ((!stroke.start || stroke.start === 'none') && (!stroke.end || stroke.end === 'none')) return null;
  if (Object.isFrozen(stroke) && arrowCache.has(stroke)) return arrowCache.get(stroke)!;
  const cmds = arrowPaths(shapePath(node), stroke);
  const p = cmds.length ? toPath2D(cmds) : null;
  if (Object.isFrozen(stroke)) arrowCache.set(stroke, p);
  return p;
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
  void CANVAS_FEATURES;
  void featureSettings;
}

/** Dessine un objet sans son opacité, son mode de fusion ni ses effets. */
function drawContent(ctx: Ctx, doc: PoulpeDocument, node: SceneNode, opts: RenderOptions): void {
  const measure = opts.measure ?? measureText;
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

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { canvas: AnyCanvas; ctx: AnyCtx } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d')! };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}

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
function blurred(src: AnyCanvas, sigma: number): AnyCanvas {
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
function castShadow(
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
  // Avec une transparence, le calque couvre aussi les contours qui débordent de la boîte.
  const b = node.transparency ? paintBounds(node) : nodeBounds(node);
  const margin = effectMargin(effects) + 2;
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

/** Inverse de la transformation locale d'un objet (pour revenir au repère du monde après un écrêtage). */
function inverseLocal(node: SceneNode): DOMMatrix {
  return new DOMMatrix()
    .translate(node.x + node.width / 2, node.y + node.height / 2)
    .rotate(node.rotation)
    .translate(-node.width / 2, -node.height / 2)
    .inverse();
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

/** Applique un calque de réglage à la toile de composition, selon son opacité et son masque. */
function applyAdjustmentLayer(
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

export interface RasterOptions {
  scale?: number;
  type?: 'image/png' | 'image/jpeg';
  /** Qualité JPEG, de 0 à 1. */
  quality?: number;
  background?: boolean;
}

/** Rendu d'un plan de travail en image (PNG ou JPEG). */
export async function rasterizeArtboard(
  doc: PoulpeDocument,
  ab: Artboard,
  images: ImageCache,
  opts: RasterOptions = {},
): Promise<Blob> {
  await images.ready(doc);
  const scale = opts.scale ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(ab.width * scale));
  canvas.height = Math.max(1, Math.round(ab.height * scale));
  const ctx = canvas.getContext('2d')!;
  if (opts.type === 'image/jpeg') {
    // Le JPEG n'a pas de transparence : fond blanc sous le plan de travail.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  ctx.translate(-ab.x, -ab.y);
  drawArtboard(ctx, doc, ab, { images, background: opts.background });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('export impossible'))),
      opts.type ?? 'image/png',
      opts.quality ?? 0.92,
    ),
  );
}
