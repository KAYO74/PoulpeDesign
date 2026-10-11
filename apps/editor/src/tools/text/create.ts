import {
  createText,
  displayText,
  distanceToPolylines,
  findArtboard,
  flattenCommands,
  hitNode,
  isStyled,
  measurePath,
  nodeBounds,
  pathToSvg,
  shapePath,
  styleAt,
  cssFont,
  textPathCommands,
  worldToLocal,
  type MeasureText,
  type MeasuredPath,
  type PoulpeDocument,
  type SceneNode,
  type TextNode,
  type Vec,
} from '@poulpe/core';
import { beginTextEdit } from '../../canvas/textEdit';
import { t } from '../../i18n';
import { editor, ui } from '../../store';

/*
 * Création des textes, comme dans Affinity : clic (texte artistique à la taille par défaut),
 * glisser vers le bas (la hauteur devient la taille de la police), clic sur le contour d'une
 * forme (texte sur tracé) et cadre de texte d'un simple clic.
 */

/** Texte artistique à la taille par défaut, la ligne de base près du point cliqué. */
export function artisticTextAt(at: Vec, artboardId: string): void {
  const d = ui.get().defaults;
  const node = createText(
    {
      x: at.x,
      y: at.y - d.text.fontSize * 0.6,
      width: 10,
      height: d.text.fontSize,
      name: t('name.text'),
      autoWidth: true,
    },
    d,
  );
  beginTextEdit(node.id, true, node, artboardId);
}

/** Taille de police donnée par un glissement vertical (en unités du document). */
export function dragFontSize(start: Vec, end: Vec): number {
  return Math.min(2000, Math.max(1, Math.round(Math.abs(end.y - start.y) * 10) / 10));
}

/**
 * Texte artistique dont la police a la hauteur du glissement : le cadratin de la police occupe
 * la hauteur glissée, à partir du point de départ.
 */
export function sizedArtisticText(start: Vec, end: Vec, artboardId: string): void {
  const d = ui.get().defaults;
  const size = dragFontSize(start, end);
  const text = { ...d.text, fontSize: size };
  const h = size * text.lineHeight;
  const node = createText(
    {
      x: start.x,
      y: Math.min(start.y, end.y) - (h - size) / 2,
      width: 10,
      height: h,
      name: t('name.text'),
      autoWidth: true,
    },
    { ...d, text },
  );
  beginTextEdit(node.id, true, node, artboardId);
}

/**
 * Outil Cadre de texte, simple clic : un cadre de taille raisonnable (une douzaine de cadratins
 * sur quatre lignes) qui part du point cliqué et reste dans le plan de travail.
 */
export function clickFrame(at: Vec, artboardId: string): void {
  const d = ui.get().defaults;
  const ab = findArtboard(editor.doc, artboardId);
  const size = d.text.fontSize;
  let w = Math.max(120, Math.round(size * 12));
  let h = Math.max(48, Math.round(size * d.text.lineHeight * 4));
  let x = at.x,
    y = at.y;
  if (ab) {
    w = Math.min(w, ab.width);
    h = Math.min(h, ab.height);
    x = Math.max(ab.x, Math.min(x, ab.x + ab.width - w));
    y = Math.max(ab.y, Math.min(y, ab.y + ab.height - h));
  }
  const node = createText({ x, y, width: w, height: h, name: t('name.text'), autoWidth: false }, d);
  node.frame = true;
  beginTextEdit(node.id, true, node, artboardId);
}

// ————— Texte sur tracé —————

const outlines = new WeakMap<SceneNode, ReturnType<typeof flattenCommands>>();

function outline(n: SceneNode) {
  let f = outlines.get(n);
  if (!f) {
    f = flattenCommands(shapePath(n), 0.5);
    if (Object.isFrozen(n)) outlines.set(n, f);
  }
  return f;
}

/** Une forme dont le contour peut porter un texte (pas un texte, une image ni un groupe). */
function carriesText(n: SceneNode): boolean {
  return isStyled(n) && n.type !== 'text';
}

/**
 * Forme dont le contour passe à moins de `tol` du point, la plus haute dans les calques. Un objet
 * posé au-dessus cache les contours de ceux du dessous.
 */
