import paper from 'paper';
import { exactBounds, flattenCommands } from './bezier';
import { booleanCommands, pathNodeFromWorld } from './boolean';
import { createPath } from './factory';
import { corners, pathToSvg, type PathCommand, type Vec } from './geometry';
import { parseSvgPath } from './path';
import { hasClosedSubpath, knifeOpenPath } from './pathCut';
import { fromSubpaths, toSubpaths } from './pathEdit';
import { findArtboard, findNode, topLevelIds, walkDocument } from './tree';
import type { Paint, Parent, PoulpeDocument, SceneNode } from './types';
import { worldOutline } from './vector';

/*
 * Zones formées par des formes qui se chevauchent, comme dans Affinity Designer : le constructeur
 * de formes (Shape Builder), le remplissage de zone vectoriel et le cutter à main levée. La zone
 * sous un point est l'intersection des formes qui le contiennent, moins les autres formes. Les
 * calculs passent par Paper.js, qui garde les courbes de Bézier intactes.
 */

export interface RegionShape {
  cmds: PathCommand[];
  fillRule?: 'nonzero' | 'evenodd';
}

/** Zone sous un point : un identifiant stable, les formes qui la contiennent et son contour. */
export interface Region {
  id: string;
  shapes: number[];
  cmds: PathCommand[];
}

let scope: paper.PaperScope | null = null;

function ps(): paper.PaperScope {
  if (!scope) {
    scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
  }
  scope.activate();
  return scope;
}

const OPTS = { insert: false } as const;

function toItem(cmds: PathCommand[], fillRule: 'nonzero' | 'evenodd' = 'nonzero'): paper.PathItem {
  const item = new (ps().CompoundPath)({ pathData: pathToSvg(cmds, 4), insert: false });
  item.fillRule = fillRule;
  return item;
}

function fromItem(item: paper.PathItem): PathCommand[] {
  return parseSvgPath(item.pathData);
}

function isEmpty(item: paper.PathItem): boolean {
  return item.isEmpty() || Math.abs((item as paper.CompoundPath).area) < 0.01;
}

function point(p: Vec): paper.Point {
  return new (ps().Point)(p.x, p.y);
}

/** Les sous-tracés fermés d'un contour (les traits ouverts ne délimitent pas de surface). */
function closedPart(cmds: PathCommand[] | null): PathCommand[] {
  if (!cmds?.length) return [];
  return fromSubpaths(toSubpaths(cmds).filter((sp) => sp.closed && sp.anchors.length > 1));
}

function openPart(cmds: PathCommand[] | null): PathCommand[] {
  if (!cmds?.length) return [];
  return fromSubpaths(toSubpaths(cmds).filter((sp) => !sp.closed && sp.anchors.length > 1));
}

/**
 * Morceaux d'un seul tenant : chaque contour extérieur avec ses trous. Un contour est un trou s'il
 * est à l'intérieur d'un nombre impair d'autres contours (les contours d'un résultat ne se croisent
 * pas : un point pris sur l'un suffit à savoir s'il est dans l'autre).
 */
function components(item: paper.PathItem): paper.PathItem[] {
  if (isEmpty(item)) return [];
  const all = item.className === 'CompoundPath' ? (item.children as paper.Path[]) : [item as paper.Path];
  const paths = all.filter((p) => Math.abs(p.area) > 1e-6);
  if (paths.length <= 1) return [item];
  const inner = paths.map((p) => p.getPointAt(p.length * 0.37));
  const depth = paths.map((_, i) => paths.filter((q, j) => j !== i && q.contains(inner[i])).length);
  const groups = new Map<number, paper.Path[]>();
  paths.forEach((p, i) => depth[i] % 2 === 0 && groups.set(i, [p]));
  paths.forEach((p, i) => {
    if (depth[i] % 2 === 0) return;
    // Le trou va au contour extérieur le plus petit qui le contient.
    let best = -1;
    for (const [o] of groups)
      if (
        depth[o] === depth[i] - 1 &&
        paths[o].contains(inner[i]) &&
        (best < 0 || Math.abs(paths[o].area) < Math.abs(paths[best].area))
      )
        best = o;
    if (best >= 0) groups.get(best)!.push(p);
  });
  const s = ps();
  return [...groups.values()].map((g) => {
    const c = new s.CompoundPath({ children: g.map((p) => p.clone(OPTS)), insert: false });
    c.fillRule = 'evenodd';
    return c;
  });
}

