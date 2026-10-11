import {
  POLYGON_BULGE,
  calloutVertices,
  commandsToCubics,
  cubicPoint,
  regularVertices,
  shapeCommands,
  shapeParam,
  shapeParamDef,
  type SceneNode,
  type ShapeSpec,
  type Vec,
} from '@poulpe/core';

/*
 * Poignées rouges des formes (comme dans Affinity) : glisser une poignée change un réglage de la
 * forme (arrondi, nombre de côtés, trou, angles…), un double-clic le remet à sa valeur par défaut.
 * Tout est exprimé dans le repère local de l'objet (0..largeur, 0..hauteur).
 */

/** Début du glissement d'une poignée. */
export interface HandleDrag {
  /** Objet tel qu'il était au début du geste (ses réglages de départ). */
  node: SceneNode;
  /** Pointeur au début du geste, repère local. */
  l0: Vec;
  /** Angle cumulé (spirale : on peut faire plusieurs tours). */
  turn: { last: number; total: number };
  shift: boolean;
}

export interface ShapeHandle {
  id: string;
  /** Position, repère local. */
  at: Vec;
  /** Applique le glissement au brouillon `n` ; `l` est le pointeur (repère local). */
  drag(n: SceneNode, l: Vec, g: HandleDrag): void;
  /** Double-clic : valeur par défaut. */
  reset(n: SceneNode): void;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, k = 1000) => Math.round(v * k) / k;

/** Point local → repère de l'ellipse inscrite (centre 0, rayon 1). */
function norm(n: SceneNode, l: Vec): Vec {
  return { x: (l.x - n.width / 2) / (n.width / 2 || 1), y: (l.y - n.height / 2) / (n.height / 2 || 1) };
}

/** Angle (radians, sens horaire depuis midi, de 0 à 2π) d'un point local autour du centre. */
function angleOf(n: SceneNode, l: Vec): number {
  const q = norm(n, l);
  const a = Math.atan2(q.x, -q.y);
  return a < 0 ? a + TAU : a;
}

/** Point de l'ellipse inscrite à l'angle `a` et au rayon relatif `r`. */
function polar(n: SceneNode, a: number, r: number): Vec {
  return {
    x: n.width / 2 + (Math.sin(a) * r * n.width) / 2,
    y: n.height / 2 - (Math.cos(a) * r * n.height) / 2,
  };
}

/** Déplacement (repère de l'ellipse) le long de la direction de l'angle `a`. */
function radialDelta(n: SceneNode, l: Vec, l0: Vec, a: number): number {
  const p = norm(n, l),
    q = norm(n, l0);
  return (p.x - q.x) * Math.sin(a) - (p.y - q.y) * Math.cos(a);
}

/** Nombre d'éléments répartis sur un tour tel que le suivant tombe à l'angle `a` (`k` : décalage). */
function countFor(a: number, k = 1): number {
  return Math.round((k * TAU) / Math.max(a, 0.01));
}

function setParam(n: SceneNode, key: string, v: number): void {
  if (n.type !== 'path' || !n.shape) return;
  const def = shapeParamDef(n.shape.kind, key);
  let x = def ? clamp(v, def.min, def.max) : v;
  x = def?.int ? Math.round(x) : def?.unit === 'px' || def?.unit === '°' ? round(x, 10) : round(x);
  n.shape.params[key] = x;
}

function resetParam(n: SceneNode, key: string): void {
  if (n.type !== 'path' || !n.shape) return;
  const def = shapeParamDef(n.shape.kind, key);
  if (def) n.shape.params[key] = def.def;
}

/** Poignée d'un réglage de forme paramétrique. */
function param(id: string, at: Vec, key: string, value: (g: HandleDrag, l: Vec) => number): ShapeHandle {
  return {
    id,
    at,
    drag: (n, l, g) => setParam(n, key, value(g, l)),
    reset: (n) => resetParam(n, key),
  };
}

/** Angle de départ ou de fin d'un secteur, arrondi à 15° avec Maj. */
function pieAngle(n: SceneNode, l: Vec, shift: boolean): number {
  const deg = (angleOf(n, l) * 180) / Math.PI;
  return shift ? (Math.round(deg / 15) * 15) % 360 : deg;
}

