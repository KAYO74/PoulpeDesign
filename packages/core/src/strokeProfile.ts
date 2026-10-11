import { flattenCommands } from './bezier';
import type { PathCommand, Vec } from './geometry';
import type { Stroke, WidthProfile } from './types';

/*
 * Contours à largeur variable (pinceau calligraphique d'Affinity et d'Illustrator) : le profil
 * donne l'épaisseur le long du tracé, et le contour devient une forme pleine. Les deux rendus
 * (toile et SVG) utilisent cette même géométrie.
 */

/** Profils proposés dans l'interface, du plus simple au plus marqué. */
export const WIDTH_PROFILES: { id: string; profile: WidthProfile }[] = [
  { id: 'uniform', profile: [1, 1] },
  { id: 'tapered', profile: [0.05, 1, 0.05] },
  { id: 'tipIn', profile: [0.05, 1, 1] },
  { id: 'tipOut', profile: [1, 1, 0.05] },
  { id: 'bulge', profile: [0.35, 1, 0.35] },
  { id: 'waist', profile: [1, 0.25, 1] },
];

export function hasWidthProfile(stroke: Stroke): boolean {
  const p = stroke.profile;
  return !!p && p.length >= 2 && p.some((v) => Math.abs(v - 1) > 1e-6);
}

/** Valeur du profil en `t` (0 au début, 1 à la fin), interpolée en douceur. */
export function profileAt(profile: WidthProfile, t: number): number {
  const k = Math.min(1, Math.max(0, t)) * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(k));
  const f = k - i;
  const smooth = f * f * (3 - 2 * f);
  return profile[i] + (profile[i + 1] - profile[i]) * smooth;
}

/**
 * Positions des points de largeur le long du tracé (0 à 1) : celles posées par l'outil Largeur de
 * trait, sinon réparties régulièrement (profils des versions précédentes et profils prédéfinis).
 */
export function profilePositions(stroke: Stroke): number[] {
  const p = stroke.profile ?? [1, 1];
  const pos = stroke.profilePos;
  if (pos && pos.length === p.length) return pos;
  return p.map((_, i) => (p.length > 1 ? i / (p.length - 1) : 0));
}

/** Largeur relative du contour en `t` (0 au début, 1 à la fin), interpolée en douceur entre ses points. */
export function strokeWidthAt(stroke: Stroke, t: number): number {
  const p = stroke.profile;
  if (!p?.length) return 1;
  const pos = stroke.profilePos;
  if (p.length < 2 || !pos || pos.length !== p.length) return p.length < 2 ? p[0] : profileAt(p, t);
  const k = Math.min(1, Math.max(0, t));
  if (k <= pos[0]) return p[0];
  for (let i = 1; i < p.length; i++) {
    if (k > pos[i]) continue;
    const span = pos[i] - pos[i - 1];
    const f = span > 0 ? (k - pos[i - 1]) / span : 1;
    return p[i - 1] + (p[i] - p[i - 1]) * f * f * (3 - 2 * f);
  }
  return p[p.length - 1];
}

