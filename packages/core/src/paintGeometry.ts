import { withAlpha } from './color';
import { linearGradientPoints, nodeBounds, type Vec } from './geometry';
import type { GradientPaint, OpacityStop, Paint, SceneNode, Transparency } from './types';

/*
 * Géométrie des dégradés (outils Remplissage et Transparence, comme dans Affinity) : début et fin
 * exacts dans la boîte de l'objet, poignées affichées sur le canevas, rotation d'un quart de tour,
 * inversion et changement de type. Dégradés de couleur et de transparence partagent la même
 * géométrie ; le rendu à l'écran, l'export SVG et l'export PDF la lisent ici.
 */

/** Dégradé de couleur ou de transparence. */
export type AnyGradient = GradientPaint | Transparency;
/** Peinture dont l'outil Remplissage montre les poignées (dégradés et motifs). */
export type HandlePaint = AnyGradient | Extract<Paint, { type: 'pattern' }>;
/** Types proposés par les outils Remplissage et Transparence (l'elliptique est un radial à deux rayons). */
export type GradientKind = 'linear' | 'radial' | 'elliptical' | 'conic';

const DEG = Math.PI / 180;
const round = (v: number, k = 10000) => Math.round(v * k) / k;
/** Fraction de la boîte ; une boîte plate (ligne horizontale) compte pour 1 pixel. */
const frac = (v: number, size: number) => round(v / (size || 1));
/** Plus grand côté de la boîte, qui sert d'unité aux rayons. */
const unit = (w: number, h: number) => Math.max(w, h) || 1;
/** Longueur par défaut de la poignée d'un dégradé conique, en fraction du plus grand côté. */
const CONIC_HANDLE = 0.35;

