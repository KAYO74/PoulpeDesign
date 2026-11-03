import { pathNodeFromWorld } from './boolean';
import { formatColor, parseColor } from './color';
import { createGroup } from './factory';
import type { PathCommand, Vec } from './geometry';
import { groupNodes, isStyled, topLevelIds, walkDocument } from './tree';
import type { Paint, PoulpeDocument, SceneNode, Stroke } from './types';
import { cloneData, worldOutline } from './vector';

/*
 * Dégradé de formes (outil Dégradé d'Illustrator) : entre deux formes, des formes intermédiaires
 * dont le contour, la couleur, le trait et l'opacité passent progressivement de l'une à l'autre.
 *
 * Si les deux contours ont les mêmes nœuds (une copie modifiée, par exemple), chaque nœud glisse
 * vers son correspondant. Sinon, chaque contour est redécoupé en points régulièrement espacés,
 * mis en correspondance au mieux (même sens, départ le plus proche).
 */

const SAMPLES = 120;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Les deux contours ont-ils exactement la même suite d'instructions ? */
function sameStructure(a: PathCommand[], b: PathCommand[]): boolean {
  return a.length === b.length && a.every((c, i) => c.op === b[i].op);
}

function lerpCommands(a: PathCommand[], b: PathCommand[], t: number): PathCommand[] {
  return a.map((c, i) => {
    const d = b[i];
    if (c.op === 'Z' || d.op === 'Z') return { op: 'Z' };
    if (c.op === 'C' && d.op === 'C')
      return {
        op: 'C',
        x1: lerp(c.x1, d.x1, t),
        y1: lerp(c.y1, d.y1, t),
        x2: lerp(c.x2, d.x2, t),
        y2: lerp(c.y2, d.y2, t),
        x: lerp(c.x, d.x, t),
        y: lerp(c.y, d.y, t),
      };
    return { op: c.op as 'M' | 'L', x: lerp(c.x, (d as Vec).x, t), y: lerp(c.y, (d as Vec).y, t) };
  });
}

/** Premier sous-tracé, aplati en ligne brisée (fermée si le tracé l'est). */
function flatten(cmds: PathCommand[]): { pts: Vec[]; closed: boolean } {
  const pts: Vec[] = [];
  let closed = false;
  let cur: Vec = { x: 0, y: 0 };
  for (const c of cmds) {
    if (c.op === 'M') {
      if (pts.length) break;
      cur = { x: c.x, y: c.y };
      pts.push(cur);
    } else if (c.op === 'L') {
      cur = { x: c.x, y: c.y };
      pts.push(cur);
    } else if (c.op === 'C') {
      const p0 = cur;
      for (let k = 1; k <= 16; k++) {
        const t = k / 16,
          u = 1 - t;
        pts.push({
          x: u * u * u * p0.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          y: u * u * u * p0.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        });
      }
      cur = { x: c.x, y: c.y };
    } else {
      closed = true;
      break;
    }
  }
  return { pts, closed };
}

/** `n` points régulièrement espacés le long de la ligne brisée. */
function resample(pts: Vec[], closed: boolean, n: number): Vec[] {
  const path = closed && pts.length > 1 ? [...pts, pts[0]] : pts;
  if (path.length < 2) return Array.from({ length: n }, () => ({ ...(pts[0] ?? { x: 0, y: 0 }) }));
  const acc = [0];
  for (let i = 1; i < path.length; i++)
    acc.push(acc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = acc[acc.length - 1] || 1;
  const out: Vec[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = (k / (closed ? n : n - 1)) * total;
    while (j < acc.length - 1 && acc[j] < s) j++;
    const seg = acc[j] - acc[j - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - acc[j - 1]) / seg));
    out.push({ x: lerp(path[j - 1].x, path[j].x, t), y: lerp(path[j - 1].y, path[j].y, t) });
  }
  return out;
}

const signedArea = (p: Vec[]) =>
  p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0);

/** Points de `b` dans le même sens que `a` et décalés pour que les départs se correspondent. */
function align(a: Vec[], b: Vec[], closed: boolean): Vec[] {
  let q = b;
  if (closed && Math.sign(signedArea(a)) !== Math.sign(signedArea(b))) q = [...b].reverse();
  if (!closed) {
    const direct = Math.hypot(a[0].x - q[0].x, a[0].y - q[0].y);
    const flipped = Math.hypot(a[0].x - q[q.length - 1].x, a[0].y - q[q.length - 1].y);
    return flipped < direct ? [...q].reverse() : q;
  }
  // Décalage qui rend la somme des distances la plus petite (après recentrage des deux formes).
  const ca = centroid(a),
    cb = centroid(q);
  let best = 0,
    bestD = Infinity;
  for (let s = 0; s < q.length; s++) {
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      const p = q[(i + s) % q.length];
      d += Math.hypot(a[i].x - ca.x - (p.x - cb.x), a[i].y - ca.y - (p.y - cb.y));
      if (d >= bestD) break;
    }
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return q.map((_, i) => q[(i + best) % q.length]);
}

