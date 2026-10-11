import { commandsToCubics, cubicDerivative, cubicPoint, exactBounds, splitCubic, type Cubic } from './bezier';
import { fitCommands } from './path';
import type { PathCommand, Vec } from './geometry';
import type { Corner, Corners, RectNode, ShapeKind, ShapeSpec } from './types';

/*
 * Formes paramétriques (triangle, flèche, bulle, anneau, secteur, engrenage, nuage, cœur,
 * spirale) et coins non destructifs (outil Coin, coins des rectangles).
 *
 * Tout est calculé dans le repère local de l'objet (0..largeur, 0..hauteur), en pixels : la forme
 * est recalculée à chaque taille, si bien qu'un coin de 20 px reste de 20 px quand la boîte
 * s'étire. Ce fichier n'importe rien de geometry.ts, qui s'en sert pour `shapePath`.
 */

const EPS = 1e-6;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const pt = (x: number, y: number): Vec => ({ x, y });
const sub = (a: Vec, b: Vec): Vec => pt(a.x - b.x, a.y - b.y);
const plus = (a: Vec, b: Vec, k = 1): Vec => pt(a.x + b.x * k, a.y + b.y * k);
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const line = (p: Vec): PathCommand => ({ op: 'L', x: p.x, y: p.y });
const curve = (a: Vec, b: Vec, p: Vec): PathCommand => ({
  op: 'C',
  x1: a.x,
  y1: a.y,
  x2: b.x,
  y2: b.y,
  x: p.x,
  y: p.y,
});

function unit(v: Vec): Vec | null {
  const l = Math.hypot(v.x, v.y);
  return l < EPS ? null : pt(v.x / l, v.y / l);
}

// ————— Réglages des formes —————

export interface ShapeParamDef {
  key: string;
  def: number;
  min: number;
  max: number;
  /** Affichage : `%` (valeur × 100), `°`, `px`, ou un simple nombre (entier si `int`). */
  unit: '%' | '°' | 'px' | '';
  int?: boolean;
}

export const SHAPE_KINDS: ShapeKind[] = [
  'triangle',
  'arrow',
  'callout',
  'donut',
  'pie',
  'cog',
  'cloud',
  'heart',
  'spiral',
];

/** Réglages de chaque forme, avec leur valeur par défaut et leurs bornes. */
export const SHAPE_PARAMS: Record<ShapeKind, ShapeParamDef[]> = {
  // Position du sommet, en part de la largeur.
  triangle: [{ key: 'apex', def: 0.5, min: 0, max: 1, unit: '%' }],
  // Longueur de la pointe (part de la largeur) et épaisseur du corps (part de la hauteur).
  arrow: [
    { key: 'head', def: 0.4, min: 0.02, max: 1, unit: '%' },
    { key: 'shaft', def: 0.4, min: 0.02, max: 1, unit: '%' },
  ],
  // Arrondi du corps, pointe de la queue, base et largeur de la queue, hauteur de la queue.
  callout: [
    { key: 'radius', def: 16, min: 0, max: 10000, unit: 'px' },
    { key: 'tipX', def: 0.2, min: 0, max: 1, unit: '%' },
    { key: 'baseX', def: 0.35, min: 0, max: 1, unit: '%' },
    { key: 'tailWidth', def: 0.2, min: 0.02, max: 1, unit: '%' },
    { key: 'tail', def: 0.25, min: 0.02, max: 0.9, unit: '%' },
  ],
  // Taille du trou, en part du rayon.
  donut: [{ key: 'hole', def: 0.5, min: 0, max: 0.98, unit: '%' }],
  // Angles de début et de fin (degrés, sens horaire depuis midi) et trou éventuel.
  pie: [
    { key: 'start', def: 0, min: 0, max: 360, unit: '°' },
    { key: 'end', def: 270, min: 0, max: 360, unit: '°' },
    { key: 'hole', def: 0, min: 0, max: 0.98, unit: '%' },
  ],
  // Nombre de dents, profondeur des dents et trou central (parts du rayon).
  cog: [
    { key: 'teeth', def: 12, min: 3, max: 100, unit: '', int: true },
    { key: 'depth', def: 0.2, min: 0.02, max: 0.9, unit: '%' },
    { key: 'hole', def: 0.3, min: 0, max: 0.9, unit: '%' },
  ],
  // Nombre de bosses et rondeur des bosses.
  cloud: [
    { key: 'bumps', def: 9, min: 3, max: 40, unit: '', int: true },
    { key: 'puff', def: 0.6, min: 0.1, max: 1.5, unit: '%' },
  ],
  // Profondeur du creux du haut, en part de la hauteur.
  heart: [{ key: 'cleft', def: 0.28, min: 0, max: 0.6, unit: '%' }],
  // Nombre de tours et rayon de départ (part du rayon).
  spiral: [
    { key: 'turns', def: 3, min: 0.25, max: 30, unit: '' },
    { key: 'inner', def: 0, min: 0, max: 0.95, unit: '%' },
  ],
};

