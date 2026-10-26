import { opaque, alphaOf, sampleStops, withAlpha } from './color';
import { activeEffects, effectMargin } from './effects';
import { nodeBounds, pathToSvg, shapePath } from './geometry';
import {
  isElliptical,
  linearPoints,
  radialFrame,
  transparencyFrame,
  transparencyPaint,
} from './paintGeometry';
import { contourReach } from './contour';
import { hatchTile } from './hatch';
import { chainHead, flowText, hasFields, needsFlow, type PageFields, type TextFlow } from './flow';
import { masterOf, pageFields } from './pages';
import {
  approximateMeasure,
  charX,
  layoutText,
  type CharStyle,
  type MeasureText,
  type TextLayout,
} from './text';
import { featureSettings } from './text';
import { frameShapeCommands } from './textWrap';
import { hasWidthProfile, visibleStrokes, widthProfileOutline } from './strokeProfile';
import { symbolContent } from './symbols';
import type { Artboard, BevelEffect, Paint, PoulpeDocument, SceneNode, Stroke, TextNode } from './types';
import { arrowPaths, dashPattern, layoutTextOnPath, strokeCap, strokeJoin } from './vector';

export interface SvgExportOptions {
  measureText?: MeasureText;
  /**
   * Remplace le SVG d'un objet (par exemple une image de l'objet avec ses effets, pour le PDF qui
   * ne sait pas lire les filtres). Renvoie null pour garder l'export normal.
   */
  override?: (node: SceneNode) => string | null;
  /** Inclure le fond du plan de travail (sinon fond transparent). */
  background?: boolean;
  /** Fond perdu : marge ajoutée tout autour du plan de travail, en pixels du document. */
  bleed?: number;
  /**
   * Répartitions des chaînes de cadres liés, à partager entre les pages d'un même export (d'un
   * même document) : chaque chaîne n'est répartie qu'une fois, et non une fois par cadre.
   */
  flows?: Map<string, TextFlow>;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => String(+v.toFixed(3));

class Defs {
  private items: string[] = [];
  private count = 0;
  constructor(private doc?: PoulpeDocument) {}
  id(prefix: string) {
    return `${prefix}${++this.count}`;
  }
  /** Image du document, pour les motifs. */
  asset(id: string) {
    return this.doc?.assets[id];
  }
  add(s: string) {
    this.items.push(s);
  }
  toString() {
    return this.items.length ? `<defs>${this.items.join('')}</defs>` : '';
  }
}

function colorAttrs(attr: 'fill' | 'stroke', color: string): string {
  const a = alphaOf(color);
  return `${attr}="${opaque(color)}"${a < 1 ? ` ${attr}-opacity="${n(a)}"` : ''}`;
}

function stops(paint: Extract<Paint, { stops: unknown }>): string {
  return [...paint.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => {
      const a = alphaOf(s.color);
      return `<stop offset="${n(s.offset)}" stop-color="${opaque(s.color)}"${a < 1 ? ` stop-opacity="${n(a)}"` : ''}/>`;
    })
    .join('');
}

/** Attribut de peinture ; les dégradés sont exprimés dans le repère local de l'objet (0..w, 0..h). */
function paintAttr(attr: 'fill' | 'stroke', paint: Paint, w: number, h: number, defs: Defs): string {
  switch (paint.type) {
    case 'none':
      return `${attr}="none"`;
    case 'solid':
      return colorAttrs(attr, paint.color);
    case 'linear': {
      const id = defs.id('lg');
      const [a, b] = linearPoints(paint, w, h);
      defs.add(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}">${stops(paint)}</linearGradient>`,
      );
      return `${attr}="url(#${id})"`;
    }
    case 'radial': {
      const id = defs.id('rg');
      const f = radialFrame(paint, w, h);
      // Dégradé elliptique : un cercle centré en 0, étiré et tourné par `gradientTransform`.
      const ellipse = isElliptical(paint) && Math.abs(f.ratio - 1) > 1e-3;
      defs.add(
        ellipse
          ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${n(f.r)}" gradientTransform="translate(${n(f.cx)} ${n(f.cy)}) rotate(${n(f.angle)}) scale(1 ${n(f.ratio)})">${stops(paint)}</radialGradient>`
          : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(f.cx)}" cy="${n(f.cy)}" r="${n(f.r)}">${stops(paint)}</radialGradient>`,
      );
      return `${attr}="url(#${id})"`;
    }
    case 'conic': {
      // Le SVG n'a pas de dégradé conique : il est approché par des secteurs de couleur unie.
      const id = defs.id('cg');
      const steps = 72;
      const cx = paint.cx * w,
        cy = paint.cy * h;
      const r = Math.hypot(w, h);
      let body = '';
      for (let i = 0; i < steps; i++) {
        const a0 = ((paint.angle + (i * 360) / steps) * Math.PI) / 180;
        // Les secteurs se chevauchent d'un peu pour ne pas laisser de liseré.
        const a1 = ((paint.angle + ((i + 1.02) * 360) / steps) * Math.PI) / 180;
        const color = sampleStops(paint.stops, (i + 0.5) / steps);
        body +=
          `<path d="M${n(cx)} ${n(cy)}L${n(cx + Math.cos(a0) * r)} ${n(cy + Math.sin(a0) * r)}` +
          `L${n(cx + Math.cos(a1) * r)} ${n(cy + Math.sin(a1) * r)}Z" ${colorAttrs('fill', color)}/>`;
      }
      defs.add(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" x="0" y="0" width="${n(Math.max(1, w))}" height="${n(Math.max(1, h))}">${body}</pattern>`,
      );
      return `${attr}="url(#${id})"`;
    }
    case 'pattern': {
      const asset = defs.asset(paint.assetId);
      if (!asset) return `${attr}="none"`;
      const id = defs.id('pat');
      const tw = Math.max(1, asset.width * paint.scale),
        th = Math.max(1, asset.height * paint.scale);
      const ox = (paint.x ?? 0) * w,
        oy = (paint.y ?? 0) * h;
      const tr = [
        ox || oy ? `translate(${n(ox)} ${n(oy)})` : '',
        paint.angle ? `rotate(${n(paint.angle)})` : '',
      ]
        .filter(Boolean)
        .join(' ');
      defs.add(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(tw)}" height="${n(th)}"` +
          (tr ? ` patternTransform="${tr}"` : '') +
          `><image width="${n(tw)}" height="${n(th)}" preserveAspectRatio="none" href="${asset.data}"/></pattern>`,
      );
      return `${attr}="url(#${id})"`;
    }
    case 'hatch': {
      const id = defs.id('hat');
      const { size, shapes } = hatchTile(paint);
      const ink = colorAttrs('fill', paint.color);
      let body = paint.background
        ? `<rect width="${n(size)}" height="${n(size)}" ${colorAttrs('fill', paint.background)}/>`
        : '';
      for (const s of shapes)
        body +=
          s.kind === 'dot'
            ? `<circle cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.r)}" ${ink}/>`
            : `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" ${ink}/>`;
      defs.add(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(size)}" height="${n(size)}"` +
          (paint.angle ? ` patternTransform="rotate(${n(paint.angle)})"` : '') +
          `>${body}</pattern>`,
      );
      return `${attr}="url(#${id})"`;
    }
  }
}