function kindHandles(n: SceneNode, spec: ShapeSpec, min: number): ShapeHandle[] {
  const w = n.width,
    h = n.height;
  const p = (k: string) => shapeParam(spec, k);
  const v0 = (g: HandleDrag, k: string) =>
    g.node.type === 'path' && g.node.shape ? shapeParam(g.node.shape, k) : p(k);
  const dx = (g: HandleDrag, l: Vec) => l.x - g.l0.x;
  const dy = (g: HandleDrag, l: Vec) => l.y - g.l0.y;
  switch (spec.kind) {
    case 'triangle':
      return [param('apex', { x: p('apex') * w, y: 0 }, 'apex', (g, l) => v0(g, 'apex') + dx(g, l) / w)];
    case 'arrow': {
      const xb = w * (1 - p('head'));
      return [
        param('head', { x: xb, y: 0 }, 'head', (g, l) => v0(g, 'head') - dx(g, l) / w),
        param(
          'shaft',
          { x: xb / 2, y: (h * (1 - p('shaft'))) / 2 },
          'shaft',
          (g, l) => v0(g, 'shaft') - (2 * dy(g, l)) / h,
        ),
      ];
    }
    case 'callout': {
      const v = calloutVertices(spec, w, h);
      const base = { x: (v[3].x + v[5].x) / 2, y: v[3].y };
      return [
        param(
          'radius',
          { x: Math.min(Math.max(p('radius'), min), w / 2), y: 0 },
          'radius',
          (g, l) => v0(g, 'radius') + dx(g, l),
        ),
        param('tipX', v[4], 'tipX', (g, l) => v0(g, 'tipX') + dx(g, l) / w),
        {
          id: 'base',
          at: base,
          drag: (m, l, g) => {
            setParam(m, 'baseX', v0(g, 'baseX') + dx(g, l) / w);
            setParam(m, 'tail', v0(g, 'tail') - dy(g, l) / h);
          },
          reset: (m) => {
            resetParam(m, 'baseX');
            resetParam(m, 'tail');
          },
        },
      ];
    }
    case 'donut':
      return [
        param('hole', polar(n, 0, p('hole')), 'hole', (g, l) => v0(g, 'hole') + radialDelta(n, l, g.l0, 0)),
      ];
    case 'pie': {
      const a0 = (p('start') * Math.PI) / 180;
      let sweep = (((p('end') - p('start')) % 360) + 360) % 360;
      if (sweep < 0.01) sweep = 360;
      const mid = a0 + (sweep * Math.PI) / 360;
      return [
        param('start', polar(n, a0, 1), 'start', (g, l) => pieAngle(n, l, g.shift)),
        param('end', polar(n, (p('end') * Math.PI) / 180, 1), 'end', (g, l) => pieAngle(n, l, g.shift)),
        param(
          'hole',
          polar(n, mid, p('hole')),
          'hole',
          (g, l) => v0(g, 'hole') + radialDelta(n, l, g.l0, mid),
        ),
      ];
    }
    case 'cog': {
      const pitch = TAU / p('teeth');
      const ri = 1 - p('depth');
      return [
        param('teeth', polar(n, pitch, 1), 'teeth', (g, l) => countFor(angleOf(n, l))),
        param(
          'depth',
          polar(n, pitch / 2, ri),
          'depth',
          (g, l) => v0(g, 'depth') - radialDelta(n, l, g.l0, pitch / 2),
        ),
        param(
          'hole',
          polar(n, 0, Math.min(p('hole'), ri - 0.05)),
          'hole',
          (g, l) => v0(g, 'hole') + radialDelta(n, l, g.l0, 0),
        ),
      ];
    }
    case 'cloud': {
      // Les bosses sont recalées sur la boîte : les poignées sont lues sur le contour lui-même.
      const subs = commandsToCubics(shapeCommands(spec, w, h))[0]?.cubics ?? [];
      const first = subs[0]?.[0] ?? { x: w / 2, y: 0 };
      const last = subs[subs.length - 1];
      const top = last ? cubicPoint(last, 0.5) : { x: w / 2, y: 0 };
      return [
        // Le premier creux est à une demi-bosse de midi.
        param('bumps', first, 'bumps', (g, l) => countFor(angleOf(n, l), 0.5)),
        param('puff', top, 'puff', (g, l) => v0(g, 'puff') - (2 * dy(g, l)) / h),
      ];
    }
    case 'heart':
      return [
        param('cleft', { x: w / 2, y: p('cleft') * h }, 'cleft', (g, l) => v0(g, 'cleft') + dy(g, l) / h),
      ];
    case 'spiral': {
      const total = p('turns') * TAU;
      const start = -total;
      return [
        {
          id: 'turns',
          at: polar(n, 0, 1),
          drag: (m, l, g) => {
            // On suit l'angle du pointeur tour après tour : chaque tour ajouté allonge la spirale.
            const a = angleOf(n, l);
            let d = a - g.turn.last;
            if (d > Math.PI) d -= TAU;
            if (d < -Math.PI) d += TAU;
            g.turn.last = a;
            g.turn.total += d;
            setParam(m, 'turns', v0(g, 'turns') + g.turn.total / TAU);
          },
          reset: (m) => resetParam(m, 'turns'),
        },
        param(
          'inner',
          polar(n, start, p('inner')),
          'inner',
          (g, l) => v0(g, 'inner') + radialDelta(n, l, g.l0, start),
        ),
      ];
    }
  }
}