export function shapeParamDef(kind: ShapeKind, key: string): ShapeParamDef | undefined {
  return SHAPE_PARAMS[kind]?.find((p) => p.key === key);
}

/** Valeur d'un réglage : celle de la forme, bornée, ou la valeur par défaut. */
export function shapeParam(spec: ShapeSpec, key: string): number {
  const def = shapeParamDef(spec.kind, key);
  const v = spec.params[key];
  if (!def) return Number.isFinite(v) ? v : 0;
  const c = clamp(Number.isFinite(v) ? v : def.def, def.min, def.max);
  return def.int ? Math.round(c) : c;
}

export function defaultShapeParams(kind: ShapeKind): Record<string, number> {
  return Object.fromEntries(SHAPE_PARAMS[kind].map((p) => [p.key, p.def]));
}

// ————— Contours des formes —————

/** Point d'une ellipse à l'angle `a` (radians, sens horaire depuis midi). */
function onEllipse(cx: number, cy: number, rx: number, ry: number, a: number): Vec {
  return pt(cx + rx * Math.sin(a), cy - ry * Math.cos(a));
}

/** Arc d'ellipse de l'angle `a0` à `a1`, en courbes de Bézier (sans le point de départ). */
function arcTo(out: PathCommand[], cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const step = (a1 - a0) / n;
  const k = (4 / 3) * Math.tan(step / 4);
  for (let i = 0; i < n; i++) {
    const s = a0 + i * step,
      e = s + step;
    const p0 = onEllipse(cx, cy, rx, ry, s),
      p1 = onEllipse(cx, cy, rx, ry, e);
    // Dérivée de l'ellipse : (rx cos a, ry sin a).
    out.push(
      curve(
        pt(p0.x + k * rx * Math.cos(s), p0.y + k * ry * Math.sin(s)),
        pt(p1.x - k * rx * Math.cos(e), p1.y - k * ry * Math.sin(e)),
        p1,
      ),
    );
  }
}

/** Ellipse complète ; `reverse` la parcourt dans l'autre sens (pour un trou). */
function ellipseLoop(out: PathCommand[], cx: number, cy: number, rx: number, ry: number, reverse: boolean) {
  const p = onEllipse(cx, cy, rx, ry, 0);
  out.push({ op: 'M', x: p.x, y: p.y });
  arcTo(out, cx, cy, rx, ry, 0, reverse ? -TAU : TAU);
  out.push({ op: 'Z' });
}

function polygon(out: PathCommand[], pts: Vec[]) {
  pts.forEach((p, i) => out.push({ op: i ? 'L' : 'M', x: p.x, y: p.y }));
  out.push({ op: 'Z' });
}

/** Sommets d'un polygone régulier inscrit dans la boîte, le premier en haut. */
export function regularVertices(n: number, w: number, h: number, inner?: number): Vec[] {
  const pts: Vec[] = [];
  const count = inner === undefined ? n : n * 2;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * TAU) / count;
    const r = inner !== undefined && i % 2 === 1 ? inner : 1;
    pts.push(pt(w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2));
  }
  return pts;
}