function strokeAttrs(stroke: Stroke, w: number, h: number, defs: Defs): string {
  if (stroke.paint.type === 'none' || stroke.width <= 0) return '';
  const join = strokeJoin(stroke);
  const dash = dashPattern(stroke);
  return (
    ` ${paintAttr('stroke', stroke.paint, w, h, defs)} stroke-width="${n(stroke.width)}" stroke-linejoin="${join}" stroke-linecap="${strokeCap(stroke)}"` +
    (join === 'miter' ? ' stroke-miterlimit="10"' : '') +
    (dash.length ? ` stroke-dasharray="${dash.map(n).join(' ')}"` : '')
  );
}

/** Décalage (en pixels) de la lumière d'un biseau, d'après son angle et sa profondeur. */
export function bevelOffset(e: BevelEffect): [number, number] {
  const a = (e.angle * Math.PI) / 180;
  const d = e.style === 'emboss' ? e.depth * 0.6 : e.depth;
  return [Math.cos(a) * d, -Math.sin(a) * d];
}

/** Filtre SVG des effets d'un objet ; la zone du filtre est donnée dans le repère du monde. */
function effectsFilter(node: SceneNode, defs: Defs): string | null {
  const effects = activeEffects(node);
  if (!effects.length) return null;
  const id = defs.id('fx');
  const b = nodeBounds(node);
  // Le décalage de l'outil Contour dépasse de la boîte : la zone du filtre le couvre.
  const m = effectMargin(effects) + 2 + contourReach(node);
  const sd = (r: number) => n(Math.max(0, r) / 2);
  const flood = (c: string) => `<feFlood flood-color="${opaque(c)}" flood-opacity="${n(alphaOf(c))}"/>`;
  let body = '';
  const merge: string[] = [];
  let content = 'SourceGraphic';
  let k = 0;
  for (const e of effects) {
    const r = `e${++k}`;
    if (e.type === 'dropShadow' || e.type === 'outerGlow') {
      const dx = e.type === 'dropShadow' ? e.x : 0,
        dy = e.type === 'dropShadow' ? e.y : 0;
      body += `<feGaussianBlur in="SourceAlpha" stdDeviation="${sd(e.blur)}"/><feOffset dx="${n(dx)}" dy="${n(dy)}" result="${r}o"/>${flood(e.color)}<feComposite in2="${r}o" operator="in" result="${r}"/>`;
      merge.push(r);
    } else if (e.type === 'blur') {
      body += `<feGaussianBlur in="SourceGraphic" stdDeviation="${sd(e.radius)}" result="${r}"/>`;
      content = r;
    }
  }
  merge.push(content);
  for (const e of effects) {
    const r = `e${++k}`;
    if (e.type === 'bevel') {
      // Biseau : une lumière et une ombre intérieures, décalées de part et d'autre de l'arête.
      const [dx, dy] = bevelOffset(e);
      const inner = (color: string, ox: number, oy: number, out: string) =>
        `<feComponentTransfer in="SourceAlpha" result="${out}m"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>` +
        `<feGaussianBlur in="${out}m" stdDeviation="${sd(e.softness)}"/><feOffset dx="${n(ox)}" dy="${n(oy)}" result="${out}o"/>` +
        `${flood(withAlpha(color, (alphaOf(color) * e.intensity) / 100))}<feComposite in2="${out}o" operator="in"/>` +
        `<feComposite in2="SourceAlpha" operator="in" result="${out}"/>`;
      body += inner(e.light, dx, dy, `${r}l`) + inner(e.shadow, -dx, -dy, `${r}s`);
      merge.push(`${r}l`, `${r}s`);
    } else if (e.type === 'innerShadow' || e.type === 'innerGlow') {
      const dx = e.type === 'innerShadow' ? e.x : 0,
        dy = e.type === 'innerShadow' ? e.y : 0;
      body += `<feComponentTransfer in="SourceAlpha" result="${r}i"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feGaussianBlur in="${r}i" stdDeviation="${sd(e.blur)}"/><feOffset dx="${n(dx)}" dy="${n(dy)}" result="${r}o"/>${flood(e.color)}<feComposite in2="${r}o" operator="in"/><feComposite in2="SourceAlpha" operator="in" result="${r}"/>`;
      merge.push(r);
    }
  }
  defs.add(
    `<filter id="${id}" filterUnits="userSpaceOnUse" x="${n(b.x - m)}" y="${n(b.y - m)}" width="${n(b.width + 2 * m)}" height="${n(b.height + 2 * m)}" color-interpolation-filters="sRGB">${body}<feMerge>${merge.map((r) => `<feMergeNode in="${r}"/>`).join('')}</feMerge></filter>`,
  );
  return id;
}

