import {
  anchorKey,
  anchorsOf,
  applyBoolean,
  applyKnife,
  artboardAt,
  bendSegment,
  breakAtAnchors,
  cachedSvgPath,
  cloneSubpaths,
  cornerKeys,
  createPath,
  cutPathAtPoint,
  deleteAnchors,
  deleteSegment,
  exactBounds,
  findArtboard,
  findNode,
  fitDeleteAnchors,
  fromSubpaths,
  hasClosedSubpath,
  insertAnchor,
  isSmooth,
  joinEnds,
  keysOf,
  markSmart,
  moveAnchors,
  moveHandle,
  nearestEnds,
  nearestSegment,
  newId,
  parseAnchorKey,
  pathToSvg,
  pathToWorld,
  refreshSmart,
  removeNodes,
  reverseSubpaths,
  roundCorners,
  segmentCount,
  segmentCubic,
  setAnchorKind,
  setPathCommands,
  simplifyPoints,
  smartMarks,
  smoothSubpaths,
  splitAfterAnchors,
  straightenSegment,
  subpathsOfKeys,
  toPathNode,
  topLevelIds,
  toSubpaths,
  worldToPath,
  type Anchor,
  type PathCommand,
  type PathNode,
  type Paint,
  type Stroke,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import { t } from '../i18n';
import { editor, toast, ui } from '../store';
import type { CanvasController } from './controller';
import { collectSnapLines, snapPoint, type SnapLines } from './snapping';

/*
 * Outils de tracé : plume (courbes de Bézier nœud par nœud), crayon (main levée, lissé) et
 * outil Nœud (modifier les nœuds et poignées d'un tracé). Tous passent par les gestes de
 * l'éditeur : chaque tracé, chaque modification de nœuds s'annule en une fois.
 */

const HIT = 7;

/** Poignées du cadre de transformation des nœuds (option « Transformer »). */
type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';
interface Box4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type NodeDrag =
  | {
      kind: 'anchors';
      id: string;
      base: SubPath[];
      start: Vec;
      keys: string[];
      moved: boolean;
      /** Nœud saisi (repère du tracé) : c'est lui qui s'aimante. */
      grab: Vec;
      /** Autres nœuds du tracé (monde), pour s'aligner dessus. */
      targets: Vec[];
      lines: SnapLines | null;
    }
  | { kind: 'handle'; id: string; base: SubPath[]; key: string; which: 'in' | 'out'; smooth: boolean }
  | {
      kind: 'segment';
      id: string;
      base: SubPath[];
      si: number;
      seg: number;
      t: number;
      startScreen: Vec;
      moved: boolean;
      /** Simple clic : ajouter un nœud, redresser (Alt) ou supprimer le segment (Ctrl). */
      mod: SegmentMod;
    }
  | {
      kind: 'box';
      id: string;
      base: SubPath[];
      keys: string[];
      handle: BoxHandle;
      /** Cadre des nœuds sélectionnés (monde), centre et point de départ du pointeur. */
      box: Box4;
      center: Vec;
      start: Vec;
      startScreen: Vec;
      moved: boolean;
    };

type SegmentMod = 'add' | 'straighten' | 'delete';

/** Actions de l'outil Nœud (barre contextuelle, menu du clic droit, raccourcis). */
export type NodeAction =
  | 'sharp'
  | 'smooth'
  | 'smart'
  | 'delete'
  | 'fitDelete'
  | 'toggleClosed'
  | 'split'
  | 'break'
  | 'smoothCurve'
  | 'join'
  | 'reverse';

/** Écrit des sous-tracés dans un tracé (brouillon), avec ses nœuds intelligents. */
function writePath(n: PathNode, sps: SubPath[]): void {
  setPathCommands(n, fromSubpaths(sps));
  const marks = smartMarks(sps);
  if (marks.length) n.smartNodes = marks;
  else delete n.smartNodes;
}

/** Effet d'un clic sur un segment, d'après les touches : comme dans Affinity. */
function segmentMod(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): SegmentMod {
  return e.ctrlKey || e.metaKey ? 'delete' : e.altKey ? 'straighten' : 'add';
}

const unit = (v: Vec): Vec | null => {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-9 ? null : { x: v.x / l, y: v.y / l };
};

/** Effet d'une sélection de nœuds à la zone (comme dans Affinity). */
type NodeSelOp = 'replace' | 'add' | 'subtract' | 'toggle';

interface PenState {
  id: string;
  artboardId: string;
  anchors: Anchor[];
  closed: boolean;
  /** Nœud dont on tire les poignées (bouton enfoncé). */
  dragIndex: number | null;
}

/** Contour visible pour les tracés dessinés : celui des réglages, ou un trait sombre de 2 px. */
function drawnStroke(): Stroke {
  const s = ui.get().defaults.stroke;
  return s.paint.type === 'none'
    ? { paint: { type: 'solid', color: '#1a1a1d' }, width: 2 }
    : { ...s, width: Math.max(0.5, s.width) };
}

function insidePolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function constrain45(from: Vec, p: Vec): Vec {
  const dx = p.x - from.x,
    dy = p.y - from.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy) * Math.cos(Math.atan2(dy, dx) - ang);
  return { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
}

export class PathTools {
  private pen: PenState | null = null;
  private hover: Vec | null = null;
  private pencil: { points: Vec[]; artboardId: string } | null = null;
  private drag: NodeDrag | null = null;
  /** Ligne en cours de tracé (cutter, Shape Builder). */
  private line: { tool: 'knife' | 'shapeBuilder'; a: Vec; b: Vec; alt: boolean } | null = null;
  /** Arrondi en cours (outil Coin). */
  private corner: {
    node: PathNode;
    base: SubPath[];
    keys: string[];
    origin: Vec;
    radius: number;
  } | null = null;
  /** Sélection de nœuds au cadre ou au lasso (outil Nœud), en cours de glissement. */
  private nodeSel: {
    id: string;
    mode: 'rect' | 'lasso';
    points: Vec[];
    op: NodeSelOp;
    base: string[];
    startScreen: Vec;
    moved: boolean;
  } | null = null;
  /** Sélection de nœuds au polygone (Alt+clic), sommet par sommet. */
  private polygon: { id: string; points: Vec[]; hover: Vec | null; op: NodeSelOp; base: string[] } | null =
    null;
  /** Segment survolé par l'outil Nœud (repère du tracé) : il s'éclaire avant le clic. */
  private segHover: { id: string; si: number; seg: number; point: Vec; mod: SegmentMod } | null = null;
  /** Repères d'aimantation des nœuds et des poignées (monde), pendant un glissement. */
  private snapGuides: { a: Vec; b: Vec }[] = [];

  constructor(private readonly c: CanvasController) {
    window.addEventListener('poulpe:toolchange', this.finishPen);
    window.addEventListener('poulpe:toolchange', this.cancelNodeSelect);
  }

  dispose(): void {
    window.removeEventListener('poulpe:toolchange', this.finishPen);
    window.removeEventListener('poulpe:toolchange', this.cancelNodeSelect);
  }

  get busy(): boolean {
    return !!(
      this.pen ||
      this.pencil ||
      this.drag ||
      this.line ||
      this.corner ||
      this.nodeSel ||
      this.polygon
    );
  }

  private dist(a: Vec, b: Vec): number {
    const sa = this.c.toScreen(a),
      sb = this.c.toScreen(b);
    return Math.hypot(sa.x - sb.x, sa.y - sb.y);
  }

  /** Tracé modifiable par l'outil Nœud : le seul objet sélectionné, s'il est un tracé. */
  editablePath(): PathNode | null {
    if (ui.get().tool !== 'direct') return null;
    const sel = editor.selection;
    if (sel.length !== 1) return null;
    const n = findNode(editor.doc, sel[0])?.node;
    return n?.type === 'path' && !n.locked && n.visible ? n : null;
  }

  // ————— Plume —————

  private snapPen(p: Vec, shift: boolean, ctrl: boolean): Vec {
    const pen = this.pen;
    const last = pen?.anchors[pen.anchors.length - 1];
    if (shift && last) return constrain45(last, p);
    if (!this.c.snapping() || ctrl) return p;
    const lines = collectSnapLines(editor.doc, new Set(pen ? [pen.id] : []));
    return snapPoint(p, lines, this.c.snapThreshold(), this.c.gridStep());
  }

  private updatePen(): void {
    const pen = this.pen;
    if (!pen) return;
    const cmds = fromSubpaths([{ anchors: pen.anchors, closed: pen.closed }]);
    const b = exactBounds(cmds) ?? { x: pen.anchors[0].x, y: pen.anchors[0].y, width: 0, height: 0 };
    const d = pathToSvg(cmds);
    const fill: Paint = pen.closed ? ui.get().defaults.fill : { type: 'none' };
    editor.preview((doc) => {
      let n = findNode(doc, pen.id)?.node;
      if (!n) {
        const ab = findArtboard(doc, pen.artboardId) ?? doc.artboards[0];
        const created = createPath(
          { ...b, d, viewBox: b, name: t('name.curve') },
          { ...ui.get().defaults, stroke: drawnStroke() },
        );
        created.id = pen.id;
        ab.children.push(created);
        n = ab.children[ab.children.length - 1];
      }
      if (n.type !== 'path') return;
      Object.assign(n, { x: b.x, y: b.y, width: b.width, height: b.height, d, viewBox: { ...b } });
      n.fill = fill;
      return [pen.id];
    });
  }

  /** Termine le tracé en cours à la plume (Entrée, Échap, changement d'outil). */
  finishPen = (): void => {
    const pen = this.pen;
    if (!pen) return;
    this.pen = null;
    this.hover = null;
    if (pen.anchors.length < 2) editor.cancel();
    else {
      editor.commit('history.pen');
      editor.select([pen.id]);
    }
    this.c.requestDraw();
  };

  private penDown(e: PointerEvent, p: Vec): void {
    const doc = editor.doc;
    if (!this.pen) {
      const ab = artboardAt(doc, p) ?? findArtboard(doc, editor.getState().activeArtboardId);
      if (!ab) return;
      editor.setActiveArtboard(ab.id);
      this.pen = { id: newId(), artboardId: ab.id, anchors: [], closed: false, dragIndex: null };
    }
    const pen = this.pen;
    const a = pen.anchors;
    if (a.length >= 2 && this.dist(a[0], p) <= HIT + 1) {
      // Clic sur le premier nœud : le tracé se ferme (et prend le remplissage courant).
      pen.closed = true;
      pen.dragIndex = 0;
      this.updatePen();
      return;
    }
    if (a.length && this.dist(a[a.length - 1], p) <= 3) {
      // Second clic au même endroit (double-clic) : fin du tracé ouvert.
      this.finishPen();
      return;
    }
    const q = this.snapPen(p, e.shiftKey, e.ctrlKey);
    a.push({ x: q.x, y: q.y, in: null, out: null });
    pen.dragIndex = a.length - 1;
    this.updatePen();
  }

  private penMove(e: PointerEvent, p: Vec): void {
    const pen = this.pen;
    if (!pen) return;
    if (pen.dragIndex === null) {
      this.hover = this.snapPen(p, e.shiftKey, e.ctrlKey);
      this.c.requestDraw();
      return;
    }
    const a = pen.anchors[pen.dragIndex];
    if (this.dist(a, p) < 3 && !a.out) return;
    const q = e.shiftKey ? constrain45(a, p) : p;
    // On tire la poignée de sortie ; Alt casse la symétrie (nœud anguleux).
    if (pen.closed && pen.dragIndex === 0) {
      // En refermant, on règle la poignée d'arrivée sur le premier nœud.
      const mirrored = { x: 2 * a.x - q.x, y: 2 * a.y - q.y };
      moveHandle(a, 'in', mirrored, e.altKey ? false : 'symmetric');
    } else moveHandle(a, 'out', q, e.altKey ? false : 'symmetric');
    this.updatePen();
  }

  private penUp(): void {
    const pen = this.pen;
    if (!pen) return;
    pen.dragIndex = null;
    if (pen.closed) this.finishPen();
  }

  // ————— Crayon —————

  private pencilUp(): void {
    const pc = this.pencil;
    this.pencil = null;
    if (!pc || pc.points.length < 2) {
      this.c.requestDraw();
      return;
    }
    const pts = pc.points;
    const zoom = this.c.view.zoom;
    const closed = pts.length > 8 && this.dist(pts[0], pts[pts.length - 1]) < 10;
    const smoothing = ui.get().pencilSmoothing / 100;
    const cmds = simplifyPoints(pts, (0.3 + smoothing * 8) / zoom, closed);
    const b = exactBounds(cmds);
    if (!b) return;
    const node = createPath(
      { ...b, d: pathToSvg(cmds), viewBox: b, name: t('name.curve') },
      { ...ui.get().defaults, stroke: drawnStroke() },
    );
    node.fill = { type: 'none' };
    editor.apply('history.pencil', (d) => {
      (findArtboard(d, pc.artboardId) ?? d.artboards[0]).children.push(node);
      return [node.id];
    });
  }

  // ————— Outil Nœud —————

  private subpathsOf(n: PathNode): SubPath[] {
    return markSmart(toSubpaths(cachedSvgPath(n.d)), n.smartNodes);
  }

  /** Nœud ou poignée sous le point écran. */
  private hitAnchor(n: PathNode, sps: SubPath[], s: Vec): { key: string; which: 'in' | 'out' | null } | null {
    const sel = new Set(ui.get().nodeSelection);
    const scr = (p: Vec) => this.c.toScreen(pathToWorld(n, p));
    const near = (p: Vec) => {
      const q = scr(p);
      return Math.hypot(q.x - s.x, q.y - s.y) <= HIT;
    };
    // Les poignées des nœuds sélectionnés passent en premier : elles peuvent recouvrir un nœud.
    for (let si = 0; si < sps.length; si++)
      for (let ai = 0; ai < sps[si].anchors.length; ai++) {
        const key = anchorKey(si, ai);
        if (!sel.has(key)) continue;
        const a = sps[si].anchors[ai];
        if (a.out && near(a.out)) return { key, which: 'out' };
        if (a.in && near(a.in)) return { key, which: 'in' };
      }
    for (let si = 0; si < sps.length; si++)
      for (let ai = 0; ai < sps[si].anchors.length; ai++)
        if (near(sps[si].anchors[ai])) return { key: anchorKey(si, ai), which: null };
    return null;
  }

  private nodeDown(e: PointerEvent, p: Vec, s: Vec, n: PathNode): boolean {
    const sps = this.subpathsOf(n);
    const handle = this.boxHit(n, sps, s);
    const nb = handle && this.nodeBox(n, sps);
    if (handle && nb) {
      editor.begin();
      this.drag = {
        kind: 'box',
        id: n.id,
        base: sps,
        keys: ui.get().nodeSelection,
        handle,
        box: nb.box,
        center: nb.center,
        start: p,
        startScreen: s,
        moved: false,
      };
      return true;
    }
    const hit = this.hitAnchor(n, sps, s);
    const pp = worldToPath(n, p);
    if (hit?.which) {
      const [si, ai] = parseAnchorKey(hit.key);
      editor.begin();
      this.drag = {
        kind: 'handle',
        id: n.id,
        base: sps,
        key: hit.key,
        which: hit.which,
        smooth: isSmooth(sps[si].anchors[ai]),
      };
      return true;
    }
    if (hit) {
      if (e.altKey) {
        // Alt+clic sur un nœud : il devient net, comme dans Affinity.
        ui.set({ nodeSelection: [hit.key] });
        this.editNodes('sharp');
        return true;
      }
      let sel = ui.get().nodeSelection;
      if (e.shiftKey) sel = sel.includes(hit.key) ? sel.filter((k) => k !== hit.key) : [...sel, hit.key];
      else if (!sel.includes(hit.key)) sel = [hit.key];
      ui.set({ nodeSelection: sel });
      if (!sel.includes(hit.key)) return true;
      const [si, ai] = parseAnchorKey(hit.key);
      const grab = sps[si].anchors[ai];
      const chosen = new Set(sel);
      const targets: Vec[] = [];
      sps.forEach((sp, i) =>
        sp.anchors.forEach((a, j) => !chosen.has(anchorKey(i, j)) && targets.push(pathToWorld(n, a))),
      );
      editor.begin();
      this.drag = {
        kind: 'anchors',
        id: n.id,
        base: sps,
        start: pp,
        keys: sel,
        moved: false,
        grab: { x: grab.x, y: grab.y },
        targets,
        lines: this.c.snapping() ? collectSnapLines(editor.doc, new Set([n.id])) : null,
      };
      return true;
    }
    const seg = nearestSegment(sps, pp);
    if (seg) {
      const q = this.c.toScreen(pathToWorld(n, seg.point));
      if (Math.hypot(q.x - s.x, q.y - s.y) <= HIT) {
        editor.begin();
        this.drag = {
          kind: 'segment',
          id: n.id,
          base: sps,
          si: seg.si,
          seg: seg.seg,
          t: seg.t,
          startScreen: s,
          moved: false,
          mod: segmentMod(e),
        };
        return true;
      }
    }
    return false;
  }

  /** Clic droit sur un nœud : il est sélectionné (s'il ne l'était pas) pour le menu des nœuds. */
  nodeMenuAt(s: Vec): boolean {
    const n = this.editablePath();
    if (!n) return false;
    const hit = this.hitAnchor(n, this.subpathsOf(n), s);
    if (!hit) return false;
    if (!ui.get().nodeSelection.includes(hit.key)) ui.set({ nodeSelection: [hit.key] });
    return true;
  }

  // ————— Cadre de transformation des nœuds —————

  /** Cadre des nœuds sélectionnés (monde) et sa version écran, agrandie d'une marge. */
  private nodeBox(n: PathNode, sps: SubPath[]): { box: Box4; center: Vec; scr: Box4 } | null {
    if (!ui.get().nodeOptions.transform) return null;
    const keys = ui.get().nodeSelection;
    if (keys.length < 2) return null;
    const pts = [...anchorsOf(sps, keys)].map((a) => pathToWorld(n, a));
    if (pts.length < 2) return null;
    const box = {
      x0: Math.min(...pts.map((q) => q.x)),
      y0: Math.min(...pts.map((q) => q.y)),
      x1: Math.max(...pts.map((q) => q.x)),
      y1: Math.max(...pts.map((q) => q.y)),
    };
    const a = this.c.toScreen({ x: box.x0, y: box.y0 }),
      b = this.c.toScreen({ x: box.x1, y: box.y1 });
    const pad = 10;
    return {
      box,
      center: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 },
      scr: { x0: a.x - pad, y0: a.y - pad, x1: b.x + pad, y1: b.y + pad },
    };
  }

  private boxHandles(b: Box4): [BoxHandle, Vec][] {
    const mx = (b.x0 + b.x1) / 2,
      my = (b.y0 + b.y1) / 2;
    return [
      ['nw', { x: b.x0, y: b.y0 }],
      ['n', { x: mx, y: b.y0 }],
      ['ne', { x: b.x1, y: b.y0 }],
      ['e', { x: b.x1, y: my }],
      ['se', { x: b.x1, y: b.y1 }],
      ['s', { x: mx, y: b.y1 }],
      ['sw', { x: b.x0, y: b.y1 }],
      ['w', { x: b.x0, y: my }],
    ];
  }

  /** Poignée du cadre de transformation sous le point écran (un peu en dehors d'un coin : rotation). */
  private boxHit(n: PathNode, sps: SubPath[], s: Vec): BoxHandle | null {
    const nb = this.nodeBox(n, sps);
    if (!nb) return null;
    let rotate = false;
    for (const [h, q] of this.boxHandles(nb.scr)) {
      const d = Math.hypot(q.x - s.x, q.y - s.y);
      if (d <= 6) return h;
      const outside = s.x < nb.scr.x0 || s.x > nb.scr.x1 || s.y < nb.scr.y0 || s.y > nb.scr.y1;
      if (h.length === 2 && outside && d <= 20) rotate = true;
    }
    return rotate ? 'rotate' : null;
  }

  /** Transformation (monde → monde) du glissement en cours sur le cadre. */
  private boxTransform(g: Extract<NodeDrag, { kind: 'box' }>, p: Vec, shift: boolean): (w: Vec) => Vec {
    const c = g.center;
    if (g.handle === 'rotate') {
      let ang = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(g.start.y - c.y, g.start.x - c.x);
      if (shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      const cos = Math.cos(ang),
        sin = Math.sin(ang);
      return (w) => ({
        x: c.x + (w.x - c.x) * cos - (w.y - c.y) * sin,
        y: c.y + (w.x - c.x) * sin + (w.y - c.y) * cos,
      });
    }
    const b = g.box;
    const hx = g.handle.includes('w') ? -1 : g.handle.includes('e') ? 1 : 0;
    const hy = g.handle.includes('n') ? -1 : g.handle.includes('s') ? 1 : 0;
    // Le côté opposé à la poignée ne bouge pas.
    const ox = hx < 0 ? b.x1 : b.x0,
      oy = hy < 0 ? b.y1 : b.y0;
    const ratio = (cur: number, start: number, o: number) => {
      const r = (cur - o) / (start - o);
      return isFinite(r) ? r : 1;
    };
    let sx = hx ? ratio(p.x, g.start.x, ox) : 1,
      sy = hy ? ratio(p.y, g.start.y, oy) : 1;
    if (shift && hx && hy) sx = sy = Math.abs(sx) > Math.abs(sy) ? sx : sy;
    return (w) => ({ x: ox + (w.x - ox) * sx, y: oy + (w.y - oy) * sy });
  }

  /**
   * Sélection de nœuds à la zone, comme dans Affinity : Glisser = cadre, Alt = lasso, Alt+clic =
   * polygone ; Maj ajoute, bouton droit retire, Maj + bouton droit inverse la sélection.
   */
  nodeSelectDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    const n = this.editablePath();
    if (!n) return false;
    if (this.polygon) {
      if (e.altKey && e.button === 0) this.polygon.points.push(p);
      else this.finishPolygon();
      return true;
    }
    const right = e.button === 2;
    const op: NodeSelOp = right ? (e.shiftKey ? 'toggle' : 'subtract') : e.shiftKey ? 'add' : 'replace';
    this.nodeSel = {
      id: n.id,
      mode: e.altKey ? 'lasso' : 'rect',
      points: [p, p],
      op,
      base: ui.get().nodeSelection,
      startScreen: s,
      moved: false,
    };
    return true;
  }

  private selectInside(id: string, inside: (w: Vec) => boolean, op: NodeSelOp, base: string[]): void {
    const n = findNode(editor.doc, id)?.node;
    if (n?.type !== 'path') return;
    const hits: string[] = [];
    this.subpathsOf(n).forEach((sp, si) =>
      sp.anchors.forEach((a, ai) => {
        if (inside(pathToWorld(n, a))) hits.push(anchorKey(si, ai));
      }),
    );
    const had = new Set(base);
    const hit = new Set(hits);
    let sel: string[];
    if (op === 'replace') sel = hits;
    else if (op === 'add') sel = [...base, ...hits.filter((k) => !had.has(k))];
    else if (op === 'subtract') sel = base.filter((k) => !hit.has(k));
    else sel = [...base.filter((k) => !hit.has(k)), ...hits.filter((k) => !had.has(k))];
    ui.set({ nodeSelection: sel });
  }

  private applyNodeSel(): void {
    const g = this.nodeSel;
    if (!g) return;
    if (g.mode === 'lasso') this.selectInside(g.id, (w) => insidePolygon(w, g.points), g.op, g.base);
    else {
      const [a, b] = [g.points[0], g.points[g.points.length - 1]];
      const x0 = Math.min(a.x, b.x),
        x1 = Math.max(a.x, b.x),
        y0 = Math.min(a.y, b.y),
        y1 = Math.max(a.y, b.y);
      this.selectInside(g.id, (w) => w.x >= x0 && w.x <= x1 && w.y >= y0 && w.y <= y1, g.op, g.base);
    }
  }

  private nodeSelectUp(): void {
    const g = this.nodeSel;
    this.nodeSel = null;
    if (!g) return;
    if (g.moved) return this.applyNodeSel();
    if (g.mode === 'lasso') {
      // Alt+clic sans glisser : premier sommet d'une sélection au polygone.
      this.polygon = { id: g.id, points: [g.points[0]], hover: null, op: g.op, base: g.base };
      return;
    }
    if (g.op !== 'replace') return;
    // Simple clic dans le vide : on désélectionne les nœuds, puis l'objet.
    if (ui.get().nodeSelection.length) ui.set({ nodeSelection: [] });
    else editor.select([]);
  }

  private finishPolygon(): void {
    const g = this.polygon;
    this.polygon = null;
    if (g && g.points.length >= 3) this.selectInside(g.id, (w) => insidePolygon(w, g.points), g.op, g.base);
    this.c.requestDraw();
  }

  private cancelNodeSelect = (): void => {
    this.nodeSel = null;
    this.polygon = null;
  };

  private previewNodes(id: string, sps: SubPath[]): void {
    editor.preview((d) => {
      const n = findNode(d, id)?.node;
      if (n?.type === 'path') writePath(n, sps);
    });
  }

  /**
   * Aimantation du nœud saisi : sur les autres nœuds du tracé (alignement horizontal ou vertical),
   * puis sur les repères du document. Renvoie le déplacement corrigé (repère du tracé).
   */
  private snapAnchors(
    origin: PathNode,
    g: Extract<NodeDrag, { kind: 'anchors' }>,
    dx: number,
    dy: number,
    free: boolean,
  ): [number, number] {
    if (free) return [dx, dy];
    const w = pathToWorld(origin, { x: g.grab.x + dx, y: g.grab.y + dy });
    const thr = this.c.snapThreshold();
    let x: number | null = null,
      y: number | null = null;
    if (ui.get().nodeOptions.alignNodes) {
      let bx = thr,
        by = thr;
      for (const t of g.targets) {
        if (Math.abs(t.x - w.x) < bx) {
          bx = Math.abs(t.x - w.x);
          x = t.x;
        }
        if (Math.abs(t.y - w.y) < by) {
          by = Math.abs(t.y - w.y);
          y = t.y;
        }
      }
    }
    if (g.lines && (x === null || y === null)) {
      const r = snapPoint(w, g.lines, thr, this.c.gridStep());
      if (x === null && r.x !== w.x) x = r.x;
      if (y === null && r.y !== w.y) y = r.y;
    }
    const q = { x: x ?? w.x, y: y ?? w.y };
    // Repères : du nœud aligné jusqu'au nœud déplacé.
    for (const t of g.targets) {
      if (x !== null && t.x === x) this.snapGuides.push({ a: t, b: q });
      if (y !== null && t.y === y) this.snapGuides.push({ a: t, b: q });
    }
    const pq = worldToPath(origin, q);
    return [pq.x - g.grab.x, pq.y - g.grab.y];
  }

  /**
   * Aimantation de construction d'une poignée : alignée sur le nœud voisin, à 90° de lui, ou dans le
   * prolongement de l'autre poignée. Renvoie la position corrigée (repère du tracé).
   */
  private snapHandle(
    origin: PathNode,
    sp: SubPath,
    ai: number,
    which: 'in' | 'out',
    q: Vec,
    mirrored: boolean,
  ): Vec {
    const a = sp.anchors[ai];
    const n = sp.anchors.length;
    const nb =
      which === 'out'
        ? (sp.anchors[ai + 1] ?? (sp.closed ? sp.anchors[0] : null))
        : (sp.anchors[ai - 1] ?? (sp.closed ? sp.anchors[n - 1] : null));
    const W = (v: Vec) => pathToWorld(origin, v);
    const wa = W(a),
      wq = W(q);
    const v = { x: wq.x - wa.x, y: wq.y - wa.y };
    const len = Math.hypot(v.x, v.y);
    const dir = unit(v);
    if (!dir) return q;
    const cands: Vec[] = [];
    const toNb = nb && unit({ x: W(nb).x - wa.x, y: W(nb).y - wa.y });
    if (toNb) cands.push(toNb, { x: -toNb.y, y: toNb.x }, { x: toNb.y, y: -toNb.x });
    const other = which === 'out' ? a.in : a.out;
    const away = !mirrored && other && unit({ x: wa.x - W(other).x, y: wa.y - W(other).y });
    if (away) cands.push(away);
    let best: Vec | null = null,
      bestCos = Math.cos((4 * Math.PI) / 180);
    for (const c of cands) {
      const cos = c.x * dir.x + c.y * dir.y;
      if (cos > bestCos) {
        bestCos = cos;
        best = c;
      }
    }
    if (!best) return q;
    const snapped = { x: wa.x + best.x * len, y: wa.y + best.y * len };
    const reach = Math.max(len, 40 / this.c.view.zoom);
    this.snapGuides.push({
      a: { x: wa.x - best.x * reach, y: wa.y - best.y * reach },
      b: { x: wa.x + best.x * reach * 2, y: wa.y + best.y * reach * 2 },
    });
    return worldToPath(origin, snapped);
  }

  private nodeMove(e: PointerEvent, p: Vec, s: Vec): void {
    const g = this.drag;
    if (!g) return;
    // Les conversions passent par le tracé tel qu'il était au début du geste.
    const base = findNode(editor.getState().doc, g.id)?.node;
    const origin = this.gestureNode(g.id) ?? (base?.type === 'path' ? base : null);
    if (!origin) return;
    const pp = worldToPath(origin, p);
    const sps = cloneSubpaths(g.base);
    this.snapGuides = [];
    if (g.kind === 'anchors') {
      let dx = pp.x - g.start.x,
        dy = pp.y - g.start.y;
      if (!g.moved && this.dist(pathToWorld(origin, g.start), p) < 3) return;
      g.moved = true;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      else [dx, dy] = this.snapAnchors(origin, g, dx, dy, e.ctrlKey || e.metaKey);
      moveAnchors(sps, g.keys, dx, dy);
    } else if (g.kind === 'handle') {
      const [si, ai] = parseAnchorKey(g.key);
      const a = sps[si].anchors[ai];
      // Tirer la poignée d'un nœud intelligent le rend lisse.
      delete a.smart;
      const mirrored = g.smooth && !e.altKey;
      let q = e.shiftKey ? constrain45(a, pp) : pp;
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && ui.get().nodeOptions.snapHandles)
        q = this.snapHandle(origin, sps[si], ai, g.which, q, mirrored);
      moveHandle(a, g.which, q, mirrored ? 'angle' : false);
    } else if (g.kind === 'box') {
      if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return;
      g.moved = true;
      const f = this.boxTransform(g, p, e.shiftKey);
      const conv = (v: Vec) => worldToPath(origin, f(pathToWorld(origin, v)));
      for (const a of anchorsOf(sps, g.keys)) {
        const q = conv(a);
        a.in = a.in && conv(a.in);
        a.out = a.out && conv(a.out);
        a.x = q.x;
        a.y = q.y;
      }
    } else {
      if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return;
      g.moved = true;
      const sp = sps[g.si];
      delete sp.anchors[g.seg].smart;
      delete sp.anchors[(g.seg + 1) % sp.anchors.length].smart;
      bendSegment(sps, g.si, g.seg, g.t, pp);
    }
    refreshSmart(sps);
    this.previewNodes(g.id, sps);
  }

  /** L'objet tel qu'au début du geste en cours (base de l'aperçu). */
  private gestureBase: { id: string; node: PathNode } | null = null;
  private gestureNode(id: string): PathNode | null {
    if (this.gestureBase?.id === id) return this.gestureBase.node;
    return null;
  }

  private nodeUp(): void {
    const g = this.drag;
    this.drag = null;
    this.gestureBase = null;
    this.snapGuides = [];
    if (!g) return;
    if (g.kind === 'segment' && !g.moved) {
      editor.cancel();
      let sps = cloneSubpaths(g.base);
      let sel: string[] = [];
      if (g.mod === 'straighten') straightenSegment(sps, g.si, g.seg);
      else if (g.mod === 'delete') sps = deleteSegment(sps, g.si, g.seg);
      else sel = [insertAnchor(sps, g.si, g.seg, g.t)];
      refreshSmart(sps);
      this.commitNodes(g.id, sps, g.mod === 'delete' ? 'history.deleteSegment' : 'history.nodes');
      ui.set({ nodeSelection: sel });
      return;
    }
    if ((g.kind === 'anchors' || g.kind === 'box') && !g.moved) {
      editor.cancel();
      return;
    }
    editor.commit('history.nodes');
  }

  /** Enregistre de nouveaux sous-tracés (un tracé vidé est supprimé). */
  private commitNodes(id: string, sps: SubPath[], label: string): void {
    if (!sps.length) {
      editor.apply('history.delete', (d) => {
        removeNodes(d, [id]);
        return [];
      });
      return;
    }
    editor.apply(label, (d) => {
      const m = findNode(d, id)?.node;
      if (m?.type === 'path') writePath(m, sps);
    });
  }

  /**
   * Applique une action de l'outil Nœud au tracé édité, sur les nœuds sélectionnés ou, pour les
   * actions qui portent sur la courbe, sur les sous-tracés qui les contiennent (tous sans sélection).
   */
  editNodes(kind: NodeAction): void {
    if (kind === 'join' && !this.editablePath()) return this.joinObjects();
    const n = this.editablePath();
    if (!n) return;
    let sps = cloneSubpaths(this.subpathsOf(n));
    const keys = ui.get().nodeSelection.filter((k) => {
      const [si, ai] = parseAnchorKey(k);
      return !!sps[si]?.anchors[ai];
    });
    const keep = anchorsOf(sps, keys);
    let label = 'history.nodes';
    switch (kind) {
      case 'delete':
      case 'fitDelete':
        if (!keys.length) return;
        sps = kind === 'delete' ? deleteAnchors(sps, keys) : fitDeleteAnchors(sps, keys);
        keep.clear();
        break;
      case 'toggleClosed':
        for (const si of subpathsOfKeys(sps, keys)) sps[si].closed = !sps[si].closed;
        break;
      case 'sharp':
      case 'smooth':
      case 'smart':
        if (!keys.length) return;
        setAnchorKind(sps, keys, kind);
        break;
      case 'split': {
        if (!keys.length) return;
        const added = splitAfterAnchors(sps, keys);
        if (!added.size) return;
        keep.clear();
        added.forEach((a) => keep.add(a));
        break;
      }
      case 'break':
        if (!keys.length) return;
        sps = breakAtAnchors(sps, keys);
        keep.clear();
        break;
      case 'reverse':
        reverseSubpaths(sps, subpathsOfKeys(sps, keys));
        break;
      case 'smoothCurve': {
        const b = exactBounds(fromSubpaths(sps));
        const size = b ? Math.max(b.width, b.height) : 100;
        sps = smoothSubpaths(sps, subpathsOfKeys(sps, keys), Math.max(0.5, size * 0.01));
        keep.clear();
        break;
      }
      case 'join': {
        const ends = keys.length === 2 ? (keys as [string, string]) : nearestEnds(sps);
        const joined = ends && joinEnds(sps, ends[0], ends[1]);
        if (!joined) {
          toast(t('node.joinNothing'));
          return;
        }
        sps = joined;
        keep.clear();
        label = 'history.join';
        break;
      }
    }
    refreshSmart(sps);
    ui.set({ nodeSelection: keysOf(sps, keep) });
    this.commitNodes(n.id, sps, kind === 'delete' || kind === 'fitDelete' ? 'history.deleteNodes' : label);
  }

  /**
   * Joindre les courbes de plusieurs objets sélectionnés : ils deviennent un seul tracé, et leurs
   * extrémités libres les plus proches se rejoignent.
   */
  private joinObjects(): void {
    const doc = editor.doc;
    const ids = topLevelIds(doc, editor.selection);
    const nodes = ids
      .map((id) => findNode(doc, id)?.node)
      .map((m) => (m && !m.locked ? toPathNode(m) : null));
    if (nodes.length < 2 || nodes.some((m) => !m)) {
      toast(t('node.joinNothing'));
      return;
    }
    const [first, ...others] = nodes as PathNode[];
    let sps = this.subpathsOf(first);
    let owner = sps.map(() => 0);
    others.forEach((m, k) => {
      const conv = (v: Vec) => worldToPath(first, pathToWorld(m, v));
      for (const sp of this.subpathsOf(m)) {
        sps.push({
          closed: sp.closed,
          anchors: sp.anchors.map((a) => {
            const q = conv(a);
            return { x: q.x, y: q.y, in: a.in && conv(a.in), out: a.out && conv(a.out) };
          }),
        });
        owner.push(k + 1);
      }
    });
    let joinedAny = false;
    for (let round = 0; round < others.length; round++) {
      // Extrémités les plus proches entre le premier objet (déjà joint) et un autre.
      let best: { a: string; b: string; d: number; o: number } | null = null;
      for (let i = 0; i < sps.length; i++) {
        const sa = sps[i];
        if (owner[i] !== 0 || sa.closed) continue;
        for (let j = 0; j < sps.length; j++) {
          const sb = sps[j];
          if (owner[j] === 0 || sb.closed) continue;
          for (const ia of [0, sa.anchors.length - 1])
            for (const ib of [0, sb.anchors.length - 1]) {
              const d = Math.hypot(sa.anchors[ia].x - sb.anchors[ib].x, sa.anchors[ia].y - sb.anchors[ib].y);
              if (!best || d < best.d) best = { a: anchorKey(i, ia), b: anchorKey(j, ib), d, o: owner[j] };
            }
        }
      }
      if (!best) break;
      const { a, b, o } = best;
      const [sa] = parseAnchorKey(a),
        [sb] = parseAnchorKey(b);
      const joined = joinEnds(sps, a, b);
      if (!joined) break;
      joinedAny = true;
      owner = owner.flatMap((w, i) => (i === sb ? [] : [w === o || i === sa ? 0 : w]));
      sps = joined;
    }
    if (!joinedAny) {
      toast(t('node.joinNothing'));
      return;
    }
    const node = structuredClone(first);
    writePath(node, sps);
    editor.apply('history.join', (d) => {
      const loc = findNode(d, first.id);
      if (!loc) return;
      loc.parent.children.splice(loc.index, 1, node);
      removeNodes(
        d,
        others.map((m) => m.id),
      );
      return [node.id];
    });
  }

  // ————— Ciseaux, cutter, outil Coin et Shape Builder —————

  /** Objet découpable sous le point : une forme ou un tracé, pas un texte ni une image. */
  private cuttable(p: Vec): PathNode | null {
    const hit = this.c.hitTest(p, true);
    if (!hit || hit.locked || !hit.visible) return null;
    return toPathNode(hit);
  }

  /** Tracé prêt à prendre la place de l'objet d'origine (une forme devient une courbe). */
  private cutNode(pn: PathNode, cmds: PathCommand[]): PathNode {
    const node = structuredClone(pn);
    setPathCommands(node, cmds);
    if (!hasClosedSubpath(cmds)) node.fill = { type: 'none' };
    return node;
  }

  private replaceWithPath(node: PathNode, label: string): void {
    editor.apply(label, (d) => {
      const loc = findNode(d, node.id);
      if (!loc) return;
      loc.parent.children.splice(loc.index, 1, node);
      return [node.id];
    });
  }

  /** Ciseaux : un clic sur le contour ouvre le tracé à cet endroit. */
  private scissors(p: Vec): void {
    const pn = this.cuttable(p);
    const cut = pn && cutPathAtPoint(cachedSvgPath(pn.d), worldToPath(pn, p), (HIT + 2) / this.c.view.zoom);
    if (!pn || !cut) {
      toast(t('vector.cutNothing'));
      return;
    }
    this.replaceWithPath(this.cutNode(pn, cut), 'history.scissors');
  }

  /** Cutter : la ligne tracée coupe en deux les objets qu'elle traverse. */
  private knife(a: Vec, b: Vec): void {
    const doc = editor.doc;
    // Sans sélection, le cutter coupe ce que la ligne traverse.
    const ids = editor.selection.length ? topLevelIds(doc, editor.selection) : this.alongLine(a, b);
    if (!ids.length) {
      toast(t('vector.cutNothing'));
      return;
    }
    let made: string[] | null = null;
    editor.apply('history.knife', (d) => {
      made = applyKnife(d, ids, a, b, t('name.curve'));
      return made ?? undefined;
    });
    if (!made) toast(t('vector.cutNothing'));
  }

  /** Objets rencontrés le long d'une ligne, du premier au dernier, sans doublon. */
  private alongLine(a: Vec, b: Vec): string[] {
    const doc = editor.doc;
    const steps = Math.max(8, Math.ceil(this.dist(a, b) / 3));
    const seen = new Set<string>();
    for (let i = 0; i <= steps; i++) {
      const q = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
      const hit = this.c.hitTest(q, false);
      if (hit && !hit.locked) seen.add(hit.id);
    }
    return topLevelIds(doc, [...seen]);
  }

  /** Shape Builder : la ligne réunit les formes qu'elle traverse (Alt : elle les soustrait). */
  private shapeBuilder(a: Vec, b: Vec, alt: boolean): void {
    const ids = this.alongLine(a, b);
    if (ids.length < 2) {
      toast(t('vector.shapeBuilderNeedsTwo'));
      return;
    }
    let ok = true;
    editor.apply(alt ? 'history.subtract' : 'history.unite', (d) => {
      const out = applyBoolean(d, ids, alt ? 'subtract' : 'unite', t('name.curve'));
      if (!out) {
        ok = false;
        return;
      }
      return out;
    });
    if (!ok) toast(t('vector.booleanUnsupported'));
  }

  /** Outil Coin : le nœud anguleux le plus proche du point, dans les coordonnées du tracé. */
  private nearestCorner(pn: PathNode, p: Vec): { keys: string[]; origin: Vec } | null {
    const sps = toSubpaths(cachedSvgPath(pn.d));
    const keys = cornerKeys(cachedSvgPath(pn.d));
    if (!keys.length) return null;
    const pp = worldToPath(pn, p);
    let best: { key: string; origin: Vec; d: number } | null = null;
    for (const key of keys) {
      const [si, ai] = parseAnchorKey(key);
      const a = sps[si]?.anchors[ai];
      if (!a) continue;
      const d = Math.hypot(a.x - pp.x, a.y - pp.y);
      if (!best || d < best.d) best = { key, origin: { x: a.x, y: a.y }, d };
    }
    return best ? { keys: [best.key], origin: best.origin } : null;
  }

  private cornerDown(e: PointerEvent, p: Vec): boolean {
    const pn = this.cuttable(p);
    if (!pn) return false;
    const near = this.nearestCorner(pn, p);
    if (!near) {
      toast(t('vector.noCorner'));
      return true;
    }
    // Alt : tous les angles du tracé d'un coup.
    const keys = e.altKey ? cornerKeys(cachedSvgPath(pn.d)) : near.keys;
    editor.begin();
    this.corner = { node: pn, base: toSubpaths(cachedSvgPath(pn.d)), keys, origin: near.origin, radius: 0 };
    return true;
  }

  /** Tracé arrondi au rayon donné, prêt à remplacer l'objet. */
  private corneredNode(radius: number): PathNode {
    const g = this.corner!;
    const sps = roundCorners(cloneSubpaths(g.base), g.keys, radius, ui.get().cornerKind);
    return this.cutNode(g.node, fromSubpaths(sps));
  }

  private cornerMove(p: Vec): void {
    const g = this.corner;
    if (!g) return;
    const pp = worldToPath(g.node, p);
    g.radius = Math.max(0, Math.hypot(pp.x - g.origin.x, pp.y - g.origin.y));
    const node = this.corneredNode(g.radius);
    editor.preview((d) => {
      const loc = findNode(d, g.node.id);
      if (!loc) return;
      loc.parent.children.splice(loc.index, 1, node);
      return [node.id];
    });
  }

  private cornerUp(): void {
    const g = this.corner;
    if (!g) return;
    // Un simple clic arrondit avec le rayon de la barre contextuelle.
    const radius = g.radius < 0.5 ? ui.get().cornerRadiusTool : g.radius;
    if (radius < 0.5) {
      editor.cancel();
      this.corner = null;
      return;
    }
    const node = this.corneredNode(radius);
    this.corner = null;
    editor.cancel();
    this.replaceWithPath(node, 'history.corner');
  }

  // ————— Évènements, appelés par le contrôleur du canevas —————

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    const tool = ui.get().tool;
    if (tool === 'scissors') {
      this.scissors(p);
      return true;
    }
    if (tool === 'knife' || tool === 'shapeBuilder') {
      this.line = { tool, a: p, b: p, alt: e.altKey };
      return true;
    }
    if (tool === 'corner') return this.cornerDown(e, p);
    if (tool === 'pen') {
      this.penDown(e, p);
      return true;
    }
    if (tool === 'pencil') {
      const doc = editor.doc;
      const ab = artboardAt(doc, p) ?? findArtboard(doc, editor.getState().activeArtboardId);
      if (!ab) return true;
      editor.setActiveArtboard(ab.id);
      this.pencil = { points: [p], artboardId: ab.id };
      return true;
    }
    const n = this.editablePath();
    this.segHover = null;
    if (n && this.polygon) return this.nodeSelectDown(e, p, s);
    if (n && this.nodeDown(e, p, s, n)) {
      this.gestureBase = { id: n.id, node: n };
      return true;
    }
    // Dans le vide (ni le tracé ni un autre objet) : sélection de nœuds à la zone.
    if (n && (e.altKey || !this.c.hitTest(p, true))) return this.nodeSelectDown(e, p, s);
    return false;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    const tool = ui.get().tool;
    if (this.line) {
      this.line.b = e.shiftKey ? constrain45(this.line.a, p) : p;
      this.c.requestDraw();
      return true;
    }
    if (this.corner) {
      this.cornerMove(p);
      return true;
    }
    if (tool === 'pen') {
      this.penMove(e, p);
      return true;
    }
    if (this.pencil) {
      const last = this.pencil.points[this.pencil.points.length - 1];
      if (this.dist(last, p) >= 1.5) {
        this.pencil.points.push(p);
        this.c.requestDraw();
      }
      return true;
    }
    if (this.drag) {
      this.nodeMove(e, p, s);
      return true;
    }
    const g = this.nodeSel;
    if (g) {
      if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return true;
      g.moved = true;
      if (g.mode === 'lasso') g.points.push(p);
      else g.points[1] = p;
      this.applyNodeSel();
      this.c.requestDraw();
      return true;
    }
    if (this.polygon) {
      this.polygon.hover = p;
      this.c.requestDraw();
      return true;
    }
    if (tool === 'direct') this.hoverSegment(e, p, s);
    return false;
  }

  pointerUp(): boolean {
    const line = this.line;
    if (line) {
      this.line = null;
      if (this.dist(line.a, line.b) < 4) toast(t('vector.drawLine'));
      else if (line.tool === 'knife') this.knife(line.a, line.b);
      else this.shapeBuilder(line.a, line.b, line.alt);
      return true;
    }
    if (this.corner) {
      this.cornerUp();
      return true;
    }
    if (ui.get().tool === 'pen' && this.pen) {
      this.penUp();
      return true;
    }
    if (this.pencil) {
      this.pencilUp();
      return true;
    }
    if (this.drag) {
      this.nodeUp();
      return true;
    }
    if (this.nodeSel) {
      this.nodeSelectUp();
      return true;
    }
    return false;
  }

  pointerCancel(): void {
    this.snapGuides = [];
    if (this.drag || this.corner) editor.cancel();
    this.drag = null;
    this.corner = null;
    this.line = null;
    this.pencil = null;
    this.nodeSel = null;
  }

  doubleClick(p: Vec, s: Vec): boolean {
    if (this.polygon) {
      this.finishPolygon();
      return true;
    }
    const n = this.editablePath();
    if (!n) return false;
    const hit = this.hitAnchor(n, this.subpathsOf(n), s);
    if (!hit || hit.which) return false;
    const [si, ai] = parseAnchorKey(hit.key);
    const a = this.subpathsOf(n)[si].anchors[ai];
    ui.set({ nodeSelection: [hit.key] });
    this.editNodes(a.in || a.out ? 'sharp' : 'smooth');
    void p;
    return true;
  }

  /** Clavier : Entrée / Échap terminent la plume, Retour arrière retire le dernier nœud, Suppr supprime les nœuds. */
  key(e: KeyboardEvent): boolean {
    if (this.polygon && (e.key === 'Enter' || e.key === 'Escape')) {
      if (e.key === 'Enter') this.finishPolygon();
      else this.cancelNodeSelect();
      this.c.requestDraw();
      return true;
    }
    if (this.pen) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        this.finishPen();
        return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.pen.anchors.pop();
        if (!this.pen.anchors.length) {
          this.pen = null;
          editor.cancel();
        } else this.updatePen();
        this.c.requestDraw();
        return true;
      }
    }
    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      this.editablePath() &&
      ui.get().nodeSelection.length
    ) {
      this.editNodes('delete');
      return true;
    }
    const step =
      e.code === 'BracketRight' || e.key === ']' ? 1 : e.code === 'BracketLeft' || e.key === '[' ? -1 : 0;
    if (step && !e.altKey && this.editablePath()) {
      this.stepNode(step);
      return true;
    }
    if (e.key === 'Escape' && ui.get().nodeSelection.length) {
      ui.set({ nodeSelection: [] });
      return true;
    }
    return false;
  }

  /** [ et ] : sélectionne le nœud précédent ou suivant du tracé édité. */
  stepNode(step: 1 | -1): void {
    const n = this.editablePath();
    if (!n) return;
    const sps = this.subpathsOf(n);
    if (!sps.length) return;
    const sel = ui.get().nodeSelection;
    const last = sel[sel.length - 1];
    let [si, ai] = last ? parseAnchorKey(last) : [0, step > 0 ? -1 : 0];
    if (!sps[si]) [si, ai] = [0, -1];
    const count = sps[si].anchors.length;
    ai += step;
    if (ai >= count || ai < 0) {
      if (sps[si].closed) ai = (ai + count) % count;
      else {
        // Tracé ouvert : on passe au sous-tracé suivant (ou précédent).
        si = (si + step + sps.length) % sps.length;
        ai = step > 0 ? 0 : sps[si].anchors.length - 1;
      }
    }
    ui.set({ nodeSelection: [anchorKey(si, ai)] });
    this.c.requestDraw();
  }

  /** Survol de l'outil Nœud : le segment sous le pointeur s'éclaire, avec l'effet du clic. */
  private hoverSegment(e: PointerEvent, p: Vec, s: Vec): void {
    const n = this.editablePath();
    let next: PathTools['segHover'] = null;
    if (n) {
      const sps = this.subpathsOf(n);
      if (!this.hitAnchor(n, sps, s) && !this.boxHit(n, sps, s)) {
        const seg = nearestSegment(sps, worldToPath(n, p));
        const q = seg && this.c.toScreen(pathToWorld(n, seg.point));
        if (seg && q && Math.hypot(q.x - s.x, q.y - s.y) <= HIT)
          next = { id: n.id, si: seg.si, seg: seg.seg, point: seg.point, mod: segmentMod(e) };
      }
    }
    if (!next && !this.segHover) return;
    this.segHover = next;
    this.c.requestDraw();
  }

  // ————— Dessin (repère de l'écran) —————

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    const square = (p: Vec, filled: boolean, size = 7) => {
      const q = this.c.toScreen(p);
      ctx.fillStyle = filled ? color : '#ffffff';
      ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
      ctx.strokeRect(q.x - size / 2 + 0.5, q.y - size / 2 + 0.5, size - 1, size - 1);
    };
    const handle = (a: Vec, h: Vec | null) => {
      if (!h) return;
      const qa = this.c.toScreen(a),
        qh = this.c.toScreen(h);
      ctx.beginPath();
      ctx.moveTo(qa.x, qa.y);
      ctx.lineTo(qh.x, qh.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(qh.x, qh.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
    };

    const pen = this.pen;
    if (pen && pen.anchors.length) {
      const a = pen.anchors;
      const last = a[a.length - 1];
      if (this.hover && pen.dragIndex === null && !pen.closed) {
        // Segment élastique jusqu'au pointeur.
        const s0 = this.c.toScreen(last),
          c1 = this.c.toScreen(last.out ?? last),
          s1 = this.c.toScreen(this.hover);
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.bezierCurveTo(c1.x, c1.y, s1.x, s1.y, s1.x, s1.y);
        ctx.stroke();
        if (a.length >= 2 && this.dist(a[0], this.hover) <= HIT + 1) {
          const q = this.c.toScreen(a[0]);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      const active = pen.dragIndex !== null ? a[pen.dragIndex] : last;
      handle(active, active.in);
      handle(active, active.out);
      a.forEach((p) => square(p, p === active, 6));
    }

    if (this.pencil) {
      const pts = this.pencil.points.map((p) => this.c.toScreen(p));
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const line = this.line;
    if (line) {
      const a = this.c.toScreen(line.a),
        b = this.c.toScreen(line.b);
      ctx.save();
      ctx.setLineDash(line.tool === 'knife' ? [] : [5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

    const zone = this.nodeSel?.moved ? this.nodeSel : null;
    const poly = this.polygon;
    if (zone || poly) {
      const pts = zone
        ? zone.mode === 'lasso'
          ? zone.points
          : [
              zone.points[0],
              { x: zone.points[1].x, y: zone.points[0].y },
              zone.points[1],
              { x: zone.points[0].x, y: zone.points[1].y },
            ]
        : [...poly!.points, ...(poly!.hover ? [poly!.hover] : [])];
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      pts.forEach((w, i) => {
        const q = this.c.toScreen(w);
        if (i) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      });
      if (zone) ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    const corner = this.corner;
    if (corner) {
      const o = this.c.toScreen(pathToWorld(corner.node, corner.origin));
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(o.x, o.y, Math.max(2, corner.radius * this.c.view.zoom), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      square(pathToWorld(corner.node, corner.origin), true, 6);
    }

    const n = this.editablePath();
    if (n && !this.pen) this.drawNodes(ctx, color, n, handle);
    ctx.restore();
  }

  /** Nœuds du tracé édité : net = carré, lisse = rond, intelligent = rond pointé (comme dans Affinity). */
  private drawNodes(
    ctx: CanvasRenderingContext2D,
    color: string,
    n: PathNode,
    handle: (a: Vec, h: Vec | null) => void,
  ): void {
    const sps = this.subpathsOf(n);
    const sel = new Set(ui.get().nodeSelection);
    const w = (p: Vec) => pathToWorld(n, p);
    const opts = ui.get().nodeOptions;
    const curve = (sp: SubPath, i: number) => {
      const b = segmentCubic(sp, i).map((q) => this.c.toScreen(w(q)));
      ctx.beginPath();
      ctx.moveTo(b[0].x, b[0].y);
      ctx.bezierCurveTo(b[1].x, b[1].y, b[2].x, b[2].y, b[3].x, b[3].y);
      ctx.stroke();
    };
    if (opts.orientation) {
      // Sens du tracé : le segment qui mène au dernier nœud est en rouge.
      ctx.save();
      ctx.strokeStyle = '#e5484d';
      ctx.lineWidth = 2;
      for (const sp of sps) {
        const count = segmentCount(sp);
        if (count) curve(sp, count - 1);
      }
      ctx.restore();
    }
    const hov = this.segHover?.id === n.id && !this.drag ? this.segHover : null;
    const hsp = hov && sps[hov.si];
    if (hov && hsp && hov.seg < segmentCount(hsp)) {
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = hov.mod === 'delete' ? '#e5484d' : color;
      if (hov.mod === 'straighten') {
        // Alt : aperçu du segment redressé.
        ctx.setLineDash([4, 3]);
        const a = this.c.toScreen(w(hsp.anchors[hov.seg])),
          b = this.c.toScreen(w(hsp.anchors[(hov.seg + 1) % hsp.anchors.length]));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else curve(hsp, hov.seg);
      if (hov.mod === 'add') {
        const q = this.c.toScreen(w(hov.point));
        ctx.lineWidth = 1.5;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    sps.forEach((sp, si) =>
      sp.anchors.forEach((a, ai) => {
        if (!sel.has(anchorKey(si, ai))) return;
        handle(w(a), a.in && w(a.in));
        handle(w(a), a.out && w(a.out));
      }),
    );
    sps.forEach((sp, si) =>
      sp.anchors.forEach((a, ai) => {
        const q = this.c.toScreen(w(a));
        const on = sel.has(anchorKey(si, ai));
        ctx.fillStyle = on ? color : '#ffffff';
        if (a.smart || isSmooth(a)) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, 3.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (a.smart) {
            ctx.fillStyle = on ? '#ffffff' : color;
            ctx.beginPath();
            ctx.arc(q.x, q.y, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          ctx.fillRect(q.x - 3.5, q.y - 3.5, 7, 7);
          ctx.strokeRect(q.x - 3, q.y - 3, 6, 6);
        }
      }),
    );
    const nb = this.drag?.kind === 'box' && this.drag.moved ? null : this.nodeBox(n, sps);
    if (nb) {
      const b = nb.scr;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      for (const [, q] of this.boxHandles(b)) {
        ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
        ctx.strokeRect(q.x - 2.5, q.y - 2.5, 5, 5);
      }
      ctx.restore();
    }
    if (this.snapGuides.length) {
      ctx.save();
      ctx.strokeStyle = '#e5484d';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (const g of this.snapGuides) {
        const a = this.c.toScreen(g.a),
          b = this.c.toScreen(g.b);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}