/** Morceaux d'un seul tenant d'un contour (chaque forme avec ses trous). */
export function splitPieces(
  cmds: PathCommand[],
  fillRule: 'nonzero' | 'evenodd' = 'nonzero',
): PathCommand[][] {
  return components(toItem(cmds, fillRule)).map(fromItem);
}

/** Réunit des contours en un seul. */
export function uniteAll(list: PathCommand[][]): PathCommand[] {
  const shapes = list.filter((c) => c.length).map((cmds) => ({ cmds }));
  if (!shapes.length) return [];
  return booleanCommands(shapes, 'unite')[0]?.cmds ?? [];
}

/**
 * Trouve les zones formées par des formes qui se chevauchent. Les zones déjà calculées sont
 * gardées : le survol d'une zone à l'autre reste fluide.
 */
export class RegionFinder {
  private readonly items: paper.PathItem[];
  private readonly cache = new Map<string, { item: paper.PathItem; cmds: PathCommand[] }[]>();

  constructor(shapes: RegionShape[]) {
    this.items = shapes.map((s) => toItem(s.cmds, s.fillRule));
  }

  get size(): number {
    return this.items.length;
  }

  /** Indices des formes qui contiennent le point. */
  inside(p: Vec): number[] {
    const q = point(p);
    const out: number[] = [];
    this.items.forEach((it, i) => it.contains(q) && out.push(i));
    return out;
  }

  /** Zone sous le point (le morceau d'un seul tenant qui le contient), ou null hors des formes. */
  at(p: Vec): Region | null {
    const shapes = this.inside(p);
    if (!shapes.length) return null;
    const key = shapes.join(',');
    let parts = this.cache.get(key);
    if (!parts) {
      parts = components(this.compute(shapes)).map((item) => ({ item, cmds: fromItem(item) }));
      this.cache.set(key, parts);
    }
    const q = point(p);
    const k = parts.findIndex((c) => c.item.contains(q));
    return k < 0 ? null : { id: `${key}#${k}`, shapes, cmds: parts[k].cmds };
  }

  private compute(shapes: number[]): paper.PathItem {
    let r = this.items[shapes[0]];
    for (const i of shapes.slice(1)) r = r.intersect(this.items[i], OPTS);
    const own = new Set(shapes);
    this.items.forEach((it, i) => {
      if (!own.has(i) && !isEmpty(r) && r.bounds.intersects(it.bounds)) r = r.subtract(it, OPTS);
    });
    return r;
  }
}

// ————— Constructeur de formes —————

export type ShapeBuilderMode = 'add' | 'subtract' | 'create';

/** Formes du constructeur : les objets choisis qui ont un contour fermé, du dessous vers le dessus. */
export function builderShapes(doc: PoulpeDocument, ids: string[]): { id: string; shape: RegionShape }[] {
  const top = new Set(topLevelIds(doc, ids));
  const out: { id: string; shape: RegionShape }[] = [];
  for (const l of walkDocument(doc)) {
    if (!top.has(l.node.id) || l.node.locked || !l.node.visible) continue;
    const cmds = closedPart(worldOutline(l.node));
    if (!cmds.length) continue;
    out.push({
      id: l.node.id,
      shape: { cmds, fillRule: l.node.type === 'path' ? l.node.fillRule : undefined },
    });
  }
  return out;
}

/**
 * Constructeur de formes : les zones sous les points `points` (une par zone suffit) sont réunies.
 * - `add` : elles deviennent une seule nouvelle forme, retirée des formes d'origine ;
 * - `subtract` : elles sont retirées des formes ;
 * - `create` : elles deviennent une nouvelle forme, les formes d'origine restent intactes.
 * La nouvelle forme prend le style de la forme du dessus dans la première zone. Renvoie les ids à
 * sélectionner (les formes restantes et la nouvelle), ou null si aucune zone n'est touchée.
 */
