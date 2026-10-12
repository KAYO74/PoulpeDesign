import { cubicPoint, splitCubic } from './bezier';
import type { Cubic } from './bezier';
import {
  anchorKey,
  fromSubpaths,
  nearestSegment,
  segmentCubic,
  toSubpaths,
  type Anchor,
  type SubPath,
} from './pathEdit';
import type { PathCommand, Vec } from './geometry';

/*
 * Ciseaux, cutter et outil Coin : couper un tracé en un point, le couper le long d'une ligne, et
 * arrondir ou chanfreiner des nœuds. Géométrie pure, sans dépendance au navigateur.
 */

/** Nœud au point `t` du segment `seg`, avec les poignées des deux moitiés. */
function splitAnchors(
  sp: SubPath,
  seg: number,
  t: number,
): { a: Anchor; b: Anchor; first: Anchor; last: Anchor } {
  const c = segmentCubic(sp, seg);
  const [left, right] = splitCubic(c, t);
  const mid = cubicPoint(c, t);
  const from = sp.anchors[seg];
  const to = sp.anchors[(seg + 1) % sp.anchors.length];
  return {
    // Début du segment, avec sa poignée de sortie raccourcie.
    a: { ...from, out: { x: left[1].x, y: left[1].y } },
    b: { ...to, in: { x: right[2].x, y: right[2].y } },
    // Les deux copies du point de coupe.
    first: { x: mid.x, y: mid.y, in: { x: left[2].x, y: left[2].y }, out: null },
    last: { x: mid.x, y: mid.y, in: null, out: { x: right[1].x, y: right[1].y } },
  };
}

/**
 * Ciseaux : coupe le sous-tracé `si` au point `t` du segment `seg`. Un tracé fermé s'ouvre à cet
 * endroit ; un tracé ouvert donne deux sous-tracés.
 */
export function cutSubpathAt(sps: SubPath[], si: number, seg: number, t: number): SubPath[] {
  const sp = sps[si];
  if (!sp || sp.anchors.length < 2) return sps;
  const { a, b, first, last } = splitAnchors(sp, seg, t);
  const out = [...sps];
  if (sp.closed) {
    // Fermé : le tracé s'ouvre, en partant du point de coupe.
    const anchors: Anchor[] = [last];
    for (let k = 1; k < sp.anchors.length; k++) {
      const i = (seg + k) % sp.anchors.length;
      anchors.push(i === seg + 1 || (seg + 1) % sp.anchors.length === i ? b : { ...sp.anchors[i] });
    }
    anchors.push(a, first);
    out[si] = { anchors, closed: false };
    return out;
  }
  const left: Anchor[] = [...sp.anchors.slice(0, seg).map((x) => ({ ...x })), a, first];
  const right: Anchor[] = [last, b, ...sp.anchors.slice(seg + 2).map((x) => ({ ...x }))];
  out.splice(si, 1, { anchors: left, closed: false }, { anchors: right, closed: false });
  return out;
}

/** Ciseaux, en coordonnées du tracé : coupe au point le plus proche de `p`. Renvoie null si trop loin. */
export function cutPathAtPoint(cmds: PathCommand[], p: Vec, maxDist: number): PathCommand[] | null {
  const sps = toSubpaths(cmds);
  const hit = nearestSegment(sps, p);
  if (!hit || Math.hypot(hit.point.x - p.x, hit.point.y - p.y) > maxDist) return null;
  return fromSubpaths(cutSubpathAt(sps, hit.si, hit.seg, hit.t));
}

/** Intersections d'un segment de droite avec une courbe cubique (paramètres `t` sur la courbe). */
function lineCubicHits(c: Cubic, a: Vec, b: Vec): number[] {
  // Résolution numérique : la courbe est échantillonnée, puis affinée par dichotomie.
  const side = (p: Vec) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const within = (p: Vec) => {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1);
    return u >= -1e-6 && u <= 1 + 1e-6;
  };
  const out: number[] = [];
  const N = 48;
  let prev = side(cubicPoint(c, 0));
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const cur = side(cubicPoint(c, t));
    if (prev < 0 !== cur < 0) {
      let lo = (i - 1) / N,
        hi = t;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (side(cubicPoint(c, lo)) < 0 !== side(cubicPoint(c, mid)) < 0) hi = mid;
        else lo = mid;
      }
      const tt = (lo + hi) / 2;
      if (within(cubicPoint(c, tt)) && tt > 1e-6 && tt < 1 - 1e-6) out.push(tt);
    }
    prev = cur;
  }
  return out;
}