/** Part de la longueur d'un côté dont s'écartent les poignées d'un côté courbe (réglage 1). */
export const POLYGON_BULGE = 0.35;

/** Polygone régulier aux côtés courbes : `curve` de -1 (creusés) à 1 (bombés). */
export function polygonOutline(sides: number, curveAmount: number, w: number, h: number): PathCommand[] {
  const pts = regularVertices(Math.max(3, Math.round(sides)), w, h);
  const c = clamp(curveAmount, -1, 1);
  const center = pt(w / 2, h / 2);
  const out: PathCommand[] = [{ op: 'M', x: pts[0].x, y: pts[0].y }];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const ab = sub(b, a);
    let nrm = unit(pt(ab.y, -ab.x));
    if (!c || !nrm) {
      out.push(line(b));
      return;
    }
    if (dot(nrm, sub(plus(a, ab, 0.5), center)) < 0) nrm = pt(-nrm.x, -nrm.y);
    const o = c * Math.hypot(ab.x, ab.y) * POLYGON_BULGE;
    out.push(curve(plus(plus(a, ab, 1 / 3), nrm, o), plus(plus(a, ab, 2 / 3), nrm, o), b));
  });
  out.push({ op: 'Z' });
  return out;
}

/** Contour de base d'un rectangle (avant ses coins), du coin haut gauche dans le sens horaire. */
export function rectBase(w: number, h: number): PathCommand[] {
  const out: PathCommand[] = [];
  polygon(out, [pt(0, 0), pt(w, 0), pt(w, h), pt(0, h)]);
  return out;
}

/** Corps et queue d'une bulle : sommets du contour (avant l'arrondi du corps). */
export function calloutVertices(spec: ShapeSpec, w: number, h: number): Vec[] {
  const p = (k: string) => shapeParam(spec, k);
  const bh = h * (1 - p('tail'));
  const half = (p('tailWidth') * w) / 2;
  const bx = clamp(p('baseX') * w, half, w - half);
  return [
    pt(0, 0),
    pt(w, 0),
    pt(w, bh),
    pt(bx + half, bh),
    pt(p('tipX') * w, h),
    pt(bx - half, bh),
    pt(0, bh),
  ];
}

/** Géométrie d'un nuage avant sa mise à la taille de la boîte (cercle de rayon 1 centré en 0). */
function cloudRaw(n: number, puff: number): PathCommand[] {
  const step = TAU / n;
  const at = (i: number) => {
    const a = (i + 0.5) * step;
    return pt(Math.sin(a), -Math.cos(a));
  };
  const raw: PathCommand[] = [];
  const first = at(0);
  raw.push({ op: 'M', x: first.x, y: first.y });
  for (let i = 0; i < n; i++) {
    const a = at(i),
      b = at(i + 1);
    const k = dist(a, b) * puff;
    // Les poignées partent vers l'extérieur : chaque bosse est un lobe, les creux restent pointus.
    raw.push(curve(plus(a, a, k), plus(b, b, k), b));
  }
  raw.push({ op: 'Z' });
  return raw;
}