export function applyShapeBuilder(
  doc: PoulpeDocument,
  ids: string[],
  points: Vec[],
  mode: ShapeBuilderMode,
  name: string,
): string[] | null {
  const list = builderShapes(doc, ids);
  if (!list.length) return null;
  const finder = new RegionFinder(list.map((l) => l.shape));
  const picked = new Map<string, Region>();
  for (const p of points) {
    const r = finder.at(p);
    if (r && r.cmds.length && !picked.has(r.id)) picked.set(r.id, r);
  }
  if (!picked.size) return null;
  const regions = [...picked.values()];
  const union = uniteAll(regions.map((r) => r.cmds));
  if (!union.length) return null;
  const involved = new Set(regions.flatMap((r) => r.shapes));
  const created: string[] = [];
  if (mode !== 'subtract') {
    const style = findNode(doc, list[Math.max(...regions[0].shapes)].id)!.node;
    const node = pathNodeFromWorld(union, style, name);
    // Au-dessus de la plus haute forme touchée (ou de toutes, pour une forme créée à part).
    const anchor = findNode(doc, list[mode === 'create' ? list.length - 1 : Math.max(...involved)].id)!;
    anchor.parent.children.splice(anchor.index + 1, 0, node);
    created.push(node.id);
  }
  const kept: string[] = [];
  list.forEach((l, i) => {
    if (mode === 'create' || !involved.has(i)) {
      kept.push(l.id);
      return;
    }
    const loc = findNode(doc, l.id);
    if (!loc) return;
    const rest = booleanCommands([l.shape, { cmds: union }], 'subtract');
    if (!rest.length) {
      loc.parent.children.splice(loc.index, 1);
      return;
    }
    const node = pathNodeFromWorld(rest[0].cmds, loc.node, loc.node.name);
    node.id = l.id;
    loc.parent.children.splice(loc.index, 1, node);
    kept.push(l.id);
  });
  return [...kept, ...created];
}

// ————— Remplissage de zone —————

/** Un objet qui borne les zones : sa surface fermée et ses traits ouverts (en coordonnées du monde). */
export interface FillObstacle {
  closed: RegionShape | null;
  open: PathCommand[] | null;
}

