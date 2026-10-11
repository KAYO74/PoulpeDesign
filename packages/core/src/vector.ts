import { localToWorld, shapePath, type PathCommand, type Vec } from './geometry';
import { activeContour } from './contour';
import { commandsToCubics, flattenCommands } from './bezier';
import { setPathCommands } from './pathEdit';
import { cachedSvgPath, fitCommands } from './path';
import { cssFont, displayText, styleAt, type CharStyle, type MeasureText } from './text';
import { isStyled } from './tree';
import type { ArrowHead, PathNode, SceneNode, Stroke, StrokeCap, StrokeJoin, TextNode } from './types';

/*
 * Outils du vectoriel : contours avancés (flèches), conversion en courbes, contour d'un objet dans
 * le monde, courbe d'un texte sur tracé.
 */

/** Copie profonde de données JSON ; contrairement à `structuredClone`, accepte les brouillons immer. */
export function cloneData<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const strokeCap = (s: Stroke): StrokeCap => s.cap ?? 'round';
export const strokeJoin = (s: Stroke): StrokeJoin => s.join ?? 'round';

/** Pointillés en pixels, ou liste vide pour un trait plein. */
export function dashPattern(s: Stroke): number[] {
  if (!s.dash?.length) return [];
  const w = Math.max(s.width, 0.1);
  const out = s.dash.map((v) => Math.max(0, v) * w);
  // Un motif tout à zéro ne dessinerait rien : trait plein.
  return out.some((v) => v > 0) ? out : [];
}

export const ARROW_HEADS: ArrowHead[] = ['none', 'triangle', 'arrow', 'circle', 'square', 'bar'];

const DISTINCT = 1e-6;

/** Extrémités d'un tracé ouvert : point et direction vers l'extérieur. */
export function openEnds(cmds: PathCommand[]): {
  start: { p: Vec; dir: Vec } | null;
  end: { p: Vec; dir: Vec } | null;
} {
  const subs = commandsToCubics(cmds).filter((s) => s.cubics.length);
  const first = subs[0],
    last = subs[subs.length - 1];
  const unit = (from: Vec, to: Vec): Vec | null => {
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const l = Math.hypot(dx, dy);
    return l > DISTINCT ? { x: dx / l, y: dy / l } : null;
  };
  let start: { p: Vec; dir: Vec } | null = null;
  let end: { p: Vec; dir: Vec } | null = null;
  if (first && !first.closed) {
    const b = first.cubics[0];
    const p = b[0];
    const dir = unit(b[1], p) ?? unit(b[2], p) ?? unit(b[3], p);
    if (dir) start = { p, dir };
  }
  if (last && !last.closed) {
    const b = last.cubics[last.cubics.length - 1];
    const p = b[3];
    const dir = unit(b[2], p) ?? unit(b[1], p) ?? unit(b[0], p);
    if (dir) end = { p, dir };
  }
  return { start, end };
}

/** Forme pleine d'une flèche, pointe vers +x, base autour de l'origine ; `k` = épaisseur du trait. */
function arrowShape(kind: ArrowHead, k: number): PathCommand[] {
  const poly = (pts: [number, number][]): PathCommand[] => [
    ...pts.map(([x, y], i) => ({ op: i ? 'L' : 'M', x: x * k, y: y * k }) as PathCommand),
    { op: 'Z' },
  ];
  switch (kind) {
    case 'triangle':
      return poly([
        [-0.5, -2],
        [3, 0],
        [-0.5, 2],
      ]);
    case 'arrow':
      return poly([
        [3, 0],
        [-1, -2.2],
        [0.2, 0],
        [-1, 2.2],
      ]);
    case 'square':
      return poly([
        [-1.5, -1.5],
        [1.5, -1.5],
        [1.5, 1.5],
        [-1.5, 1.5],
      ]);
    case 'bar':
      return poly([
        [-0.5, -2.5],
        [0.5, -2.5],
        [0.5, 2.5],
        [-0.5, 2.5],
      ]);
    case 'circle': {
      const r = 1.6 * k,
        c = r * 0.5522847498;
      return [
        { op: 'M', x: r, y: 0 },
        { op: 'C', x1: r, y1: c, x2: c, y2: r, x: 0, y: r },
        { op: 'C', x1: -c, y1: r, x2: -r, y2: c, x: -r, y: 0 },
        { op: 'C', x1: -r, y1: -c, x2: -c, y2: -r, x: 0, y: -r },
        { op: 'C', x1: c, y1: -r, x2: r, y2: -c, x: r, y: 0 },
        { op: 'Z' },
      ];
    }
    default:
      return [];
  }
}