function normal(a: Vec, b: Vec): Vec {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** Normale moyenne au point `i` d'une ligne brisée (pour que les angles ne se pincent pas). */
function pointNormal(pts: Vec[], i: number, closed: boolean): Vec {
  const prev = i > 0 ? normal(pts[i - 1], pts[i]) : closed ? normal(pts[pts.length - 1], pts[0]) : null;
  const next = i < pts.length - 1 ? normal(pts[i], pts[i + 1]) : closed ? normal(pts[i], pts[0]) : null;
  const a = prev ?? next!;
  const b = next ?? prev!;
  const x = a.x + b.x,
    y = a.y + b.y;
  const len = Math.hypot(x, y);
  return len < 1e-6 ? a : { x: x / len, y: y / len };
}

/**
 * Points plus serrés : une droite n'est faite que de ses deux bouts, et le profil n'aurait alors
 * aucun endroit pour varier entre eux.
 */
function densify(pts: Vec[], step: number): Vec[] {
  const out: Vec[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

function pathLength(pts: Vec[]): number {
  let span = 0;
  for (let i = 1; i < pts.length; i++) span += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return span;
}

/** Ajoute un point exactement à chaque point de largeur (`marks`, de 0 à 1 le long du tracé). */
function withMarks(pts: Vec[], marks: number[]): Vec[] {
  const inner = marks.filter((m) => m > 0 && m < 1).sort((a, b) => a - b);
  if (!inner.length) return pts;
  const total = pathLength(pts);
  const out: Vec[] = [pts[0]];
  let k = 0;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    while (k < inner.length && inner[k] * total <= acc + len) {
      const f = len ? (inner[k] * total - acc) / len : 1;
      if (f > 1e-6 && f < 1 - 1e-6) out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      k++;
    }
    out.push(b);
    acc += len;
  }
  return out;
}

function polyline(points: Vec[], close: boolean): PathCommand[] {
  const out: PathCommand[] = [{ op: 'M', x: points[0].x, y: points[0].y }];
  for (const p of points.slice(1)) out.push({ op: 'L', x: p.x, y: p.y });
  if (close) out.push({ op: 'Z' });
  return out;
}

/**
 * Forme pleine d'un contour à largeur variable : les deux côtés du tracé, écartés de la
 * demi-épaisseur locale. Un sous-tracé fermé donne un anneau (deux contours), un sous-tracé
 * ouvert une forme fermée aux extrémités.
 */
export function widthProfileOutline(cmds: PathCommand[], stroke: Stroke): PathCommand[] {
  const half = stroke.width / 2;
  const out: PathCommand[] = [];
  const marks = stroke.profilePos?.length === stroke.profile?.length ? stroke.profilePos! : [];
  for (const sub of flattenCommands(cmds, 0.25)) {
    if (sub.points.length < 2) continue;
    let src = sub.points;
    // Sous-tracé fermé : le profil fait tout le tour, segment de fermeture compris.
    const first = src[0],
      last = src[src.length - 1];
    if (sub.closed && Math.hypot(first.x - last.x, first.y - last.y) > 1e-9) src = [...src, first];
    const pts = withMarks(densify(src, Math.max(0.5, pathLength(src) / 96)), marks);
    // Longueur cumulée : le profil suit la distance parcourue, pas le nombre de points.
    const lens = [0];
    for (let i = 1; i < pts.length; i++)
      lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = lens[lens.length - 1] || 1;
    const n = pts.length;
    // Normale de la jointure d'un tracé fermé : moyenne du dernier segment et du premier.
    const seam = sub.closed ? pointNormal([pts[n - 2], pts[0], pts[1]], 1, false) : null;
    const left: Vec[] = [];
    const right: Vec[] = [];
    for (let i = 0; i < n; i++) {
      const nrm = seam && (i === 0 || i === n - 1) ? seam : pointNormal(pts, i, false);
      const w = half * Math.max(0, strokeWidthAt(stroke, lens[i] / total));
      left.push({ x: pts[i].x + nrm.x * w, y: pts[i].y + nrm.y * w });
      right.push({ x: pts[i].x - nrm.x * w, y: pts[i].y - nrm.y * w });
    }
    if (sub.closed) {
      out.push(...polyline(left, true));
      out.push(...polyline(right.reverse(), true));
    } else {
      out.push(...polyline([...left, ...right.reverse()], true));
    }
  }
  return out;
}

/** Les contours d'un objet, du premier dessiné au dernier (les contours en plus passent dessous). */
export function allStrokes(node: { stroke: Stroke; strokes?: Stroke[] }): Stroke[] {
  return [...(node.strokes ?? []), node.stroke];
}

/** Contours visibles (peinture posée et épaisseur non nulle). */
export function visibleStrokes(node: { stroke: Stroke; strokes?: Stroke[] }): Stroke[] {
  return allStrokes(node).filter((s) => s.paint.type !== 'none' && s.width > 0);
}
