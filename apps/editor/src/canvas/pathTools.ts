import {
  basePathCommands,
  findNode,
  markSmart,
  parseAnchorKey,
  toSubpaths,
  type PathNode,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import { editor, ui } from '../store';
import type { CanvasController } from './controller';
import * as actions from './pathTools/actions';
import type { NodeDrag, NodeSelOp, SegmentMod } from './pathTools/common';
import * as dragging from './pathTools/dragging';
import * as drawing from './pathTools/drawing';
import * as scissorsTool from './pathTools/scissors';
import * as selection from './pathTools/selection';

/*
 * Outils de tracé : outil Nœud (modifier les nœuds et poignées d'un tracé) et ciseaux. Tous
 * passent par les gestes de l'éditeur : chaque modification de nœuds s'annule en une fois. La
 * plume, le crayon, le cutter et le constructeur de formes sont dans `tools/paths`, l'outil Coin
 * dans `tools/shapes`.
 *
 * Le code est réparti par responsabilité dans `pathTools/` : repérage et sélection des nœuds
 * (`selection`), cadre de transformation (`box`), glissements (`dragging`), actions sur les nœuds
 * (`actions`), ciseaux (`scissors`) et dessin (`drawing`) ; types et constantes partagés dans
 * `common`. Cette classe garde l'état des gestes et reçoit les évènements du contrôleur du canevas.
 */

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

export class PathTools {
  /*
   * État des gestes de l'outil Nœud. Ces membres ne sont pas `private` : les modules de
   * `pathTools/` les lisent et les modifient. Ils restent internes à l'outil, le reste de l'éditeur
   * ne passe que par les méthodes publiques.
   */
  drag: NodeDrag | null = null;
  /** Sélection de nœuds au cadre ou au lasso (outil Nœud), en cours de glissement. */
  nodeSel: {
    id: string;
    mode: 'rect' | 'lasso';
    points: Vec[];
    op: NodeSelOp;
    base: string[];
    startScreen: Vec;
    moved: boolean;
  } | null = null;
  /** Sélection de nœuds au polygone (Alt+clic), sommet par sommet. */
  polygon: { id: string; points: Vec[]; hover: Vec | null; op: NodeSelOp; base: string[] } | null = null;
  /** Segment survolé par l'outil Nœud (repère du tracé) : il s'éclaire avant le clic. */
  segHover: { id: string; si: number; seg: number; point: Vec; mod: SegmentMod } | null = null;
  /** Repères d'aimantation des nœuds et des poignées (monde), pendant un glissement. */
  snapGuides: { a: Vec; b: Vec }[] = [];

  /** Le contrôleur du canevas : interne à l'outil, lui aussi (modules de `pathTools/`). */
  constructor(readonly c: CanvasController) {
    window.addEventListener('poulpe:toolchange', this.cancelNodeSelect);
  }

  dispose(): void {
    window.removeEventListener('poulpe:toolchange', this.cancelNodeSelect);
  }

  get busy(): boolean {
    return !!(this.drag || this.nodeSel || this.polygon);
  }

  /** Tracé modifiable par l'outil Nœud : le seul objet sélectionné, s'il est un tracé. */
  editablePath(): PathNode | null {
    if (ui.get().tool !== 'direct') return null;
    const sel = editor.selection;
    if (sel.length !== 1) return null;
    const n = findNode(editor.doc, sel[0])?.node;
    return n?.type === 'path' && !n.locked && n.visible ? n : null;
  }

  // ————— Outil Nœud —————

  /** Sous-tracés du tracé, avec ses nœuds intelligents (interne à l'outil : modules de `pathTools/`). */
  subpathsOf(n: PathNode): SubPath[] {
    return markSmart(toSubpaths(basePathCommands(n)), n.smartNodes);
  }

  /** Clic droit sur un nœud : il est sélectionné (s'il ne l'était pas) pour le menu des nœuds. */
  nodeMenuAt(s: Vec): boolean {
    return selection.nodeMenuAt(this, s);
  }

  /**
   * Sélection de nœuds à la zone, comme dans Affinity : Glisser = cadre, Alt = lasso, Alt+clic =
   * polygone ; Maj ajoute, bouton droit retire, Maj + bouton droit inverse la sélection.
   */
  nodeSelectDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    return selection.nodeSelectDown(this, e, p, s);
  }

  private cancelNodeSelect = (): void => {
    this.nodeSel = null;
    this.polygon = null;
  };

  /** L'objet tel qu'au début du geste en cours (base de l'aperçu). */
  gestureBase: { id: string; node: PathNode } | null = null;
  /** Interne à l'outil : le glissement en cours (`pathTools/dragging`) s'en sert. */
  gestureNode(id: string): PathNode | null {
    if (this.gestureBase?.id === id) return this.gestureBase.node;
    return null;
  }

  /**
   * Applique une action de l'outil Nœud au tracé édité, sur les nœuds sélectionnés ou, pour les
   * actions qui portent sur la courbe, sur les sous-tracés qui les contiennent (tous sans sélection).
   */
  editNodes(kind: NodeAction): void {
    actions.editNodes(this, kind);
  }

  // ————— Évènements, appelés par le contrôleur du canevas —————

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    const tool = ui.get().tool;
    if (tool === 'scissors') {
      scissorsTool.scissors(this, p);
      return true;
    }
    const n = this.editablePath();
    this.segHover = null;
    if (n && this.polygon) return this.nodeSelectDown(e, p, s);
    if (n && dragging.nodeDown(this, e, p, s, n)) {
      this.gestureBase = { id: n.id, node: n };
      return true;
    }
    // Dans le vide (ni le tracé ni un autre objet) : sélection de nœuds à la zone.
    if (n && (e.altKey || !this.c.hitTest(p, true))) return this.nodeSelectDown(e, p, s);
    return false;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    const tool = ui.get().tool;
    if (this.drag) {
      dragging.nodeMove(this, e, p, s);
      return true;
    }
    const g = this.nodeSel;
    if (g) {
      if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return true;
      g.moved = true;
      if (g.mode === 'lasso') g.points.push(p);
      else g.points[1] = p;
      selection.applyNodeSel(this);
      this.c.requestDraw();
      return true;
    }
    if (this.polygon) {
      this.polygon.hover = p;
      this.c.requestDraw();
      return true;
    }
    if (tool === 'direct') selection.hoverSegment(this, e, p, s);
    return false;
  }

  pointerUp(): boolean {
    if (this.drag) {
      dragging.nodeUp(this);
      return true;
    }
    if (this.nodeSel) {
      selection.nodeSelectUp(this);
      return true;
    }
    return false;
  }

  pointerCancel(): void {
    this.snapGuides = [];
    if (this.drag) editor.cancel();
    this.drag = null;
    this.nodeSel = null;
  }

  doubleClick(p: Vec, s: Vec): boolean {
    if (this.polygon) {
      selection.finishPolygon(this);
      return true;
    }
    const n = this.editablePath();
    if (!n) return false;
    const hit = selection.hitAnchor(this, n, this.subpathsOf(n), s);
    if (!hit || hit.which) return false;
    const [si, ai] = parseAnchorKey(hit.key);
    const a = this.subpathsOf(n)[si].anchors[ai];
    ui.set({ nodeSelection: [hit.key] });
    this.editNodes(a.in || a.out ? 'sharp' : 'smooth');
    return true;
  }

  /** Clavier : Suppr supprime les nœuds, [ et ] passent d'un nœud à l'autre. */
  key(e: KeyboardEvent): boolean {
    if (this.polygon && (e.key === 'Enter' || e.key === 'Escape')) {
      if (e.key === 'Enter') selection.finishPolygon(this);
      else this.cancelNodeSelect();
      this.c.requestDraw();
      return true;
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
    selection.stepNode(this, step);
  }

  // ————— Dessin (repère de l'écran) —————

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    drawing.draw(this, ctx, color);
  }
}