function transformAttr(node: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}): string {
  const t = `translate(${n(node.x)} ${n(node.y)})`;
  if (!node.rotation) return t;
  return `${t} rotate(${n(node.rotation)} ${n(node.width / 2)} ${n(node.height / 2)})`;
}

function commonAttrs(node: SceneNode): string {
  let s = '';
  if (node.opacity < 1) s += ` opacity="${n(node.opacity)}"`;
  if (node.blendMode !== 'normal') s += ` style="mix-blend-mode:${node.blendMode}"`;
  return s;
}

interface Ctx {
  doc: PoulpeDocument;
  defs: Defs;
  measure: MeasureText;
  override?: (node: SceneNode) => string | null;
  /** Numéro de page et nombre de pages, pour les champs des textes. */
  fields: PageFields;
  flows: Map<string, TextFlow>;
}

/** Mise en page d'un texte : seul, ou sa part d'une chaîne de cadres liés (null : rien à afficher). */
function textLayout(node: TextNode, ctx: Ctx): TextLayout | null {
  if (!needsFlow(ctx.doc, node)) return layoutText(node, ctx.measure);
  const head = chainHead(ctx.doc, node.id) ?? node;
  // Les champs changent d'une page à l'autre : ils n'entrent dans la clé que si le texte en a.
  const key = hasFields(head.text) ? `${head.id}\n${ctx.fields.page}\n${ctx.fields.pages}` : head.id;
  let flow = ctx.flows.get(key);
  if (!flow) ctx.flows.set(key, (flow = flowText(ctx.doc, node.id, ctx.measure, ctx.fields)));
  return flow.parts.find((p) => p.node.id === node.id)?.layout ?? null;
}