/** Bande très fine autour des traits ouverts : ils séparent les zones sans en couvrir. */
function sliver(cmds: PathCommand[], half: number): paper.PathItem | null {
  const s = ps();
  const children: paper.Path[] = [];
  for (const flat of flattenCommands(cmds, Math.max(0.05, half))) {
    // Sans points confondus : chaque point a une direction.
    const points = flat.points.filter(
      (p, i, all) => !i || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > half * 1e-3,
    );
    if (points.length < 2) continue;
    const left: Vec[] = [];
    const right: Vec[] = [];
    points.forEach((p, i) => {
      // Normale moyenne des deux segments voisins.
      const a = points[Math.max(0, i - 1)],
        b = points[Math.min(points.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len,
        ny = (b.x - a.x) / len;
      left.push({ x: p.x + nx * half, y: p.y + ny * half });
      right.push({ x: p.x - nx * half, y: p.y - ny * half });
    });
    const pts = [...left, ...right.reverse()].map((p) => [p.x, p.y]);
    children.push(new s.Path({ segments: pts, closed: true, insert: false }));
  }
  if (!children.length) return null;
  return new s.CompoundPath({ children, insert: false });
}

/**
 * Zone fermée sous `p`, délimitée par les surfaces des objets et par leurs traits ouverts (bandes
 * de demi-largeur `gap`). Renvoie null si le point n'est dans aucune zone fermée. Le calcul se fait
 * dans une fenêtre qui grandit autour du point : seuls les objets proches comptent.
 */
export function fillArea(obstacles: FillObstacle[], p: Vec, gap = 0.01): PathCommand[] | null {
  const s = ps();
  const q = point(p);
  const items = obstacles.map((o) => {
    const closed = o.closed?.cmds.length ? toItem(o.closed.cmds, o.closed.fillRule) : null;
    const open = o.open?.length ? o.open : null;
    const ob = open && exactBounds(open);
    return {
      closed,
      open,
      openBounds: ob
        ? new s.Rectangle(ob.x - gap, ob.y - gap, ob.width + 2 * gap, ob.height + 2 * gap)
        : null,
      band: undefined as paper.PathItem | null | undefined,
    };
  });
  const containing = items.filter((o) => o.closed?.contains(q));
  let all: paper.Rectangle | null = null;
  for (const o of items)
    for (const b of [o.closed?.bounds, o.openBounds]) if (b) all = all ? all.unite(b) : b.clone();
  if (!all) return null;
  let win = containing.length
    ? containing.map((o) => o.closed!.bounds).reduce((a, b) => a.intersect(b))
    : new s.Rectangle(p.x - 16, p.y - 16, 32, 32);
  win = win.expand(2);
  for (;;) {
    let r: paper.PathItem = new s.Path.Rectangle({ rectangle: win, insert: false });
    for (const o of containing) r = r.intersect(o.closed!, OPTS);
    for (const o of items) {
      if (isEmpty(r)) return null;
      if (o.closed && !containing.includes(o) && o.closed.bounds.intersects(r.bounds))
        r = r.subtract(o.closed, OPTS);
      if (o.openBounds?.intersects(r.bounds)) {
        if (o.band === undefined) o.band = sliver(o.open!, gap);
        if (o.band) r = r.subtract(o.band, OPTS);
      }
    }
    const piece = components(r).find((c) => c.contains(q));
    if (!piece) return null;
    const b = piece.bounds;
    const e = 1e-4;
    const touches =
      b.left <= win.left + e ||
      b.top <= win.top + e ||
      b.right >= win.right - e ||
      b.bottom >= win.bottom - e;
    if (!touches || containing.length) return fromItem(piece);
    // La zone touche le bord de la fenêtre : elle est peut-être plus grande, ou ouverte.
    if (win.contains(all)) return null;
    win = win.expand(win.width, win.height);
  }
}

/** Objets qui bornent les zones : les feuilles visibles (pas les groupes), du dessous vers le dessus. */
function fillLeaves(nodes: SceneNode[], out: SceneNode[]): void {
  for (const n of nodes) {
    if (!n.visible || n.type === 'adjustment') continue;
    if (n.type === 'group') fillLeaves(n.children, out);
    else out.push(n);
  }
}

function obstacleOf(n: SceneNode): FillObstacle | null {
  if (n.type === 'image') {
    const c = corners(n);
    const cmds: PathCommand[] = [
      { op: 'M', x: c[0].x, y: c[0].y },
      ...c.slice(1).map((v) => ({ op: 'L' as const, x: v.x, y: v.y })),
      { op: 'Z' },
    ];
    return { closed: { cmds }, open: null };
  }
  const outline = worldOutline(n);
  if (!outline?.length) return null;
  const closed = closedPart(outline);
  const open = openPart(outline);
  return {
    closed: closed.length ? { cmds: closed, fillRule: n.type === 'path' ? n.fillRule : undefined } : null,
    open: open.length ? open : null,
  };
}

/**
 * Remplissage de zone vectoriel : la zone fermée sous `p`, formée par les objets visibles du plan
 * de travail (ou par ceux de `ids`), devient un nouveau tracé rempli de `paint`. Il se place
 * juste au-dessus de l'objet le plus haut dont la surface contient le point (sinon tout en
 * dessous, derrière les traits qui le bordent). Renvoie son id, ou null sans zone fermée.
 */
export function applyVectorFill(
  doc: PoulpeDocument,
  artboardId: string,
  p: Vec,
  paint: Paint,
  name: string,
  ids: string[] | null = null,
  gap = 0.01,
): string | null {
  const ab = findArtboard(doc, artboardId);
  if (!ab) return null;
  const leaves: SceneNode[] = [];
  if (ids) {
    const top = new Set(topLevelIds(doc, ids));
    fillLeaves(
      ab.children.flatMap(function pick(n): SceneNode[] {
        if (top.has(n.id)) return [n];
        return n.type === 'group' ? n.children.flatMap(pick) : [];
      }),
      leaves,
    );
  } else fillLeaves(ab.children, leaves);
  const obstacles = leaves.map(obstacleOf);
  const used = leaves.filter((_, i) => obstacles[i]);
  const list = obstacles.filter((o): o is FillObstacle => !!o);
  const cmds = fillArea(list, p, gap);
  if (!cmds?.length) return null;
  const b = exactBounds(cmds);
  if (!b) return null;
  const node = createPath({ ...b, d: pathToSvg(cmds), viewBox: b, fillRule: 'evenodd', name });
  node.fill = structuredClone(paint);
  node.stroke = { ...node.stroke, paint: { type: 'none' } };
  // Au-dessus de l'objet le plus haut dont la surface contient le point.
  const q = point(p);
  let above: SceneNode | null = null;
  list.forEach((o, i) => {
    if (o.closed && toItem(o.closed.cmds, o.closed.fillRule).contains(q)) above = used[i];
  });
  const loc = above ? findNode(doc, (above as SceneNode).id) : null;
  const parent: Parent = loc ? loc.parent : ab;
  parent.children.splice(loc ? loc.index + 1 : 0, 0, node);
  return node.id;
}

// ————— Cutter à main levée —————

function polyCmds(points: Vec[]): PathCommand[] {
  return [
    { op: 'M', x: points[0].x, y: points[0].y },
    ...points.slice(1).map((v) => ({ op: 'L' as const, x: v.x, y: v.y })),
  ];
}

/**
 * Partie utile d'une ligne de coupe : de juste avant son premier passage du bord de la forme à juste
 * après le dernier. Une coupe qui commence ou finit dans la forme n'y laisse pas d'entaille.
 * Renvoie null si la ligne ne traverse pas le bord.
 */
function crossingPart(points: Vec[], inside: (p: Vec) => boolean): Vec[] | null {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  const step = Math.max(total / 600, 0.05);
  const pts: Vec[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const flags = pts.map(inside);
  let first = -1,
    last = -1;
  for (let i = 1; i < pts.length; i++)
    if (flags[i] !== flags[i - 1]) {
      if (first < 0) first = i - 1;
      last = i;
    }
  if (first < 0) return null;
  return pts.slice(first, last + 1);
}

/**
 * Cutter à main levée : la ligne brisée `points` (monde) coupe les objets `ids` partout où elle
 * passe. Une forme pleine traversée donne un objet par morceau ; un tracé ouvert est séparé à
 * chaque croisement. `gap` : demi-largeur de la coupe. Renvoie les ids créés, ou null.
 */
export function applyKnifePath(
  doc: PoulpeDocument,
  ids: string[],
  points: Vec[],
  name: string,
  gap = 0.01,
): string[] | null {
  if (points.length < 2) return null;
  const created: string[] = [];
  for (const id of topLevelIds(doc, ids)) {
    const loc = findNode(doc, id);
    if (!loc || loc.node.locked) continue;
    const outline = worldOutline(loc.node);
    if (!outline?.length) continue;
    const fillRule = loc.node.type === 'path' ? loc.node.fillRule : undefined;
    let pieces: PathCommand[][];
    if (hasClosedSubpath(outline)) {
      const item = toItem(outline, fillRule);
      const cut = crossingPart(points, (v) => item.contains(point(v)));
      const band = cut && sliver(polyCmds(cut), gap);
      if (!band) continue;
      const parts = components(item.subtract(band, OPTS));
      if (parts.length < 2) continue;
      pieces = parts.map(fromItem);
    } else {
      let cmds = outline;
      let cuts = 0;
      for (let i = 1; i < points.length; i++) {
        const r = knifeOpenPath(cmds, points[i - 1], points[i]);
        if (r) {
          cmds = r;
          cuts++;
        }
      }
      if (!cuts) continue;
      pieces = [cmds];
    }
    const nodes = pieces.map((cmds) => pathNodeFromWorld(cmds, loc.node, name));
    loc.parent.children.splice(loc.index, 1, ...nodes);
    created.push(...nodes.map((n) => n.id));
  }
  return created.length ? created : null;
}