function buildShape(spec: ShapeSpec, w: number, h: number): PathCommand[] {
  const p = (k: string) => shapeParam(spec, k);
  const out: PathCommand[] = [];
  const cx = w / 2,
    cy = h / 2,
    rx = w / 2,
    ry = h / 2;
  switch (spec.kind) {
    case 'triangle':
      polygon(out, [pt(p('apex') * w, 0), pt(w, h), pt(0, h)]);
      return out;
    case 'arrow': {
      const xb = w * (1 - p('head'));
      const y0 = (h * (1 - p('shaft'))) / 2,
        y1 = h - y0;
      polygon(out, [pt(0, y0), pt(xb, y0), pt(xb, 0), pt(w, cy), pt(xb, h), pt(xb, y1), pt(0, y1)]);
      return out;
    }
    case 'callout': {
      polygon(out, calloutVertices(spec, w, h));
      const r = p('radius');
      if (r <= 0) return out;
      const c: Corner = { radius: r };
      // Seuls les quatre coins du corps s'arrondissent, pas la queue.
      return applyCorners(out, { '0:0': c, '0:1': c, '0:2': c, '0:6': c });
    }
    case 'donut': {
      ellipseLoop(out, cx, cy, rx, ry, false);
      const k = p('hole');
      if (k > 0.001) ellipseLoop(out, cx, cy, rx * k, ry * k, true);
      return out;
    }
    case 'pie': {
      const a0 = p('start') * DEG;
      const sweep = (((p('end') - p('start')) % 360) + 360) % 360;
      const k = p('hole');
      if (sweep < 0.01) {
        // Secteur complet : une ellipse (ou un anneau).
        ellipseLoop(out, cx, cy, rx, ry, false);
        if (k > 0.001) ellipseLoop(out, cx, cy, rx * k, ry * k, true);
        return out;
      }
      const a1 = a0 + sweep * DEG;
      const s = onEllipse(cx, cy, rx, ry, a0);
      if (k > 0.001) {
        out.push({ op: 'M', x: s.x, y: s.y });
        arcTo(out, cx, cy, rx, ry, a0, a1);
        out.push(line(onEllipse(cx, cy, rx * k, ry * k, a1)));
        arcTo(out, cx, cy, rx * k, ry * k, a1, a0);
      } else {
        out.push({ op: 'M', x: cx, y: cy }, line(s));
        arcTo(out, cx, cy, rx, ry, a0, a1);
      }
      out.push({ op: 'Z' });
      return out;
    }
    case 'cog': {
      const n = p('teeth');
      const ri = 1 - p('depth');
      const pitch = TAU / n;
      // Une dent : sommet (30 % du pas), deux flancs (20 % chacun), creux (30 %).
      const top = pitch * 0.3,
        flank = pitch * 0.2;
      const at = (r: number, a: number) => onEllipse(cx, cy, rx * r, ry * r, a);
      const s = at(1, -top / 2);
      out.push({ op: 'M', x: s.x, y: s.y });
      for (let i = 0; i < n; i++) {
        const c = i * pitch;
        arcTo(out, cx, cy, rx, ry, c - top / 2, c + top / 2);
        out.push(line(at(ri, c + top / 2 + flank)));
        arcTo(out, cx, cy, rx * ri, ry * ri, c + top / 2 + flank, c + pitch - top / 2 - flank);
        if (i < n - 1) out.push(line(at(1, c + pitch - top / 2)));
      }
      out.push({ op: 'Z' });
      const k = Math.min(p('hole'), ri - 0.05);
      if (k > 0.001) ellipseLoop(out, cx, cy, rx * k, ry * k, true);
      return out;
    }
    case 'cloud': {
      const raw = cloudRaw(p('bumps'), p('puff'));
      const b = exactBounds(raw);
      return b ? fitCommands(raw, b, { x: 0, y: 0, width: w, height: h }) : raw;
    }
    case 'heart': {
      const c = p('cleft');
      // Hauteur des bords gauche et droit, qui suit un peu la profondeur du creux.
      const e = 0.3 + (c - 0.25) * 0.5;
      const q = (x: number, y: number) => pt(x * w, y * h);
      const lo = e + (1 - e) * 0.45;
      out.push({ op: 'M', x: q(0.5, c).x, y: q(0.5, c).y });
      out.push(curve(q(0.5, c * 0.4), q(0.38, 0), q(0.25, 0)));
      out.push(curve(q(0.1, 0), q(0, e * 0.4), q(0, e)));
      out.push(curve(q(0, lo), q(0.3, 0.75), q(0.5, 1)));
      out.push(curve(q(0.7, 0.75), q(1, lo), q(1, e)));
      out.push(curve(q(1, e * 0.4), q(0.9, 0), q(0.75, 0)));
      out.push(curve(q(0.62, 0), q(0.5, c * 0.4), q(0.5, c)));
      out.push({ op: 'Z' });
      return out;
    }
    case 'spiral': {
      const total = p('turns') * TAU;
      const r0 = p('inner');
      const g = (1 - r0) / total;
      // La spirale part du centre, tourne dans le sens horaire et finit en haut de la boîte.
      const phi0 = -total;
      const seg = Math.max(2, Math.ceil(p('turns') * 8));
      const dt = total / seg;
      const at = (t: number) => {
        const r = r0 + g * t,
          a = phi0 + t;
        return {
          p: pt(cx + rx * r * Math.sin(a), cy - ry * r * Math.cos(a)),
          d: pt(rx * (g * Math.sin(a) + r * Math.cos(a)), ry * (r * Math.sin(a) - g * Math.cos(a))),
        };
      };
      let prev = at(0);
      out.push({ op: 'M', x: prev.p.x, y: prev.p.y });
      for (let i = 1; i <= seg; i++) {
        const cur = at(i * dt);
        out.push(curve(plus(prev.p, prev.d, dt / 3), plus(cur.p, cur.d, -dt / 3), cur.p));
        prev = cur;
      }
      return out;
    }
  }
}