function nodeToSvg(node: SceneNode, ctx: Ctx): string {
  if (!node.visible) return '';
  const replaced = ctx.override?.(node);
  if (replaced != null) return replaced;
  let body = nodeContentToSvg(node, ctx);
  const fx = body ? effectsFilter(node, ctx.defs) : null;
  // Le filtre est posé sur un groupe sans transformation : décalages dans le repère du monde.
  if (fx) body = `<g filter="url(#${fx})">${body}</g>`;
  const mask = node.mask?.enabled ? ctx.doc.assets[node.mask.assetId] : undefined;
  if (body && mask) {
    // Masque de calque : seule l'opacité de l'image du masque compte.
    const id = ctx.defs.id('mask');
    ctx.defs.add(
      `<mask id="${id}" maskUnits="userSpaceOnUse" style="mask-type:alpha"><image transform="${transformAttr(node)}" width="${n(node.width)}" height="${n(node.height)}" preserveAspectRatio="none" href="${mask.data}"/></mask>`,
    );
    body = `<g mask="url(#${id})">${body}</g>`;
  }
  if (body && node.transparency) {
    // Transparence (outil Transparence) : masque de luminance, du blanc plus ou moins opaque posé
    // dans la boîte de l'objet, assez grand pour couvrir ses contours et ses effets.
    const f = transparencyFrame(node);
    const id = ctx.defs.id('tm');
    const b = nodeBounds(node);
    const strokes = 'stroke' in node ? visibleStrokes(node).map((st) => st.width * 6) : [];
    const m =
      effectMargin(activeEffects(node)) +
      Math.max(0, ...strokes) +
      contourReach(node) +
      Math.max(f.width, f.height);
    const fill = paintAttr('fill', transparencyPaint(node.transparency), f.width, f.height, ctx.defs);
    ctx.defs.add(
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(b.x - m)}" y="${n(b.y - m)}" width="${n(b.width + 2 * m)}" height="${n(b.height + 2 * m)}">` +
        `<rect transform="${transformAttr(f)}" x="${n(-m)}" y="${n(-m)}" width="${n(f.width + 2 * m)}" height="${n(f.height + 2 * m)}" ${fill}/></mask>`,
    );
    body = `<g mask="url(#${id})">${body}</g>`;
  }
  return body;
}