/** Flèches d'un tracé ouvert, à remplir avec la peinture du contour. */
export function arrowPaths(cmds: PathCommand[], stroke: Stroke): PathCommand[] {
  if ((!stroke.start || stroke.start === 'none') && (!stroke.end || stroke.end === 'none')) return [];
  if (stroke.paint.type === 'none' || stroke.width <= 0) return [];
  const { start, end } = openEnds(cmds);
  const k = Math.max(stroke.width, 1);
  const out: PathCommand[] = [];
  const place = (kind: ArrowHead | undefined, at: { p: Vec; dir: Vec } | null) => {
    if (!kind || kind === 'none' || !at) return;
    const { p, dir: u } = at;
    const map = (x: number, y: number) => ({ x: p.x + u.x * x - u.y * y, y: p.y + u.y * x + u.x * y });
    for (const c of arrowShape(kind, k)) {
      if (c.op === 'Z') out.push(c);
      else if (c.op === 'C') {
        const a = map(c.x1, c.y1),
          b = map(c.x2, c.y2),
          e = map(c.x, c.y);
        out.push({ op: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: e.x, y: e.y });
      } else {
        const e = map(c.x, c.y);
        out.push({ op: c.op, x: e.x, y: e.y });
      }
    }
  };
  place(stroke.start, start);
  place(stroke.end, end);
  return out;
}

/** Applique une fonction de point à toutes les coordonnées d'un tracé. */
export function mapCommands(cmds: PathCommand[], f: (p: Vec) => Vec): PathCommand[] {
  return cmds.map((c) => {
    if (c.op === 'Z') return c;
    if (c.op === 'C') {
      const a = f({ x: c.x1, y: c.y1 }),
        b = f({ x: c.x2, y: c.y2 }),
        e = f({ x: c.x, y: c.y });
      return { op: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: e.x, y: e.y };
    }
    const e = f({ x: c.x, y: c.y });
    return { op: c.op, x: e.x, y: e.y };
  });
}

/** Contour d'un objet dans le monde (les groupes réunissent leurs enfants). Null pour un texte ou une image. */
export function worldOutline(node: SceneNode): PathCommand[] | null {
  if (!node.visible) return [];
  if (node.type === 'group') {
    const parts = node.children.map(worldOutline);
    if (parts.some((p) => p === null)) return null;
    return parts.flat() as PathCommand[];
  }
  if (node.type === 'text' || node.type === 'image' || node.type === 'adjustment') return null;
  return mapCommands(shapePath(node), (p) => localToWorld(node, p));
}

/**
 * Convertit une forme en tracé modifiable, en gardant son identifiant, sa place et son style.
 * Le contour (outil Contour) est appliqué au tracé. Renvoie null pour un texte (il faut ses
 * polices), une image ou un groupe.
 */
export function toPathNode(node: SceneNode): PathNode | null {
  if (node.type === 'path') {
    const p = cloneData(node) as PathNode;
    if (!node.contour) return p;
    delete p.contour;
    if (activeContour(node)) {
      p.viewBox = { x: 0, y: 0, width: node.width, height: node.height };
      delete p.smartNodes;
      setPathCommands(p, shapePath(node));
    }
    return p;
  }
  if (!isStyled(node) || node.type === 'text') return null;
  const p: PathNode = {
    id: node.id,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    opacity: node.opacity,
    blendMode: node.blendMode,
    visible: node.visible,
    locked: node.locked,
    ...(node.effects ? { effects: cloneData(node.effects) } : {}),
    type: 'path',
    fill: node.type === 'line' ? { type: 'none' } : node.fill,
    stroke: node.stroke,
    d: '',
    viewBox: { x: 0, y: 0, width: node.width, height: node.height },
  };
  setPathCommands(p, shapePath(node));
  return p;
}