/**
 * Cutter sur un tracé ouvert : la ligne `a`–`b` le sépare en morceaux à chaque croisement.
 * Renvoie null si la ligne ne traverse rien. Les formes fermées se coupent autrement (voir
 * `knifeShape` dans `boolean.ts`), par deux demi-plans.
 */
export function knifeOpenPath(cmds: PathCommand[], a: Vec, b: Vec): PathCommand[] | null {
  let sps = toSubpaths(cmds);
  let cuts = 0;
  for (let si = sps.length - 1; si >= 0; si--) {
    const count = sps[si].closed ? sps[si].anchors.length : sps[si].anchors.length - 1;
    // Du dernier segment vers le premier : les coupes ne décalent pas les indices à traiter.
    for (let seg = count - 1; seg >= 0; seg--) {
      const hits = lineCubicHits(segmentCubic(sps[si], seg), a, b).sort((x, y) => y - x);
      for (const t of hits) {
        sps = cutSubpathAt(sps, si, seg, t);
        cuts++;
      }
    }
  }
  return cuts ? fromSubpaths(sps) : null;
}

/** Vrai si le tracé a au moins un sous-tracé fermé (une forme pleine à couper en deux). */
export function hasClosedSubpath(cmds: PathCommand[]): boolean {
  return toSubpaths(cmds).some((sp) => sp.closed);
}

/**
 * Outil Coin : arrondit (ou chanfreine) les nœuds `keys` d'un tracé, de `radius` pixels. Chaque
 * nœud devient deux nœuds reliés par un arc (ou par un segment droit pour un chanfrein).
 */
export function roundCorners(
  sps: SubPath[],
  keys: string[],
  radius: number,
  kind: 'round' | 'chamfer' = 'round',
): SubPath[] {
  const want = new Set(keys);
  const KAPPA = 0.5522847498;
  return sps.map((sp, si) => {
    const n = sp.anchors.length;
    if (n < 3 && sp.closed) return sp;
    const anchors: Anchor[] = [];
    for (let ai = 0; ai < n; ai++) {
      const a = sp.anchors[ai];
      const prev = sp.anchors[(ai - 1 + n) % n];
      const next = sp.anchors[(ai + 1) % n];
      const ends = !sp.closed && (ai === 0 || ai === n - 1);
      // Seuls les nœuds anguleux d'un coin bien formé s'arrondissent.
      if (!want.has(anchorKey(si, ai)) || ends || a.in || a.out) {
        anchors.push({ ...a });
        continue;
      }
      const toPrev = { x: prev.x - a.x, y: prev.y - a.y };
      const toNext = { x: next.x - a.x, y: next.y - a.y };
      const lp = Math.hypot(toPrev.x, toPrev.y),
        ln = Math.hypot(toNext.x, toNext.y);
      if (lp < 1e-6 || ln < 1e-6) {
        anchors.push({ ...a });
        continue;
      }
      const r = Math.min(radius, lp / 2, ln / 2);
      const p1 = { x: a.x + (toPrev.x / lp) * r, y: a.y + (toPrev.y / lp) * r };
      const p2 = { x: a.x + (toNext.x / ln) * r, y: a.y + (toNext.y / ln) * r };
      if (kind === 'chamfer') {
        anchors.push({ x: p1.x, y: p1.y, in: null, out: null }, { x: p2.x, y: p2.y, in: null, out: null });
      } else {
        anchors.push(
          {
            x: p1.x,
            y: p1.y,
            in: null,
            out: { x: p1.x + (a.x - p1.x) * KAPPA, y: p1.y + (a.y - p1.y) * KAPPA },
          },
          {
            x: p2.x,
            y: p2.y,
            in: { x: p2.x + (a.x - p2.x) * KAPPA, y: p2.y + (a.y - p2.y) * KAPPA },
            out: null,
          },
        );
      }
    }
    return { anchors, closed: sp.closed };
  });
}

/** Les nœuds anguleux d'un tracé, sous forme de clés `sousTracé:nœud`. */
export function cornerKeys(cmds: PathCommand[]): string[] {
  const sps = toSubpaths(cmds);
  const out: string[] = [];
  sps.forEach((sp, si) =>
    sp.anchors.forEach((a, ai) => {
      if (!a.in && !a.out) out.push(anchorKey(si, ai));
    }),
  );
  return out;
}