function nodeContentToSvg(node: SceneNode, ctx: Ctx): string {
  const { doc, defs, measure } = ctx;
  const label = ` data-name="${esc(node.name)}"`;
  if (node.type === 'group') {
    const kids = node.children;
    if (node.clip && kids.length > 1 && kids[0].type !== 'group') {
      const mask = kids[0];
      const id = defs.id('clip');
      defs.add(
        `<clipPath id="${id}"><path transform="${transformAttr(mask)}" d="${pathToSvg(shapePath(mask))}"/></clipPath>`,
      );
      return `<g${label}${commonAttrs(node)}>${nodeToSvg(mask, ctx)}<g clip-path="url(#${id})">${kids
        .slice(1)
        .map((c) => nodeToSvg(c, ctx))
        .join('')}</g></g>`;
    }
    return `<g${label}${commonAttrs(node)}>${kids.map((c) => nodeToSvg(c, ctx)).join('')}</g>`;
  }
  // Les réglages ne s'expriment pas en SVG : l'export les met en image (voir `override`).
  if (node.type === 'adjustment') return '';
  // Une instance de symbole exporte le contenu du symbole, ramené dans sa boîte.
  if (node.type === 'symbol')
    return `<g${label}${commonAttrs(node)}>${symbolContent(doc, node)
      .map((c) => nodeToSvg(c, ctx))
      .join('')}</g>`;
  const w = node.width,
    h = node.height;
  const open = `<g${label} transform="${transformAttr(node)}"${commonAttrs(node)}>`;
  if (node.type === 'image') {
    const asset = doc.assets[node.assetId];
    if (!asset) return '';
    const c = node.crop;
    if (!c || (c.x === 0 && c.y === 0 && c.width === 1 && c.height === 1))
      return `${open}<image width="${n(w)}" height="${n(h)}" preserveAspectRatio="none" href="${asset.data}"/></g>`;
    // Image recadrée : l'image entière, découpée par la boîte de l'objet.
    const fw = w / c.width,
      fh = h / c.height;
    const id = defs.id('crop');
    defs.add(`<clipPath id="${id}"><rect width="${n(w)}" height="${n(h)}"/></clipPath>`);
    return `${open}<g clip-path="url(#${id})"><image x="${n(-c.x * fw)}" y="${n(-c.y * fh)}" width="${n(fw)}" height="${n(fh)}" preserveAspectRatio="none" href="${asset.data}"/></g></g>`;
  }
  if (node.type === 'text') {
    const layout = node.path ? null : textLayout(node, ctx);
    if (!node.path && !layout) return '';
    const st = node.style;
    const deco = (c: { underline: boolean; strike: boolean }) =>
      [c.underline && 'underline', c.strike && 'line-through'].filter(Boolean).join(' ');
    const fontAttrs = (c: CharStyle, ref?: CharStyle) => {
      let a = '';
      if (!ref || c.fontFamily !== ref.fontFamily) a += ` font-family="${esc(c.fontFamily)}, sans-serif"`;
      if (!ref || c.fontSize !== ref.fontSize) a += ` font-size="${n(c.fontSize)}"`;
      if (!ref || c.fontWeight !== ref.fontWeight) a += ` font-weight="${c.fontWeight}"`;
      if (c.italic !== (ref?.italic ?? false)) a += ` font-style="${c.italic ? 'italic' : 'normal'}"`;
      if (c.letterSpacing !== (ref?.letterSpacing ?? 0)) a += ` letter-spacing="${n(c.letterSpacing)}"`;
      const dc = deco(c);
      if (dc !== (ref ? deco(ref) : '')) a += ` text-decoration="${dc || 'none'}"`;
      if (c.color) a += ` ${colorAttrs('fill', c.color)}`;
      return a;
    };
    const features = st.features?.length
      ? ` font-feature-settings="${esc(featureSettings(st.features))}"`
      : '';
    const attrs =
      fontAttrs(st) +
      features +
      ` ${paintAttr('fill', node.fill, w, h, defs)}` +
      strokeAttrs(node.stroke, w, h, defs);
    if (node.path) {
      // Texte sur tracé : chaque caractère est posé et tourné à sa place.
      const glyphs = layoutTextOnPath(node, measure)
        .map(
          (g) =>
            `<text x="${n(-g.width / 2)}" y="0" transform="translate(${n(g.x)} ${n(g.y)}) rotate(${n((g.angle * 180) / Math.PI)})"${fontAttrs(g.style, st)}>${esc(g.char)}</text>`,
        )
        .join('');
      return `${open}<g xml:space="preserve"${attrs}>${glyphs}</g></g>`;
    }
    // Cadre de texte de forme : la forme d'origine (remplissage et contour) passe sous le texte.
    const fs = node.frameShape;
    const shape =
      fs && (fs.fill || fs.stroke)
        ? `<path d="${pathToSvg(frameShapeCommands(node))}" ${paintAttr('fill', fs.fill ?? { type: 'none' }, w, h, defs)}${fs.stroke ? strokeAttrs(fs.stroke, w, h, defs) : ''}/>`
        : '';
    let spans = '';
    for (const line of layout!.lines) {
      // Puce ou numéro de liste, jamais souligné ni barré.
      const mk = line.marker;
      if (mk)
        spans += `<tspan x="${n(mk.x)}" y="${n(line.baseline)}"${fontAttrs({ ...mk.style, underline: false, strike: false }, st)}>${esc(mk.text)}</tspan>`;
      for (const seg of line.segments) {
        // Texte justifié : chaque mot est placé ; sinon un morceau par style.
        const re = line.gap ? /\s+|\S+/g : /[\s\S]+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(seg.text))) {
          if (line.gap && /^\s+$/.test(m[0])) continue;
          const x = charX(line, seg.start + m.index, measure);
          spans += `<tspan x="${n(x)}" y="${n(line.baseline)}"${fontAttrs(seg.style, st)}>${esc(m[0])}</tspan>`;
        }
      }
    }
    return `${open}${shape}<text xml:space="preserve"${attrs}>${spans}</text></g>`;
  }
  const cmds = shapePath(node);
  const d = pathToSvg(cmds);
  const rule = node.type === 'path' && node.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  const strokes = visibleStrokes(node);
  // Un contour par élément, du plus bas au plus haut ; le remplissage est porté par le premier.
  const strokeBody = strokes
    .map((st) => {
      if (hasWidthProfile(st))
        return `<path d="${pathToSvg(widthProfileOutline(cmds, st))}" ${paintAttr('fill', st.paint, w, h, defs)}/>`;
      const arrows = arrowPaths(cmds, st);
      const heads = arrows.length
        ? `<path d="${pathToSvg(arrows)}" ${paintAttr('fill', st.paint, w, h, defs)}/>`
        : '';
      return `<path d="${d}" fill="none"${strokeAttrs(st, w, h, defs)}/>${heads}`;
    })
    .join('');
  const fillBody = `<path d="${d}"${rule} ${paintAttr('fill', node.type === 'line' ? { type: 'none' } : node.fill, w, h, defs)}/>`;
  return `${open}${fillBody}${strokeBody}</g>`;
}