function centroid(p: Vec[]): Vec {
  const s = p.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }), { x: 0, y: 0 });
  return { x: s.x / p.length, y: s.y / p.length };
}

/** Contours intermédiaires entre `a` et `b` (coordonnées du monde), `steps` formes. */
export function blendOutlines(a: PathCommand[], b: PathCommand[], steps: number): PathCommand[][] {
  const n = Math.max(1, Math.round(steps));
  const ts = Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
  if (sameStructure(a, b)) return ts.map((t) => lerpCommands(a, b, t));
  const fa = flatten(a),
    fb = flatten(b);
  const closed = fa.closed && fb.closed;
  const pa = resample(fa.pts, closed, SAMPLES);
  const pb = align(pa, resample(fb.pts, closed, SAMPLES), closed);
  return ts.map((t) => {
    const cmds: PathCommand[] = pa.map((p, i) => ({
      op: i ? 'L' : 'M',
      x: lerp(p.x, pb[i].x, t),
      y: lerp(p.y, pb[i].y, t),
    }));
    if (closed) cmds.push({ op: 'Z' });
    return cmds;
  });
}

function lerpColor(a: string, b: string, t: number): string {
  const ca = parseColor(a),
    cb = parseColor(b);
  return formatColor({
    r: Math.round(lerp(ca.r, cb.r, t)),
    g: Math.round(lerp(ca.g, cb.g, t)),
    b: Math.round(lerp(ca.b, cb.b, t)),
    a: lerp(ca.a, cb.a, t),
  });
}

/** Couleur intermédiaire ; un dégradé ou « aucun » passe d'un coup à mi-chemin. */
export function lerpPaint(a: Paint, b: Paint, t: number): Paint {
  if (a.type === 'solid' && b.type === 'solid')
    return { type: 'solid', color: lerpColor(a.color, b.color, t) };
  if (a.type === 'solid' && b.type === 'none')
    return { type: 'solid', color: lerpColor(a.color, withAlpha0(a.color), t) };
  if (a.type === 'none' && b.type === 'solid')
    return { type: 'solid', color: lerpColor(withAlpha0(b.color), b.color, t) };
  return cloneData(t < 0.5 ? a : b);
}

function withAlpha0(c: string): string {
  return formatColor({ ...parseColor(c), a: 0 });
}

function lerpStroke(a: Stroke, b: Stroke, t: number): Stroke {
  const out = cloneData(t < 0.5 ? a : b);
  out.paint = lerpPaint(a.paint, b.paint, t);
  out.width = lerp(a.width, b.width, t);
  return out;
}

/** Les objets sélectionnés peuvent-ils être fondus (exactement deux formes) ? */
export function canBlend(doc: PoulpeDocument, ids: string[]): boolean {
  const top = new Set(topLevelIds(doc, ids));
  const nodes = [...walkDocument(doc)].filter((l) => top.has(l.node.id)).map((l) => l.node);
  return nodes.length === 2 && nodes.every((n) => isStyled(n) && n.type !== 'text' && !n.locked);
}

/**
 * Crée `steps` formes entre les deux objets sélectionnés, et regroupe le tout (du dessous au
 * dessus : la première forme, les intermédiaires, la seconde). Renvoie l'id du groupe.
 */
export function applyBlend(doc: PoulpeDocument, ids: string[], steps: number, name: string): string | null {
  if (!canBlend(doc, ids)) return null;
  const top = new Set(topLevelIds(doc, ids));
  const [la, lb] = [...walkDocument(doc)].filter((l) => top.has(l.node.id));
  const a = la.node,
    b = lb.node;
  if (!isStyled(a) || !isStyled(b)) return null;
  const oa = worldOutline(a),
    ob = worldOutline(b);
  if (!oa?.length || !ob?.length) return null;
  const outlines = blendOutlines(oa, ob, steps);
  const made: SceneNode[] = outlines.map((cmds, i) => {
    const t = (i + 1) / (outlines.length + 1);
    const node = pathNodeFromWorld(cmds, a, `${name} ${i + 1}`);
    node.fillRule = 'nonzero';
    node.fill = lerpPaint(a.fill, b.fill, t);
    node.stroke = lerpStroke(a.stroke, b.stroke, t);
    node.opacity = lerp(a.opacity, b.opacity, t);
    return node;
  });
  // Les intermédiaires se glissent juste sous la seconde forme, puis tout est regroupé.
  lb.parent.children.splice(lb.index, 0, ...made);
  return groupNodes(doc, [a.id, ...made.map((n) => n.id), b.id], createGroup([], name));
}
