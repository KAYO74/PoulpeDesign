// En premier : input.ts importe le menu du canevas, qui se charge ainsi avant les outils comme avant
// le découpage de ce fichier (les modules de l'éditeur s'importent en cycle).
import * as input from './input';
import { cursorFor } from './cursors';
import { TOOL_MODULES } from '../tools/registry';
import type { ToolDelegate } from '../tools/types';
import {
  findArtboard,
  findNode,
  hitNode,
  selectionBounds,
  type Box,
  type ImageNode,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import { ImageCache, RenderCache, clearLayoutCache } from '@poulpe/render';
import { cpuThreads } from '../preferences';
import { onPerformanceSettings, setRenderStatsSource } from '../perf';
import { editor, ui, type ToolId, type UiState } from '../store';
import type { SnapGuide } from './snapping';
import { PathTools } from './pathTools';
import { WorkerPainter, renderWorkerCount } from './parallel';
import { PhotoTools } from '../photo/photoTools';
import * as docGuides from './docGuides';
import * as drawing from './draw';
import type { Gesture } from './gestures';
import * as handles from './handles';
import type { Frame, HandleId } from './handles';
import * as pointer from './pointer';

export { cropFull } from './crop';

/*
 * Contrôleur du canevas : vue (zoom, défilement), objets sous le pointeur, écouteurs et cycle de
 * dessin. Le détail est dans les modules voisins, qui reçoivent le contrôleur en paramètre :
 * pointer.ts et input.ts (entrées), gestures.ts (déplacer, redimensionner, créer), handles.ts
 * (poignées), crop.ts (recadrage), docGuides.ts (repères), textFrames.ts (texte et cadres de
 * texte), draw.ts et overlays.ts (dessin).
 */

const SNAP_PX = 6;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;

/** État de l'interface sans effet sur le dessin du canevas. */
const UI_IGNORED = new Set<keyof UiState>([
  'cursor',
  'toast',
  'busy',
  'dialog',
  'panelDock',
  'recentColors',
  'filePath',
  'workspaceEdit',
]);

export class CanvasController {
  readonly images: ImageCache;
  /** Plume, crayon et outil Nœud. */
  readonly paths: PathTools;
  /** Outils de la Persona Photo. */
  readonly photo: PhotoTools;
  /** Outils ajoutés en version 1.2 (voir tools/registry.ts), consultés avant les outils de base. */
  readonly modules: ToolDelegate[];
  width = 0;
  height = 0;
  private frameRequested = false;
  private unsubscribe: (() => void)[] = [];

  // ————— État interne au canevas —————
  // Ces champs ne sont pas `private` : les modules de ce dossier (pointer.ts, gestures.ts,
  // draw.ts…) reçoivent le contrôleur en paramètre et les lisent ou les modifient. Ils restent
  // internes au canevas : le reste de l'éditeur passe par les méthodes publiques.
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  gesture: Gesture | null = null;
  hoverId: string | null = null;
  guides: SnapGuide[] = [];
  spaceDown = false;
  colors: Record<string, string> = {};
  lastPointer: Vec = { x: 0, y: 0 };
  /** Contenu des plans de travail gardé en images (voir `RenderCache`). */
  readonly cache = new RenderCache();
  /** Dernier changement de vue (zoom, défilement) : pendant le geste, un aperçu étiré suffit. */
  viewChangedAt = 0;
  refreshTimer: ReturnType<typeof setTimeout> | undefined;
  checker: CanvasPattern | null = null;
  /** Ombre des plans de travail, floutée une fois puis étirée (voir drawArtboardShadow). */
  shadowSprite: { canvas: HTMLCanvasElement; dpr: number; e: number } | null = null;
  /** Main ou Zoom maintenus (touche H ou Z) : la vue seulement, l'outil choisi ne change pas. */
  heldView: 'hand' | 'zoom' | null = null;
  /** Position du clic droit en cours (fenêtre), pour ouvrir le menu du canevas au relâchement. */
  rightDown: Vec | null = null;
  /** Indicateurs de débordement dessinés (en pixels d'écran), pour les clics ; lus aussi par les tests. */
  overflowMarks: { id: string; x: number; y: number }[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.images = new ImageCache(() => this.requestDraw());
    this.paths = new PathTools(this);
    this.photo = new PhotoTools(this);
    this.modules = TOOL_MODULES.flatMap((m) => (m.delegate ? [m.delegate(this)] : []));
    this.readColors();
    this.unsubscribe.push(
      onPerformanceSettings((s) => {
        this.cache.budget = s.cacheMb * 1024 * 1024;
        this.cache.quality = s.previewQuality;
        if (this.cache.accelerated !== s.hardwareAcceleration) {
          this.cache.accelerated = s.hardwareAcceleration;
          this.cache.invalidate();
        }
        this.setParallel(s.parallelDrawing);
        this.requestDraw();
      }),
    );
    this.cache.onReady = () => this.requestDraw();
    setRenderStatsSource(() => this.cache.stats());
    let lastSelection = editor.selection;
    this.unsubscribe.push(
      editor.subscribe(() => {
        // Les nœuds sélectionnés appartiennent au tracé sélectionné.
        if (editor.selection !== lastSelection) {
          const same =
            editor.selection.length === lastSelection.length &&
            editor.selection.every((id, i) => id === lastSelection[i]);
          lastSelection = editor.selection;
          if (!same && ui.get().nodeSelection.length) ui.set({ nodeSelection: [] });
        }
        // Le recadrage s'arrête quand l'image n'est plus la sélection.
        const crop = ui.get().cropId;
        if (crop && (editor.selection.length !== 1 || editor.selection[0] !== crop)) ui.set({ cropId: null });
        this.requestDraw();
      }),
    );
    let lastUi = ui.get();
    this.unsubscribe.push(
      ui.subscribe(() => {
        const s = ui.get();
        const prev = lastUi;
        lastUi = s;
        // La position du pointeur, les messages et les boîtes de dialogue ne changent pas le canevas :
        // le survol redessinait tout le document à chaque mouvement de souris.
        let changed = false;
        for (const k in s) {
          const key = k as keyof typeof s;
          if (s[key] !== prev[key] && !UI_IGNORED.has(key)) {
            changed = true;
            break;
          }
        }
        if (!changed) return;
        // Les couleurs du thème sont lues une fois la page mise à jour (thème, espace de travail).
        if (s.settings !== prev.settings || s.persona !== prev.persona)
          requestAnimationFrame(() => this.readColors());
        if (s.view !== prev.view) this.viewChanged();
        this.updateCursor();
        this.requestDraw();
      }),
    );
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('poulpe:fit', this.zoomToFit);
    window.addEventListener('poulpe:textselection', this.requestDraw);
    document.fonts?.addEventListener?.('loadingdone', this.onFontsLoaded);
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.setParallel(false);
    setRenderStatsSource(null);
    this.paths.dispose();
    this.photo.dispose();
    this.modules.forEach((m) => m.dispose?.());
    this.unsubscribe.forEach((u) => u());
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerCancel);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('dblclick', this.onDoubleClick);
    c.removeEventListener('contextmenu', this.onContextMenu);
    c.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('poulpe:fit', this.zoomToFit);
    window.removeEventListener('poulpe:textselection', this.requestDraw);
    document.fonts?.removeEventListener?.('loadingdone', this.onFontsLoaded);
  }

  /** Fils de dessin pour les gros redessins (voir parallel.ts). */
  private painter: WorkerPainter | null = null;

  private setParallel(on: boolean) {
    const count = on && typeof OffscreenCanvas !== 'undefined' ? renderWorkerCount(cpuThreads()) : 0;
    if (count > 0 === !!this.painter) return;
    this.painter?.dispose();
    this.painter =
      count > 0
        ? new WorkerPainter(count, (w, h) => {
            if (this.cache.accelerated) return new OffscreenCanvas(w, h);
            return Object.assign(document.createElement('canvas'), { width: w, height: h });
          })
        : null;
    this.cache.parallel = this.painter;
    this.cache.invalidate();
  }

  /** Attend la fin des dessins en cours sur les autres cœurs (mesures et tests). */
  renderIdle(): Promise<boolean> {
    return this.cache.idle();
  }

  /** Oublie les images gardées : le prochain dessin repart de zéro. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private viewChanged() {
    this.viewChangedAt = performance.now();
  }

  private onFontsLoaded = () => {
    clearLayoutCache();
    editor.normalizeNow();
    this.requestDraw();
  };

  private readColors() {
    const cs = getComputedStyle(this.host);
    const v = (name: string) => cs.getPropertyValue(name).trim();
    this.colors = {
      pasteboard: v('--pasteboard') || '#151518',
      sel: v('--sel') || '#4da3ff',
      guide: v('--guide') || '#ff4fb8',
      docGuide: v('--doc-guide') || '#20c4d8',
      muted: v('--muted') || '#a3a1ac',
      fg: v('--fg') || '#e7e6ec',
      line: v('--line') || '#3a3a41',
    };
    this.requestDraw();
  }

  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.requestDraw();
  }

  requestDraw = (): void => {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.draw();
    });
  };

  // ————— Vue —————

  get view() {
    return ui.get().view;
  }

  toWorld(sx: number, sy: number): Vec {
    const v = this.view;
    return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  }

  toScreen(p: Vec): Vec {
    const v = this.view;
    return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
  }

  zoomAt(zoom: number, sx = this.width / 2, sy = this.height / 2): void {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const w = this.toWorld(sx, sy);
    ui.set({ view: { zoom: z, panX: sx - w.x * z, panY: sy - w.y * z } });
  }

  zoomToFit = (): void => {
    const doc = editor.doc;
    const ab = findArtboard(doc, editor.getState().activeArtboardId);
    const target: Box | null = ab ?? null;
    const boxes = target ? [target] : doc.artboards;
    if (!boxes.length || !this.width) return;
    const minX = Math.min(...boxes.map((b) => b.x)),
      minY = Math.min(...boxes.map((b) => b.y)),
      maxX = Math.max(...boxes.map((b) => b.x + b.width)),
      maxY = Math.max(...boxes.map((b) => b.y + b.height));
    const margin = 48;
    const z = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min((this.width - margin * 2) / (maxX - minX), (this.height - margin * 2) / (maxY - minY)),
      ),
    );
    ui.set({
      view: {
        zoom: z,
        panX: (this.width - (maxX - minX) * z) / 2 - minX * z,
        panY: (this.height - (maxY - minY) * z) / 2 - minY * z,
      },
    });
  };

  // ————— Sélection et cadre —————

  selectionFrame(): Frame | null {
    const { doc, selection } = editor.getState();
    if (!selection.length) return null;
    if (selection.length === 1) {
      const n = findNode(doc, selection[0])?.node;
      if (n && n.type !== 'group')
        return { x: n.x, y: n.y, width: n.width, height: n.height, rotation: n.rotation };
    }
    const b = selectionBounds(doc, selection);
    return b ? { ...b, rotation: 0 } : null;
  }

  /** Poignée de redimensionnement ou de rotation de la sélection sous le point écran. */
  hitHandle(sx: number, sy: number): HandleId | 'rotate' | null {
    return handles.hitHandle(this, sx, sy);
  }

  /** Image en cours de recadrage, si elle est toujours seule sélectionnée. */
  cropNode(): ImageNode | null {
    const id = ui.get().cropId;
    if (!id || editor.selection.length !== 1 || editor.selection[0] !== id) return null;
    const n = findNode(editor.doc, id)?.node;
    return n?.type === 'image' && !n.locked ? n : null;
  }

  /** Objet sous le point. `deep` : descend dans les groupes (sélection directe). */
  hitTest(p: Vec, deep: boolean): SceneNode | null {
    const doc = editor.doc;
    const tol = 4 / this.view.zoom;
    // Les objets déjà sélectionnés passent en premier (on peut déplacer un objet sélectionné dans un groupe).
    for (const id of editor.selection) {
      const n = findNode(doc, id)?.node;
      if (n && !n.locked && hitNode(n, p, tol)) return n;
    }
    for (let a = doc.artboards.length - 1; a >= 0; a--) {
      const ab = doc.artboards[a];
      if (p.x < ab.x || p.y < ab.y || p.x > ab.x + ab.width || p.y > ab.y + ab.height) continue;
      const found = this.hitIn(ab.children, p, tol, deep);
      if (found) return found;
    }
    return null;
  }

  private hitIn(nodes: SceneNode[], p: Vec, tol: number, deep: boolean): SceneNode | null {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!n.visible || n.locked) continue;
      if (n.type === 'group') {
        if (!hitNode(n, p, tol)) continue;
        if (deep) {
          const inner = this.hitIn(n.children, p, tol, true);
          if (inner) return inner;
        }
        return n;
      }
      if (hitNode(n, p, tol)) return n;
    }
    return null;
  }

  snapThreshold(): number {
    return SNAP_PX / this.view.zoom;
  }

  gridStep(): number | null {
    return ui.get().settings.grid ? this.gridSpacing() : null;
  }

  /** Pas de la grille, en unités du document, choisi pour rester lisible au zoom courant. */
  gridSpacing(): number {
    const z = this.view.zoom;
    for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) if (s * z >= 12) return s;
    return 1000;
  }

  snapping(): boolean {
    return ui.get().settings.snapping;
  }

  // ————— Pointeur —————

  /** Un geste est en cours (glisser, tracé à la plume, coup de pinceau…). */
  busy(): boolean {
    return !!this.gesture || this.paths.busy || this.photo.busy || this.modules.some((m) => m.busy);
  }

  /** Touche pressée : les outils de la version 1.2 d'abord. */
  moduleKey(e: KeyboardEvent): boolean {
    for (const m of this.modules) if (m.key?.(e)) return true;
    return false;
  }

  setHeldView(tool: 'hand' | 'zoom' | null): void {
    if (this.heldView === tool) return;
    this.heldView = tool;
    this.updateCursor();
  }

  /**
   * Interne au canevas (pointer.ts, input.ts) : outil en vigueur, Main ou Zoom maintenus compris
   * (barre d'espace, touche H ou Z).
   */
  effectiveTool(): ToolId {
    return this.spaceDown ? 'hand' : (this.heldView ?? ui.get().tool);
  }

  // Écouteurs du canevas et de la fenêtre (voir pointer.ts et input.ts).
  private onPointerDown = (e: PointerEvent) => pointer.onPointerDown(this, e);
  private onPointerMove = (e: PointerEvent) => pointer.onPointerMove(this, e);
  private onPointerUp = (e: PointerEvent) => pointer.onPointerUp(this, e);
  private onPointerCancel = () => pointer.onPointerCancel(this);
  private onPointerLeave = () => pointer.onPointerLeave(this);
  private onContextMenu = (e: MouseEvent) => input.onContextMenu(e);
  private onDoubleClick = (e: MouseEvent) => input.onDoubleClick(this, e);
  private onWheel = (e: WheelEvent) => input.onWheel(this, e);
  private onKey = (e: KeyboardEvent) => input.onKey(this, e);

  /**
   * Interne au canevas (pointer.ts) : curseur d'un outil (lien de cadres de texte en cours, outils
   * de la version 1.2, sinon celui de base).
   */
  toolCursor(tool: ToolId): string {
    if (ui.get().linkFrom) return 'copy';
    for (const m of this.modules) {
      const c = m.cursor?.(tool);
      if (c) return c;
    }
    return cursorFor(tool);
  }

  updateCursor(): void {
    this.canvas.style.cursor = this.toolCursor(this.effectiveTool());
  }

  // ————— Repères —————

  /**
   * Glisse un repère : nouveau (`index` null, tiré depuis une règle) ou existant. Relâché hors
   * du canevas (sur une règle), le repère est supprimé.
   */
  dragGuide(axis: 'x' | 'y', index: number | null, e: PointerEvent): void {
    docGuides.dragGuide(this, axis, index, e);
  }

  // ————— Dessin —————

  draw(): void {
    drawing.draw(this);
  }

  /** Coordonnées écran d'un objet, pour placer la zone d'édition de texte. */
  screenFrame(n: SceneNode): {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    zoom: number;
  } {
    const v = this.view;
    const p = this.toScreen({ x: n.x, y: n.y });
    return {
      x: p.x,
      y: p.y,
      width: n.width * v.zoom,
      height: n.height * v.zoom,
      rotation: n.rotation,
      zoom: v.zoom,
    };
  }
}