/** Exporte un plan de travail en SVG autonome (images incluses). */
export function artboardToSvg(doc: PoulpeDocument, artboard: Artboard, opts: SvgExportOptions = {}): string {
  const measure = opts.measureText ?? approximateMeasure;
  const defs = new Defs(doc);
  const b = Math.max(0, opts.bleed ?? 0);
  const W = artboard.width + 2 * b,
    H = artboard.height + 2 * b;
  // Le fond déborde dans le fond perdu ; ses dégradés restent calés sur la page.
  const bg =
    opts.background !== false && artboard.background.type !== 'none'
      ? `<rect x="${n(-b)}" y="${n(-b)}" width="${n(W)}" height="${n(H)}" ${paintAttr('fill', artboard.background, artboard.width, artboard.height, defs)}/>`
      : '';
  const ctx: Ctx = {
    doc,
    defs,
    measure,
    override: opts.override,
    fields: pageFields(doc, artboard),
    flows: opts.flows ?? new Map(),
  };
  const master = masterOf(doc, artboard);
  // Les objets de la page maître passent sous ceux de la page, au même endroit relatif.
  const under = master
    ? `<g transform="translate(${n(artboard.x - master.x)} ${n(artboard.y - master.y)})">${master.children.map((c) => nodeToSvg(c, ctx)).join('')}</g>`
    : '';
  const body = artboard.children.map((c) => nodeToSvg(c, ctx)).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(W)}" height="${n(H)}" viewBox="${n(-b)} ${n(-b)} ${n(W)} ${n(H)}">` +
    `<title>${esc(artboard.name)}</title>${defs}${bg}<g transform="translate(${n(-artboard.x)} ${n(-artboard.y)})">${under}${body}</g></svg>`
  );
}