const shapeCache = new Map<string, PathCommand[]>();

/**
 * Contour d'une forme paramétrique dans une boîte de `w` × `h` pixels (repère local). Le
 * résultat est partagé (mémorisé) : ne pas le modifier.
 */
export function shapeCommands(spec: ShapeSpec, w: number, h: number): PathCommand[] {
  const key = `${spec.kind}|${w}|${h}|${JSON.stringify(spec.params)}`;
  let cmds = shapeCache.get(key);
  if (!cmds) {
    cmds = buildShape(spec, Math.max(0, w), Math.max(0, h));
    if (shapeCache.size > 500) shapeCache.clear();
    shapeCache.set(key, cmds);
  }
  return cmds;
}

// ————— Coins —————

/** Réglage du coin `key` (ou le réglage commun `*`) ; null si ce nœud n'a pas de coin. */
export function cornerAt(corners: Corners | undefined, key: string): Corner | null {
  const c = corners?.[key] ?? corners?.['*'];
  return c && c.radius > EPS ? c : null;
}

export function hasCorners(corners: Corners | undefined): boolean {
  if (!corners) return false;
  for (const k in corners) if (corners[k].radius > EPS) return true;
  return false;
}

/** Coins d'un rectangle, d'après ses rayons et sa forme de coin. */
export function rectCorners(n: Pick<RectNode, 'cornerRadius' | 'radii' | 'cornerType'>): Corners | undefined {
  const type = n.cornerType && n.cornerType !== 'round' ? n.cornerType : undefined;
  let out: Corners | undefined;
  for (let i = 0; i < 4; i++) {
    const r = n.radii?.[i] ?? n.cornerRadius;
    if (r > 0) (out ??= {})[`0:${i}`] = type ? { radius: r, type } : { radius: r };
  }
  return out;
}

/** Courbe droite (un segment de droite converti en courbe) : ses poignées sont sur la corde. */
function isStraight(b: Cubic): boolean {
  const dx = b[3].x - b[0].x,
    dy = b[3].y - b[0].y;
  const tol = 1e-7 * (dx * dx + dy * dy) + 1e-9;
  return (
    Math.abs(dx * (b[1].y - b[0].y) - dy * (b[1].x - b[0].x)) <= tol &&
    Math.abs(dx * (b[2].y - b[0].y) - dy * (b[2].x - b[0].x)) <= tol
  );
}

/** Direction de départ d'une courbe, depuis son premier point. */
function startDir(b: Cubic): Vec | null {
  return unit(sub(b[1], b[0])) ?? unit(sub(b[2], b[0])) ?? unit(sub(b[3], b[0]));
}