interface LinearGeometry {
  angle: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface RadialGeometry {
  cx: number;
  cy: number;
  r: number;
  ratio?: number;
  angle?: number;
}

/** Le dégradé linéaire a-t-il un début et une fin exacts (outil Remplissage) ? */
export function hasLinearPoints(p: LinearGeometry): boolean {
  return p.x1 !== undefined && p.y1 !== undefined && p.x2 !== undefined && p.y2 !== undefined;
}

/** Début et fin d'un dégradé linéaire en pixels de la boîte : points exacts, sinon d'après l'angle. */
export function linearPoints(p: LinearGeometry, w: number, h: number): [Vec, Vec] {
  if (hasLinearPoints(p))
    return [
      { x: p.x1! * w, y: p.y1! * h },
      { x: p.x2! * w, y: p.y2! * h },
    ];
  return linearGradientPoints(p.angle, w, h);
}

/** Cercle ou ellipse d'un dégradé radial, en pixels de la boîte ; `angle` en degrés. */
export interface RadialFrame {
  cx: number;
  cy: number;
  r: number;
  angle: number;
  ratio: number;
}

export function radialFrame(p: RadialGeometry, w: number, h: number): RadialFrame {
  return {
    cx: p.cx * w,
    cy: p.cy * h,
    r: Math.max(0.001, p.r * Math.max(w, h)),
    angle: p.angle ?? 0,
    ratio: Math.max(0.001, p.ratio ?? 1),
  };
}

/** Dégradé elliptique : un radial qui a deux rayons. */
export function isElliptical(p: Paint | Transparency): boolean {
  return p.type === 'radial' && p.ratio !== undefined;
}

/** Type de dégradé tel que les outils le présentent (null : pas un dégradé). */
export function gradientKind(p: Paint | Transparency): GradientKind | null {
  if (p.type === 'radial') return isElliptical(p) ? 'elliptical' : 'radial';
  if (p.type === 'linear' || p.type === 'conic') return p.type;
  return null;
}

/** Poignées d'un dégradé ou d'un motif sur le canevas, en pixels de la boîte. */
export interface GradientHandles {
  /** Début (linéaire, motif) ou centre (radial, elliptique, conique). */
  a: Vec;
  /** Fin (linéaire), bout du premier rayon (radial, elliptique) ou direction (conique, motif). */
  b: Vec;
  /** Elliptique : bout du second rayon. */
  c?: Vec;
}

const along = (a: Vec, deg: number, len: number): Vec => ({
  x: a.x + Math.cos(deg * DEG) * len,
  y: a.y + Math.sin(deg * DEG) * len,
});

/** `tile` : largeur de l'image d'un motif, en pixels. */
export function gradientHandles(p: HandlePaint, w: number, h: number, tile = 100): GradientHandles {
  switch (p.type) {
    case 'linear': {
      const [a, b] = linearPoints(p, w, h);
      return { a, b };
    }
    case 'radial': {
      const f = radialFrame(p, w, h);
      const a = { x: f.cx, y: f.cy };
      const b = along(a, f.angle, f.r);
      return isElliptical(p) ? { a, b, c: along(a, f.angle + 90, f.r * f.ratio) } : { a, b };
    }
    case 'conic': {
      const a = { x: p.cx * w, y: p.cy * h };
      return { a, b: along(a, p.angle, (p.r ?? CONIC_HANDLE) * unit(w, h)) };
    }
    case 'pattern': {
      const a = { x: (p.x ?? 0) * w, y: (p.y ?? 0) * h };
      return { a, b: along(a, p.angle, Math.max(1, tile * p.scale)) };
    }
  }
}

/**
 * Nouvelle géométrie d'après des poignées déplacées (pixels de la boîte) : `a` début ou centre,
 * `b` fin ou bout du rayon. Le second rayon d'un elliptique reste proportionnel au premier.
 */
export function withHandles<T extends HandlePaint>(
  p: T,
  w: number,
  h: number,
  a: Vec,
  b: Vec,
  tile = 100,
): T {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const angle = round(Math.atan2(dy, dx) / DEG, 100);
  const len = Math.hypot(dx, dy);
  switch (p.type) {
    case 'linear':
      return { ...p, angle, x1: frac(a.x, w), y1: frac(a.y, h), x2: frac(b.x, w), y2: frac(b.y, h) };
    case 'radial':
      return { ...p, cx: frac(a.x, w), cy: frac(a.y, h), r: Math.max(0.001, round(len / unit(w, h))), angle };
    case 'conic':
      return { ...p, cx: frac(a.x, w), cy: frac(a.y, h), angle, r: Math.max(0.01, round(len / unit(w, h))) };
    case 'pattern':
      return { ...p, x: frac(a.x, w), y: frac(a.y, h), angle, scale: Math.max(0.01, round(len / tile)) };
  }
  return p;
}

/** Second rayon d'un elliptique d'après la poignée `c` (pixels de la boîte) : rapport au premier. */
export function ellipseRatio(p: RadialGeometry, w: number, h: number, c: Vec): number {
  const f = radialFrame(p, w, h);
  const nx = -Math.sin(f.angle * DEG),
    ny = Math.cos(f.angle * DEG);
  const d = Math.abs((c.x - f.cx) * nx + (c.y - f.cy) * ny);
  return Math.max(0.01, round(d / f.r, 1000));
}

const normAngle = (a: number) => {
  const r = (((a % 360) + 540) % 360) - 180;
  return r === -180 ? 180 : r;
};

/** Tourne le dégradé (ou le motif) d'un quart de tour dans le sens horaire, autour de son milieu. */
export function rotateGradient<T extends HandlePaint>(p: T, w: number, h: number): T {
  if (p.type === 'linear' && hasLinearPoints(p)) {
    const [a, b] = linearPoints(p, w, h);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const turn = (q: Vec): Vec => ({ x: m.x - (q.y - m.y), y: m.y + (q.x - m.x) });
    return withHandles(p, w, h, turn(a), turn(b));
  }
  return { ...p, angle: normAngle((p.angle ?? 0) + 90) };
}

/** Inverse l'ordre des arrêts (couleurs ou opacités). */
export function reverseStops<T extends { stops: { offset: number }[] }>(p: T): T {
  return {
    ...p,
    stops: [...p.stops].reverse().map((s) => ({ ...s, offset: round(1 - s.offset, 1000) })),
  };
}

/**
 * Dégradé neuf d'un type donné, qui couvre la boîte : linéaire de gauche à droite, radial et
 * conique centrés, elliptique calé sur les proportions de la boîte.
 */
export function newGradient<S>(
  kind: GradientKind,
  stops: S[],
  w: number,
  h: number,
): { type: 'linear' | 'radial' | 'conic'; stops: S[] } & Record<string, unknown> {
  switch (kind) {
    case 'linear':
      return { type: 'linear', stops, angle: 0 };
    case 'radial':
      return { type: 'radial', stops, cx: 0.5, cy: 0.5, r: 0.5 };
    case 'elliptical':
      return {
        type: 'radial',
        stops,
        cx: 0.5,
        cy: 0.5,
        r: 0.5,
        angle: w >= h ? 0 : 90,
        ratio: round(Math.min(w, h) / unit(w, h), 1000) || 0.5,
      };
    case 'conic':
      return { type: 'conic', stops, angle: 0, cx: 0.5, cy: 0.5 };
  }
}

/**
 * Change le type d'un dégradé en gardant ses arrêts et son tracé (début et fin, ou centre et
 * rayon), comme le menu Type des outils d'Affinity.
 */
export function convertGradient<T extends AnyGradient>(p: T, kind: GradientKind, w: number, h: number): T {
  if (gradientKind(p) === kind) return p;
  const { a, b } = gradientHandles(p, w, h);
  const base = newGradient(kind, p.stops as unknown[], w, h) as unknown as T;
  if (kind === 'elliptical') (base as { ratio?: number }).ratio = 0.5;
  return withHandles(base, w, h, a, b);
}

// ————— Transparence —————

/** Opacité interpolée le long d'un dégradé de transparence (pour ajouter un arrêt). */
export function sampleOpacity(stops: OpacityStop[], t: number): number {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  if (!sorted.length) return 1;
  if (t <= sorted[0].offset) return sorted[0].opacity;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1],
      b = sorted[i];
    if (t <= b.offset) {
      const k = b.offset === a.offset ? 0 : (t - a.offset) / (b.offset - a.offset);
      return round(a.opacity + (b.opacity - a.opacity) * k, 1000);
    }
  }
  return sorted[sorted.length - 1].opacity;
}

/** Dégradé de transparence en peinture : du blanc plus ou moins opaque, qui sert de masque. */
export function transparencyPaint(t: Transparency): GradientPaint {
  return {
    ...t,
    stops: t.stops.map((s) => ({
      offset: s.offset,
      color: withAlpha('#ffffff', Math.min(1, Math.max(0, s.opacity))),
    })),
  } as GradientPaint;
}

/** Boîte où s'exprime la transparence : celle de l'objet ; pour un groupe, celle de son contenu. */
export function transparencyFrame(node: SceneNode): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
} {
  if (node.type === 'group') return { ...nodeBounds(node), rotation: 0 };
  return { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation };
}