/**
 * Poignées rouges d'un objet. `min` : écart minimal (repère local) entre une poignée d'arrondi et
 * son coin, pour qu'elle ne se cache pas sous la poignée de redimensionnement.
 */
export function handlesOf(n: SceneNode, min: number): ShapeHandle[] {
  const w = n.width,
    h = n.height;
  if (n.type === 'rect') {
    const maxR = Math.min(w, h) / 2;
    const r0 = (g: HandleDrag, i: number) =>
      g.node.type === 'rect' ? (g.node.radii?.[i] ?? g.node.cornerRadius) : 0;
    const setR = (m: SceneNode, i: number | null, r: number) => {
      if (m.type !== 'rect') return;
      const v = round(clamp(r, 0, maxR), 10);
      if (i === null || !m.radii) m.cornerRadius = v;
      else {
        const radii = [...m.radii] as [number, number, number, number];
        radii[i] = v;
        m.radii = radii;
      }
    };
    const reset = (m: SceneNode) => {
      if (m.type !== 'rect') return;
      m.cornerRadius = 0;
      delete m.radii;
    };
    if (!n.radii)
      return [
        {
          id: 'radius',
          at: { x: Math.min(Math.max(n.cornerRadius, min), w / 2), y: 0 },
          drag: (m, l, g) => setR(m, null, r0(g, 0) + l.x - g.l0.x),
          reset,
        },
      ];
    // Coins distincts : une poignée par coin, sur le bord du haut ou du bas.
    const at = (i: number): Vec => {
      const r = Math.min(Math.max(n.radii![i], min), w / 2);
      return { x: i === 0 || i === 3 ? r : w - r, y: i < 2 ? 0 : h };
    };
    return [0, 1, 2, 3].map((i) => ({
      id: `radius${i}`,
      at: at(i),
      drag: (m, l, g) => setR(m, i, r0(g, i) + (i === 0 || i === 3 ? 1 : -1) * (l.x - g.l0.x)),
      reset: (m) => setR(m, i, 0),
    }));
  }
  if (n.type === 'polygon') {
    const pts = regularVertices(Math.max(3, Math.round(n.sides)), w, h);
    const a = pts[0],
      b = pts[1];
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const len = Math.hypot(ab.x, ab.y) || 1;
    // Normale extérieure du premier côté.
    let nx = ab.y / len,
      ny = -ab.x / len;
    if (nx * (a.x + ab.x / 2 - w / 2) + ny * (a.y + ab.y / 2 - h / 2) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const bulge = 0.75 * len * POLYGON_BULGE;
    const c = n.curve ?? 0;
    return [
      {
        id: 'sides',
        at: b,
        drag: (m, l) => {
          if (m.type === 'polygon') m.sides = clamp(countFor(angleOf(n, l)), 3, 64);
        },
        reset: (m) => {
          if (m.type === 'polygon') m.sides = 6;
        },
      },
      {
        id: 'curve',
        at: { x: a.x + ab.x / 2 + nx * bulge * c, y: a.y + ab.y / 2 + ny * bulge * c },
        drag: (m, l, g) => {
          if (m.type !== 'polygon') return;
          const c0 = g.node.type === 'polygon' ? (g.node.curve ?? 0) : 0;
          const v = round(clamp(c0 + ((l.x - g.l0.x) * nx + (l.y - g.l0.y) * ny) / bulge, -1, 1));
          if (v) m.curve = v;
          else delete m.curve;
        },
        reset: (m) => {
          if (m.type === 'polygon') delete m.curve;
        },
      },
    ];
  }
  if (n.type === 'star') {
    const count = Math.max(3, Math.round(n.points));
    const pts = regularVertices(count, w, h, n.innerRatio);
    const ia = Math.PI / count;
    return [
      {
        id: 'points',
        at: pts[2],
        drag: (m, l) => {
          if (m.type === 'star') m.points = clamp(countFor(angleOf(n, l)), 3, 64);
        },
        reset: (m) => {
          if (m.type === 'star') m.points = 5;
        },
      },
      {
        id: 'inner',
        at: pts[1],
        drag: (m, l) => {
          if (m.type !== 'star') return;
          const q = norm(n, l);
          m.innerRatio = round(clamp(q.x * Math.sin(ia) - q.y * Math.cos(ia), 0.05, 1));
        },
        reset: (m) => {
          if (m.type === 'star') m.innerRatio = 0.5;
        },
      },
    ];
  }
  if (n.type === 'path' && n.shape) return kindHandles(n, n.shape, min);
  return [];
}