/** Direction depuis le dernier point d'une courbe, en revenant sur elle. */
function endDir(b: Cubic): Vec | null {
  return unit(sub(b[2], b[3])) ?? unit(sub(b[1], b[3])) ?? unit(sub(b[0], b[3]));
}

/** Longueur approchée d'une courbe (moyenne de la corde et du polygone de contrôle). */
function cubicLength(b: Cubic): number {
  return (dist(b[0], b[3]) + dist(b[0], b[1]) + dist(b[1], b[2]) + dist(b[2], b[3])) / 2;
}

/** Paramètre du point de la courbe à la distance `d` de son début (ou de sa fin). */
function paramAt(b: Cubic, d: number, fromEnd: boolean): number {
  if (isStraight(b)) {
    const len = dist(b[0], b[3]);
    const f = len > EPS ? Math.min(1, d / len) : 0;
    return fromEnd ? 1 - f : f;
  }
  const o = fromEnd ? b[3] : b[0];
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (dist(cubicPoint(b, fromEnd ? 1 - m : m), o) < d) lo = m;
    else hi = m;
  }
  const m = (lo + hi) / 2;
  return fromEnd ? 1 - m : m;
}

/** Nœud anguleux d'un contour : ses deux courbes et l'angle entre elles (radians, 0 à π). */
interface Site {
  key: string;
  p: Vec;
  inc: Cubic;
  out: Cubic;
  theta: number;
}

type Sub = { cubics: Cubic[]; closed: boolean };

/** Les nœuds d'un sous-tracé, avec leur coin (null pour un nœud lisse ou une extrémité). */
function sitesOf(sp: Sub, si: number): (Site | null)[] {
  const { cubics, closed } = sp;
  const m = cubics.length;
  const n = closed ? m : m + 1;
  const sites: (Site | null)[] = [];
  for (let i = 0; i < n; i++) {
    const inc = closed ? cubics[(i - 1 + m) % m] : i > 0 ? cubics[i - 1] : null;
    const og = closed ? cubics[i] : i < m ? cubics[i] : null;
    const uIn = inc && endDir(inc),
      uOut = og && startDir(og);
    if (!inc || !og || !uIn || !uOut) {
      sites.push(null);
      continue;
    }
    const theta = Math.acos(clamp(dot(uIn, uOut), -1, 1));
    // Nœud lisse (côtés alignés) ou pointe repliée sur elle-même : pas de coin.
    if (theta > Math.PI - 0.02 || theta < 0.02) {
      sites.push(null);
      continue;
    }
    sites.push({ key: `${si}:${i}`, p: og[0], inc, out: og, theta });
  }
  return sites;
}

/** Les coins possibles d'un contour : nœuds anguleux, avec leur clé « sous-tracé:nœud ». */
export function cornerPoints(cmds: PathCommand[]): { key: string; x: number; y: number }[] {
  const out: { key: string; x: number; y: number }[] = [];
  commandsToCubics(cmds).forEach((sp, si) => {
    for (const s of sitesOf(sp, si)) if (s) out.push({ key: s.key, x: s.p.x, y: s.p.y });
  });
  return out;
}

interface Cut {
  /** Paramètres où s'arrêtent la courbe qui arrive et où repart la suivante. */
  sIn: number;
  sOut: number;
  p2: Vec;
  /** Le coin lui-même, du point d'arrivée au point de départ. */
  piece: PathCommand[];
}