export function outlineAt(
  doc: PoulpeDocument,
  p: Vec,
  tol: number,
): { node: SceneNode; artboardId: string } | null {
  // undefined : rien sous le point ; null : un objet cache le contour.
  const search = (nodes: SceneNode[]): SceneNode | null | undefined => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!n.visible || n.locked) continue;
      if (n.type === 'group') {
        const r = search(n.children);
        if (r !== undefined) return r;
        continue;
      }
      if (carriesText(n) && isStyled(n)) {
        const reach = Math.max(tol, n.stroke.paint.type !== 'none' ? n.stroke.width / 2 : 0);
        const b = nodeBounds(n);
        const near =
          p.x >= b.x - reach &&
          p.y >= b.y - reach &&
          p.x <= b.x + b.width + reach &&
          p.y <= b.y + b.height + reach;
        if (near && distanceToPolylines(outline(n), worldToLocal(n, p)) <= reach) return n;
      }
      if (hitNode(n, p)) return null;
    }
    return undefined;
  };
  for (let a = doc.artboards.length - 1; a >= 0; a--) {
    const ab = doc.artboards[a];
    if (p.x < ab.x - tol || p.y < ab.y - tol || p.x > ab.x + ab.width + tol || p.y > ab.y + ab.height + tol)
      continue;
    const found = search(ab.children);
    if (found !== undefined) return found ? { node: found, artboardId: ab.id } : null;
  }
  return null;
}

/** Distance le long du premier sous-tracé jusqu'au point le plus proche de `l` (repère local). */
function distanceAlong(n: SceneNode, l: Vec): number {
  const poly = flattenCommands(shapePath(n), 0.25)[0];
  if (!poly) return 0;
  const pts = poly.closed && poly.points.length ? [...poly.points, poly.points[0]] : poly.points;
  let best = Infinity,
    at = 0,
    acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const k = len ? Math.max(0, Math.min(1, ((l.x - a.x) * dx + (l.y - a.y) * dy) / (len * len))) : 0;
    const d = Math.hypot(l.x - (a.x + k * dx), l.y - (a.y + k * dy));
    if (d < best) {
      best = d;
      at = acc + k * len;
    }
    acc += len;
  }
  return at;
}

/**
 * Clic sur le contour d'une forme : un texte vide suit ce tracé à partir du point cliqué. Comme
 * l'action « Placer le texte sur le tracé », le texte prend la place de la forme ; s'il reste
 * vide, la forme revient.
 */
export function startPathText(shape: SceneNode, artboardId: string, at: Vec): void {
  const d = ui.get().defaults;
  const node = createText(
    {
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      name: t('name.text'),
      autoWidth: false,
    },
    d,
  );
  node.rotation = shape.rotation;
  const cmds = shapePath(shape);
  const length = measurePath(cmds).length;
  node.path = {
    d: pathToSvg(cmds),
    viewBox: { x: 0, y: 0, width: shape.width || 1, height: shape.height || 1 },
    offset: length > 0 ? Math.min(1, distanceAlong(shape, worldToLocal(shape, at)) / length) : 0,
  };
  // Le texte part du point cliqué : un texte justifié se place comme un texte aligné à gauche.
  if (node.style.align === 'justify') node.style = { ...node.style, align: 'left' };
  beginTextEdit(node.id, true, node, artboardId, shape.id);
}

/**
 * Position du curseur sur un texte sur tracé : pour chaque indice du texte, la distance le long
 * de la courbe (même calcul que `layoutTextOnPath`).
 */
export function pathCaretStops(
  node: TextNode,
  measure: MeasureText,
): { path: MeasuredPath; stops: number[] } {
  const path = measurePath(textPathCommands(node));
  const text = displayText(node).replace(/\r?\n/g, ' ');
  const advances: number[] = [];
  let total = 0;
  let last = 0;
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const style = styleAt(node, i);
    const adv = measure(ch, cssFont(style)) + style.letterSpacing;
    advances.push(adv);
    if (ch.length > 1) advances.push(0);
    total += adv;
    last = style.letterSpacing;
    i += ch.length;
  }
  if (text.length) total -= last;
  const anchor = Math.min(1, Math.max(0, node.path?.offset ?? 0)) * path.length;
  const align = node.style.align;
  let s = align === 'center' ? anchor - total / 2 : align === 'right' ? anchor - total : anchor;
  const stops = [s];
  for (const a of advances) stops.push((s += a));
  return { path, stops };
}