// ————— Texte sur tracé —————

/** Courbe d'un texte sur tracé, dans le repère local du texte. */
export function textPathCommands(node: TextNode): PathCommand[] {
  if (!node.path) return [];
  return fitCommands(cachedSvgPath(node.path.d), node.path.viewBox, {
    x: 0,
    y: 0,
    width: node.width,
    height: node.height,
  });
}

/** Courbe mesurée : on y place des caractères à une distance donnée du début. */
export interface MeasuredPath {
  length: number;
  closed: boolean;
  /** Point et angle (radians) à la distance `s` ; null hors de la courbe (tracé ouvert). */
  at(s: number): { x: number; y: number; angle: number } | null;
}

export function measurePath(cmds: PathCommand[]): MeasuredPath {
  // Seul le premier sous-tracé porte le texte.
  const poly = flattenCommands(cmds, 0.25)[0] ?? { points: [], closed: false };
  const pts = poly.closed && poly.points.length ? [...poly.points, poly.points[0]] : poly.points;
  const acc: number[] = [0];
  for (let i = 1; i < pts.length; i++)
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const length = acc[acc.length - 1] ?? 0;
  return {
    length,
    closed: poly.closed,
    at(s: number) {
      if (pts.length < 2 || length <= 0) return null;
      if (poly.closed) s = ((s % length) + length) % length;
      else if (s < -0.01 || s > length + 0.01) return null;
      let lo = 0,
        hi = acc.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (acc[mid] <= s) lo = mid;
        else hi = mid;
      }
      const a = pts[lo],
        b = pts[hi];
      const seg = acc[hi] - acc[lo] || 1;
      const t = Math.min(1, Math.max(0, (s - acc[lo]) / seg));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    },
  };
}

/** Caractère placé sur une courbe : `x`, `y` est le milieu de sa ligne de base, `angle` en radians. */
export interface PathGlyph {
  index: number;
  char: string;
  x: number;
  y: number;
  angle: number;
  /** Largeur du caractère seul (sans l'interlettrage). */
  width: number;
  style: CharStyle;
  font: string;
}

/** Place les caractères d'un texte sur sa courbe (repère local du texte), sur une seule ligne. */
export function layoutTextOnPath(node: TextNode, measure: MeasureText): PathGlyph[] {
  if (!node.path) return [];
  const path = measurePath(textPathCommands(node));
  if (path.length <= 0) return [];
  const text = displayText(node).replace(/\r?\n/g, ' ');
  const chars: {
    index: number;
    char: string;
    width: number;
    advance: number;
    style: CharStyle;
    font: string;
  }[] = [];
  let total = 0;
  let i = 0;
  for (const char of text) {
    const style = styleAt(node, i);
    const font = cssFont(style);
    const width = measure(char, font);
    const advance = width + style.letterSpacing;
    chars.push({ index: i, char, width, advance, style, font });
    total += advance;
    i += char.length;
  }
  if (chars.length) total -= chars[chars.length - 1].style.letterSpacing;
  const anchor = Math.min(1, Math.max(0, node.path.offset)) * path.length;
  const align = node.style.align;
  let s = align === 'center' ? anchor - total / 2 : align === 'right' ? anchor - total : anchor;
  const out: PathGlyph[] = [];
  for (const c of chars) {
    const at = path.at(s + c.width / 2);
    if (at && c.char.trim())
      out.push({
        index: c.index,
        char: c.char,
        x: at.x,
        y: at.y,
        angle: at.angle,
        width: c.width,
        style: c.style,
        font: c.font,
      });
    s += c.advance;
  }
  return out;
}