function cutCorner(s: Site, c: Corner | null): Cut | null {
  if (!c) return null;
  // Distance du nœud aux points de coupe : celle d'un vrai congé de rayon `radius`, sans dépasser
  // la moitié de chaque côté (deux coins voisins ne se chevauchent pas).
  const t = Math.min(c.radius / Math.tan(s.theta / 2), cubicLength(s.inc) / 2, cubicLength(s.out) / 2);
  if (t < 1e-3) return null;
  const v = s.p;
  const sIn = paramAt(s.inc, t, true),
    sOut = paramAt(s.out, t, false);
  const p1 = cubicPoint(s.inc, sIn),
    p2 = cubicPoint(s.out, sOut);
  const piece: PathCommand[] = [];
  const type = c.type ?? 'round';
  if (type === 'straight') piece.push(line(p2));
  else if (type === 'cutout') {
    // Encoche : un petit rectangle (parallélogramme) retiré au coin.
    piece.push(line(plus(p1, sub(p2, v))), line(p2));
  } else if (type === 'concave') {
    // Arc de cercle centré sur le nœud, qui rentre dans la forme.
    const a1 = unit(sub(p1, v)),
      a2 = unit(sub(p2, v));
    const cos = a1 && a2 ? clamp(dot(a1, a2), -1, 1) : 1;
    const n1 = a1 && a2 && unit(sub(a2, plus(pt(0, 0), a1, cos)));
    const n2 = a1 && a2 && unit(sub(a1, plus(pt(0, 0), a2, cos)));
    if (!n1 || !n2) piece.push(line(p2));
    else {
      const k = (4 / 3) * Math.tan(Math.acos(cos) / 4);
      piece.push(curve(plus(p1, n1, k * dist(p1, v)), plus(p2, n2, k * dist(p2, v)), p2));
    }
  } else {
    // Arrondi : arc tangent aux deux côtés.
    const d1 = unit(cubicDerivative(s.inc, sIn)) ?? unit(sub(v, p1));
    const d2 = unit(cubicDerivative(s.out, sOut)) ?? unit(sub(p2, v));
    const phi = d1 && d2 ? Math.acos(clamp(dot(d1, d2), -1, 1)) : 0;
    const chord = dist(p1, p2);
    if (!d1 || !d2 || phi < 1e-3 || chord < EPS) piece.push(line(p2));
    else {
      const r = chord / (2 * Math.sin(phi / 2));
      const hl = (4 / 3) * Math.tan(phi / 4) * r;
      piece.push(curve(plus(p1, d1, hl), plus(p2, d2, -hl), p2));
    }
  }
  return { sIn, sOut, p2, piece };
}

/** Partie [a, e] d'une courbe, ajoutée au tracé (une droite reste une droite). */
function pushPart(out: PathCommand[], b: Cubic, a: number, e: number) {
  if (isStraight(b)) {
    out.push(line(e >= 1 - EPS ? b[3] : cubicPoint(b, e)));
    return;
  }
  let c = b;
  if (e < 1 - EPS) c = splitCubic(c, e)[0];
  if (a > EPS) c = splitCubic(c, a / e)[1];
  out.push(curve(c[1], c[2], c[3]));
}

/**
 * Applique des coins non destructifs à un contour : chaque nœud anguleux qui a un rayon est
 * remplacé par un arrondi, un pan droit, un arc concave ou une encoche. C'est la seule fonction
 * qui calcule les coins : écran, exports, sélection, opérations booléennes et conversion en
 * courbes passent tous par elle (via `shapePath`).
 */
export function applyCorners(cmds: PathCommand[], corners: Corners | undefined): PathCommand[] {
  if (!hasCorners(corners)) return cmds;
  const out: PathCommand[] = [];
  commandsToCubics(cmds).forEach((sp, si) => {
    const m = sp.cubics.length;
    if (!m) return;
    const cuts = sitesOf(sp, si).map((s) => (s ? cutCorner(s, cornerAt(corners, s.key)) : null));
    const start = sp.closed && cuts[0] ? cuts[0].p2 : sp.cubics[0][0];
    out.push({ op: 'M', x: start.x, y: start.y });
    for (let j = 0; j < m; j++) {
      const next = sp.closed ? (j + 1) % m : j + 1;
      pushPart(out, sp.cubics[j], cuts[j]?.sOut ?? 0, cuts[next]?.sIn ?? 1);
      const c = cuts[next];
      if (c) out.push(...c.piece);
    }
    if (sp.closed) out.push({ op: 'Z' });
  });
  return out;
}
