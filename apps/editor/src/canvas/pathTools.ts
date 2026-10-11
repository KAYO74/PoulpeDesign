import {
  anchorKey,
  applyBoolean,
  applyKnife,
  artboardAt,
  bendSegment,
  cachedSvgPath,
  cloneSubpaths,
  cornerKeys,
  createPath,
  cutPathAtPoint,
  deleteAnchors,
  exactBounds,
  findArtboard,
  findNode,
  fromSubpaths,
  hasClosedSubpath,
  insertAnchor,
  isSmooth,
  moveAnchors,
  moveHandle,
  nearestSegment,
  newId,
  parseAnchorKey,
  pathToSvg,
  pathToWorld,
  removeNodes,
  roundCorners,
  setAnchorKind,
  setPathCommands,
  simplifyPoints,
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
import { collectSnapLines, snapPoint } from './snapping';

/*
 * Outils de tracé : plume (courbes de Bézier nœud par nœud), crayon (main levée, lissé) et
 * outil Nœud (modifier les nœuds et poignées d'un tracé). Tous passent par les gestes de
 * l'éditeur : chaque tracé, chaque modification de nœuds s'annule en une fois.
 */

const HIT = 7;

type NodeDrag =
  | { kind: 'anchors'; id: string; base: SubPath[]; start: Vec; keys: string[]; moved: boolean }
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
    return toSubpaths(cachedSvgPath(n.d));
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
      let sel = ui.get().nodeSelection;
      if (e.shiftKey) sel = sel.includes(hit.key) ? sel.filter((k) => k !== hit.key) : [...sel, hit.key];
      else if (!sel.includes(hit.key)) sel = [hit.key];
      ui.set({ nodeSelection: sel });
      if (!sel.includes(hit.key)) return true;
      editor.begin();
      this.drag = { kind: 'anchors', id: n.id, base: sps, start: pp, keys: sel, moved: false };
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
        };
        return true;
      }
    }
    return false;
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
      if (n?.type === 'path') setPathCommands(n, fromSubpaths(sps));
    });
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
    if (g.kind === 'anchors') {
      let dx = pp.x - g.start.x,
        dy = pp.y - g.start.y;
      if (!g.moved && this.dist(pathToWorld(origin, g.start), p) < 3) return;
      g.moved = true;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      moveAnchors(sps, g.keys, dx, dy);
    } else if (g.kind === 'handle') {
      const [si, ai] = parseAnchorKey(g.key);
      const a = sps[si].anchors[ai];
      const q = e.shiftKey ? constrain45(a, pp) : pp;
      moveHandle(a, g.which, q, g.smooth && !e.altKey ? 'angle' : false);
    } else {
      if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return;
      g.moved = true;
      bendSegment(sps, g.si, g.seg, g.t, pp);
    }
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
    if (!g) return;
    if (g.kind === 'segment' && !g.moved) {
      // Simple clic sur un segment : on y ajoute un nœud.
      editor.cancel();
      const sps = cloneSubpaths(g.base);
      const key = insertAnchor(sps, g.si, g.seg, g.t);
      editor.apply('history.nodes', (d) => {
        const n = findNode(d, g.id)?.node;
        if (n?.type === 'path') setPathCommands(n, fromSubpaths(sps));
      });
      ui.set({ nodeSelection: [key] });
      return;
    }
    if (g.kind === 'anchors' && !g.moved) {
      editor.cancel();
      return;
    }
    editor.commit('history.nodes');
  }

  /** Applique une modification aux nœuds sélectionnés du tracé édité (barre contextuelle, clavier). */
  editNodes(kind: 'sharp' | 'smooth' | 'delete' | 'toggleClosed'): void {
    const n = this.editablePath();
    if (!n) return;
    let sps = cloneSubpaths(this.subpathsOf(n));
    const keys = ui.get().nodeSelection;
    if (kind === 'delete') {
      if (!keys.length) return;
      sps = deleteAnchors(sps, keys);
      ui.set({ nodeSelection: [] });
      if (!sps.length) {
        editor.apply('history.delete', (d) => {
          removeNodes(d, [n.id]);
          return [];
        });
        return;
      }
    } else if (kind === 'toggleClosed') {
      const touched = new Set(keys.map((k) => parseAnchorKey(k)[0]));
      const which = touched.size ? [...touched] : sps.map((_, i) => i);
      for (const si of which) if (sps[si]) sps[si].closed = !sps[si].closed;
    } else {
      if (!keys.length) return;
      setAnchorKind(sps, keys, kind);
    }
    editor.apply('history.nodes', (d) => {
      const m = findNode(d, n.id)?.node;
      if (m?.type === 'path') setPathCommands(m, fromSubpaths(sps));
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
    if (e.key === 'Escape' && ui.get().nodeSelection.length) {
      ui.set({ nodeSelection: [] });
      return true;
    }
    return false;
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
    if (n && !this.pen) {
      const sps = this.subpathsOf(n);
      const sel = new Set(ui.get().nodeSelection);
      const w = (p: Vec) => pathToWorld(n, p);
      sps.forEach((sp, si) =>
        sp.anchors.forEach((a, ai) => {
          if (!sel.has(anchorKey(si, ai))) return;
          handle(w(a), a.in && w(a.in));
          handle(w(a), a.out && w(a.out));
        }),
      );
      sps.forEach((sp, si) => sp.anchors.forEach((a, ai) => square(w(a), sel.has(anchorKey(si, ai)))));
    }
    ctx.restore();
  }
}
