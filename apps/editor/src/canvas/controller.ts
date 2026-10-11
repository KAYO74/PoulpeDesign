import {
  artboardAt,
  boxCenter,
  boxesIntersect,
  caretAt,
  chainHead,
  charX,
  isLinked,
  masterOf,
  needsFlow,
  isLeftPage,
  pageMargins,
  cloneWithNewIds,
  createArtboard,
  createEllipse,
  createLine,
  createPolygon,
  createRect,
  createStar,
  createText,
  findArtboard,
  findNode,
  hitNode,
  localToWorld,
  nodeBounds,
  normalizeAngle,
  reparentToArtboards,
  rotateNode,
  scaleNode,
  scaleTextSize,
  selectionBounds,
  topLevelIds,
  translateNode,
  worldToLocal,
  type Artboard,
  type Box,
  type ImageNode,
  type PoulpeDocument,
  type SceneNode,
  type TextNode,
  type Vec,
  pageFields as pageFieldsOf,
  softProofPixels,
} from '@poulpe/core';
import { ImageCache, RenderCache, cachedFlow, clearLayoutCache, measureText, nodePath } from '@poulpe/render';
import { onPerformanceSettings, recordFrame, setRenderStatsSource } from '../perf';
import { setPaint } from '../actions';
import { t } from '../i18n';
import { importImage } from '../io';
import { editor, pushRecentColor, ui, type ToolId, type UiState } from '../store';
import {
  collectSnapLines,
  idsWithDescendants,
  snapMove,
  snapPoint,
  type SnapGuide,
  type SnapLines,
} from './snapping';
import { PathTools } from './pathTools';
import {
  beginTextEdit,
  editedTextId,
  endTextEdit,
  isEditingText,
  setTextSelection,
  textSelection,
} from './textEdit';
import { editParts, indexAtWorld, partAt } from './textParts';
import { linkTextFrames } from '../layoutActions';
import { PhotoTools } from '../photo/photoTools';

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Record<HandleId, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};
const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 22;
const SNAP_PX = 6;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;

/** Boîte de transformation : celle de l'objet s'il est seul (tourné), sinon la boîte englobante. */
interface Frame extends Box {
  rotation: number;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number }
  | {
      kind: 'move';
      start: Vec;
      ids: string[];
      box: Box;
      lines: SnapLines;
      clones: SceneNode[] | null;
      moved: boolean;
      recipe?: (d: PoulpeDocument) => string[] | undefined;
    }
  | {
      kind: 'resize';
      handle: HandleId;
      frame: Frame;
      ids: string[];
      single: SceneNode | null;
      lines: SnapLines;
    }
  | { kind: 'rotate'; center: Vec; startAngle: number; ids: string[] }
  | { kind: 'marquee'; start: Vec; current: Vec; additive: boolean; base: string[] }
  | { kind: 'create'; tool: ToolId; start: Vec; artboardId: string; nodeId: string | null; lines: SnapLines }
  | { kind: 'artboardCreate'; start: Vec; current: Vec }
  | { kind: 'cropResize'; handle: HandleId; node: ImageNode; full: Box }
  | { kind: 'cropPan'; start: Vec; node: ImageNode; full: Box; moved: boolean }
  | { kind: 'artboardMove'; id: string; start: Vec; origin: Vec; moved: boolean };

const SHAPE_TOOLS: ToolId[] = ['rect', 'ellipse', 'polygon', 'star', 'line'];

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

/** Délai après un zoom ou un défilement avant de redessiner net. */
const SETTLE_MS = 140;

/** Objets du premier niveau des plans de travail, par id de tout objet qu'ils contiennent. */
const topLevelCache = new WeakMap<PoulpeDocument, Map<string, string>>();
function topLevelOf(doc: PoulpeDocument): Map<string, string> {
  let map = topLevelCache.get(doc);
  if (map) return map;
  map = new Map();
  const visit = (nodes: SceneNode[], top: string) => {
    for (const n of nodes) {
      map!.set(n.id, top);
      if (n.type === 'group') visit(n.children, top);
    }
  };
  for (const ab of doc.artboards) for (const n of ab.children) visit([n], n.id);
  topLevelCache.set(doc, map);
  return map;
}

export class CanvasController {
  readonly images: ImageCache;
  /** Plume, crayon et outil Nœud. */
  readonly paths: PathTools;
  /** Outils de la Persona Photo. */
  readonly photo: PhotoTools;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  width = 0;
  height = 0;
  private gesture: Gesture | null = null;
  private hoverId: string | null = null;
  private guides: SnapGuide[] = [];
  private frameRequested = false;
  private spaceDown = false;
  private colors: Record<string, string> = {};
  private unsubscribe: (() => void)[] = [];
  private lastPointer: Vec = { x: 0, y: 0 };
  /** Contenu des plans de travail gardé en images (voir `RenderCache`). */
  private readonly cache = new RenderCache();
  /** Dernier changement de vue (zoom, défilement) : pendant le geste, un aperçu étiré suffit. */
  private viewChangedAt = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private checker: CanvasPattern | null = null;
  /** Ombre des plans de travail, floutée une fois puis étirée (voir drawArtboardShadow). */
  private shadowSprite: { canvas: HTMLCanvasElement; dpr: number; e: number } | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.images = new ImageCache(() => this.requestDraw());
    this.paths = new PathTools(this);
    this.photo = new PhotoTools(this);
    this.readColors();
    this.unsubscribe.push(
      onPerformanceSettings((s) => {
        this.cache.budget = s.cacheMb * 1024 * 1024;
        this.cache.quality = s.previewQuality;
        if (this.cache.accelerated !== s.hardwareAcceleration) {
          this.cache.accelerated = s.hardwareAcceleration;
          this.cache.invalidate();
        }
        this.requestDraw();
      }),
    );
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
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('poulpe:fit', this.zoomToFit);
    window.addEventListener('poulpe:textselection', this.requestDraw);
    document.fonts?.addEventListener?.('loadingdone', this.onFontsLoaded);
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    setRenderStatsSource(null);
    this.paths.dispose();
    this.photo.dispose();
    this.unsubscribe.forEach((u) => u());
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerCancel);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('dblclick', this.onDoubleClick);
    c.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('poulpe:fit', this.zoomToFit);
    window.removeEventListener('poulpe:textselection', this.requestDraw);
    document.fonts?.removeEventListener?.('loadingdone', this.onFontsLoaded);
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
    const v = this.view;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const w = this.toWorld(sx, sy);
    ui.set({ view: { zoom: z, panX: sx - w.x * z, panY: sy - w.y * z } });
    void v;
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

  private selectionFrame(): Frame | null {
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

  private handlePoints(f: Frame): { id: HandleId; p: Vec }[] {
    return (Object.keys(HANDLES) as HandleId[]).map((id) => {
      const [hx, hy] = HANDLES[id];
      return { id, p: localToWorld(f, { x: hx * f.width, y: hy * f.height }) };
    });
  }

  private rotateHandle(f: Frame): Vec {
    const z = this.view.zoom;
    return localToWorld(f, { x: f.width / 2, y: -ROTATE_OFFSET / z });
  }

  private hitHandle(sx: number, sy: number): HandleId | 'rotate' | null {
    // Outil Nœud sur un tracé : pas de poignées de transformation, on modifie les nœuds.
    if (this.paths.editablePath()) return null;
    const f = this.selectionFrame();
    if (!f || this.anySelectedLocked()) return null;
    const rp = this.toScreen(this.rotateHandle(f));
    if (!this.cropNode() && Math.hypot(rp.x - sx, rp.y - sy) <= HANDLE_SIZE) return 'rotate';
    const sel = editor.selection;
    const single = sel.length === 1 ? findNode(editor.doc, sel[0])?.node : null;
    for (const { id, p } of this.handlePoints(f)) {
      // La hauteur d'un texte suit son contenu : pas de poignées haut et bas (sauf un cadre de texte).
      if (single?.type === 'text' && !isFrameText(editor.doc, single) && (id === 'n' || id === 's')) continue;
      const s = this.toScreen(p);
      if (Math.abs(s.x - sx) <= HANDLE_SIZE && Math.abs(s.y - sy) <= HANDLE_SIZE) return id;
    }
    return null;
  }

  private anySelectedLocked(): boolean {
    const doc = editor.doc;
    return editor.selection.some((id) => findNode(doc, id)?.node.locked);
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

  private effectiveTool(): ToolId {
    return this.spaceDown ? 'hand' : ui.get().tool;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && this.effectiveTool() === 'hand')) {
      this.startPan(e);
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left,
      sy = e.clientY - rect.top;
    const p = this.toWorld(sx, sy);
    const tool = this.effectiveTool();
    const doc = editor.doc;

    if (isEditingText()) {
      // Un clic dans un autre cadre de la même chaîne y place le curseur.
      const parts = editParts(doc, editedTextId()!);
      const i = parts.length > 1 ? indexAtWorld(parts, p, false) : null;
      if (i !== null) {
        const sel = textSelection();
        setTextSelection(e.shiftKey && sel ? sel.start : i, i);
        this.requestDraw();
        return;
      }
      // Un clic hors du texte termine l'édition (la zone de texte gère elle-même les clics dedans).
      endTextEdit();
      (document.activeElement as HTMLElement | null)?.blur();
    }

    // Choix du cadre suivant d'un texte qui déborde : un cadre existant, ou un nouveau cadre ici.
    const linkFrom = ui.get().linkFrom;
    if (linkFrom) {
      ui.set({ linkFrom: null });
      const hit = this.hitTest(p, true);
      linkTextFrames(linkFrom, hit?.type === 'text' ? hit.id : null, p);
      this.requestDraw();
      return;
    }
    if ((tool === 'select' || tool === 'text') && this.hitOverflow(sx, sy)) {
      ui.set({ linkFrom: this.hitOverflow(sx, sy) });
      this.updateCursor();
      return;
    }

    if (tool === 'zoom') {
      const z = this.view.zoom;
      this.zoomAt(e.altKey ? z / 1.5 : z * 1.5, sx, sy);
      return;
    }
    if (tool === 'eyedropper') {
      const px = this.ctx.getImageData(Math.round(sx * this.dpr), Math.round(sy * this.dpr), 1, 1).data;
      const hex = '#' + [px[0], px[1], px[2]].map((c) => c.toString(16).padStart(2, '0')).join('');
      // En Persona Photo, la pipette prend la couleur du pinceau.
      if (ui.get().persona === 'photo') ui.set({ brushColor: hex });
      else setPaint(ui.get().colorTarget, { type: 'solid', color: hex });
      pushRecentColor(hex);
      return;
    }
    if (this.photo.pointerDown(e, p, { x: sx, y: sy })) {
      this.requestDraw();
      return;
    }
    if (this.paths.pointerDown(e, p, { x: sx, y: sy })) {
      this.requestDraw();
      return;
    }
    if (tool === 'image') {
      void importImage();
      return;
    }
    if (tool === 'artboard') {
      const ab = artboardAt(doc, p);
      if (ab) {
        editor.setActiveArtboard(ab.id);
        editor.select([]);
        editor.begin();
        this.gesture = {
          kind: 'artboardMove',
          id: ab.id,
          start: p,
          origin: { x: ab.x, y: ab.y },
          moved: false,
        };
      } else {
        this.gesture = { kind: 'artboardCreate', start: p, current: p };
      }
      return;
    }
    if (tool === 'text') {
      const hit = this.hitTest(p, true);
      if (hit?.type === 'text') {
        editor.select([hit.id]);
        beginTextEdit(hit.id, false);
        return;
      }
      const ab = artboardAt(doc, p) ?? findArtboard(doc, editor.getState().activeArtboardId);
      if (!ab) return;
      this.gesture = {
        kind: 'create',
        tool,
        start: p,
        artboardId: ab.id,
        nodeId: null,
        lines: collectSnapLines(doc, new Set()),
      };
      return;
    }
    if (SHAPE_TOOLS.includes(tool)) {
      const ab = artboardAt(doc, p) ?? findArtboard(doc, editor.getState().activeArtboardId);
      if (!ab) return;
      const lines = collectSnapLines(doc, new Set());
      const start = this.snapping() ? snapPoint(p, lines, this.snapThreshold(), this.gridStep()) : p;
      this.gesture = {
        kind: 'create',
        tool,
        start: { x: start.x, y: start.y },
        artboardId: ab.id,
        nodeId: null,
        lines,
      };
      editor.setActiveArtboard(ab.id);
      return;
    }

    // Recadrage : les poignées changent le cadre, un glissement dedans déplace l'image.
    const crop = this.cropNode();
    if (crop) {
      const handle = this.hitHandle(sx, sy);
      const full = cropFull(crop);
      const l = worldToLocal(crop, p);
      if (handle && handle !== 'rotate') {
        editor.begin();
        this.gesture = { kind: 'cropResize', handle, node: crop, full };
        return;
      }
      if (l.x >= full.x && l.y >= full.y && l.x <= full.x + full.width && l.y <= full.y + full.height) {
        editor.begin();
        this.gesture = { kind: 'cropPan', start: p, node: crop, full, moved: false };
        return;
      }
      ui.set({ cropId: null });
    }

    // Outils de sélection.
    const handle = this.hitHandle(sx, sy);
    const guide = handle ? null : this.hitGuide(sx, sy);
    if (guide && (tool === 'select' || tool === 'direct')) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.dragGuide(guide.axis, guide.index, e);
      return;
    }
    if (handle === 'rotate') {
      const f = this.selectionFrame()!;
      const c = boxCenter(f);
      const ids = topLevelIds(doc, editor.selection);
      editor.begin();
      this.gesture = { kind: 'rotate', center: c, startAngle: Math.atan2(p.y - c.y, p.x - c.x), ids };
      return;
    }
    if (handle) {
      const f = this.selectionFrame()!;
      const ids = topLevelIds(doc, editor.selection);
      const single = ids.length === 1 ? findNode(doc, ids[0])!.node : null;
      editor.begin();
      this.gesture = {
        kind: 'resize',
        handle,
        frame: f,
        ids,
        single: single && single.type !== 'group' ? single : null,
        lines: collectSnapLines(doc, idsWithDescendants(doc, ids)),
      };
      return;
    }
    const hit = this.hitTest(p, tool === 'direct' || e.metaKey || e.ctrlKey);
    if (hit) {
      let selection = editor.selection;
      if (e.shiftKey) {
        selection = selection.includes(hit.id)
          ? selection.filter((id) => id !== hit.id)
          : [...selection, hit.id];
        editor.select(selection);
        if (!selection.includes(hit.id)) return;
      } else if (!selection.includes(hit.id)) {
        selection = [hit.id];
        editor.select(selection);
      }
      const ids = topLevelIds(doc, selection).filter((id) => !findNode(doc, id)?.node.locked);
      if (!ids.length) return;
      const box = selectionBounds(doc, ids)!;
      editor.begin();
      this.gesture = {
        kind: 'move',
        start: p,
        ids,
        box,
        lines: collectSnapLines(doc, idsWithDescendants(doc, ids)),
        clones: e.altKey ? ids.map((id) => cloneWithNewIds(findNode(doc, id)!.node)) : null,
        moved: false,
      };
      return;
    }
    const ab = artboardAt(doc, p);
    if (ab) editor.setActiveArtboard(ab.id);
    this.gesture = {
      kind: 'marquee',
      start: p,
      current: p,
      additive: e.shiftKey,
      base: e.shiftKey ? editor.selection : [],
    };
    if (!e.shiftKey) editor.select([]);
  };

  private startPan(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const v = this.view;
    this.gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, panX: v.panX, panY: v.panY };
    this.canvas.style.cursor = 'grabbing';
  }

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left,
      sy = e.clientY - rect.top;
    const p = this.toWorld(sx, sy);
    this.lastPointer = { x: sx, y: sy };
    ui.set({ cursor: { x: Math.round(p.x), y: Math.round(p.y) } });
    if (!this.gesture && this.photo.pointerMove(e, p, { x: sx, y: sy })) return;
    if (!this.gesture && this.paths.pointerMove(e, p, { x: sx, y: sy })) {
      if (this.effectiveTool() === 'direct') this.canvas.style.cursor = 'default';
      return;
    }
    const g = this.gesture;
    if (!g) {
      this.updateHover(p, sx, sy);
      return;
    }
    const snap = this.snapping() && !e.ctrlKey;
    switch (g.kind) {
      case 'pan':
        ui.set({ view: { ...this.view, panX: g.panX + e.clientX - g.sx, panY: g.panY + e.clientY - g.sy } });
        return;
      case 'move':
        return this.dragMove(g, p, e.shiftKey, snap);
      case 'resize':
        return this.dragResize(g, p, e.shiftKey, e.altKey, snap);
      case 'rotate': {
        let delta = ((Math.atan2(p.y - g.center.y, p.x - g.center.x) - g.startAngle) * 180) / Math.PI;
        if (e.shiftKey) delta = Math.round(delta / 15) * 15;
        editor.preview((d) => {
          for (const id of g.ids) rotateNode(findNode(d, id)!.node, normalizeAngle(delta), g.center);
        });
        return;
      }
      case 'marquee': {
        g.current = p;
        const box = rectFrom(g.start, p);
        const doc = editor.doc;
        const inside = doc.artboards
          .flatMap((ab) => ab.children)
          .filter((n) => n.visible && !n.locked && boxesIntersect(nodeBounds(n), box))
          .map((n) => n.id);
        editor.select([...new Set([...g.base, ...inside])]);
        this.requestDraw();
        return;
      }
      case 'create':
        return this.dragCreate(g, p, e.shiftKey, e.altKey, snap);
      case 'cropResize':
        return this.dragCropResize(g, p);
      case 'cropPan':
        return this.dragCropPan(g, p);
      case 'artboardCreate':
        g.current = p;
        this.requestDraw();
        return;
      case 'artboardMove': {
        let dx = p.x - g.start.x,
          dy = p.y - g.start.y;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        g.moved = true;
        editor.preview((d) => {
          const ab = findArtboard(d, g.id)!;
          const nx = Math.round(g.origin.x + dx),
            ny = Math.round(g.origin.y + dy);
          ab.children.forEach((n) => translateNode(n, nx - ab.x, ny - ab.y));
          ab.x = nx;
          ab.y = ny;
        });
        return;
      }
    }
  };

  private dragMove(g: Extract<Gesture, { kind: 'move' }>, p: Vec, shift: boolean, snap: boolean) {
    let dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) * this.view.zoom < 3) return;
    g.moved = true;
    if (shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    this.guides = [];
    if (snap) {
      const r = snapMove(g.box, dx, dy, g.lines, this.snapThreshold(), this.gridStep());
      if (!shift || dx) dx = r.dx;
      if (!shift || dy) dy = r.dy;
      this.guides = r.guides;
    }
    const clones = g.clones;
    g.recipe = (d) => {
      let ids = g.ids;
      if (clones) {
        ids = clones.map((c, i) => {
          const loc = findNode(d, g.ids[i])!;
          loc.parent.children.splice(loc.index + 1, 0, c);
          return c.id;
        });
      }
      for (const id of ids) translateNode(findNode(d, id)!.node, dx, dy);
      return clones ? ids : undefined;
    };
    editor.preview(g.recipe);
  }

  private dragResize(
    g: Extract<Gesture, { kind: 'resize' }>,
    pRaw: Vec,
    keepRatio: boolean,
    fromCenter: boolean,
    snap: boolean,
  ) {
    const f = g.frame;
    const [hx, hy] = HANDLES[g.handle];
    let p = pRaw;
    this.guides = [];
    if (snap && !f.rotation) {
      const s = snapPoint(pRaw, g.lines, this.snapThreshold(), this.gridStep());
      p = { x: hx === 0.5 ? pRaw.x : s.x, y: hy === 0.5 ? pRaw.y : s.y };
      this.guides = s.guides.filter((gd) => (gd.axis === 'x' ? hx !== 0.5 : hy !== 0.5));
    }
    const l = worldToLocal(f, p);
    const text = g.single?.type === 'text' ? g.single : null;
    const corner = hx !== 0.5 && hy !== 0.5;
    // Un texte artistique s'agrandit proportionnellement par les coins.
    if (text?.autoWidth && corner) keepRatio = true;
    const ax = fromCenter ? f.width / 2 : (1 - hx) * f.width;
    const ay = fromCenter ? f.height / 2 : (1 - hy) * f.height;
    let x0 = 0,
      x1 = f.width,
      y0 = 0,
      y1 = f.height;
    if (hx !== 0.5) {
      const edge = l.x;
      if (fromCenter) {
        x0 = ax - Math.abs(edge - ax);
        x1 = ax + Math.abs(edge - ax);
      } else [x0, x1] = hx === 1 ? [ax, edge] : [edge, ax];
    }
    if (hy !== 0.5) {
      const edge = l.y;
      if (fromCenter) {
        y0 = ay - Math.abs(edge - ay);
        y1 = ay + Math.abs(edge - ay);
      } else [y0, y1] = hy === 1 ? [ay, edge] : [edge, ay];
    }
    let sx = f.width ? (x1 - x0) / f.width : 1;
    let sy = f.height ? (y1 - y0) / f.height : 1;
    if (keepRatio) {
      const k = corner ? Math.max(Math.abs(sx), Math.abs(sy)) : hx !== 0.5 ? Math.abs(sx) : Math.abs(sy);
      sx = Math.sign(sx || 1) * k;
      sy = Math.sign(sy || 1) * k;
      const w = f.width * sx,
        h = f.height * sy;
      if (fromCenter) {
        x0 = ax - w / 2;
        y0 = ay - h / 2;
      } else {
        x0 = hx === 0 ? ax - w : hx === 1 ? ax : ax - w / 2;
        y0 = hy === 0 ? ay - h : hy === 1 ? ay : ay - h / 2;
        if (hx === 0.5) x0 = (f.width - w) / 2;
        if (hy === 0.5) y0 = (f.height - h) / 2;
      }
      x1 = x0 + w;
      y1 = y0 + h;
    }
    editor.preview((d) => {
      if (g.single) {
        const n = findNode(d, g.single.id)!.node;
        const nx0 = Math.min(x0, x1),
          ny0 = Math.min(y0, y1);
        const w = Math.max(1, Math.abs(x1 - x0)),
          h = Math.max(1, Math.abs(y1 - y0));
        const c = localToWorld(f, { x: nx0 + w / 2, y: ny0 + h / 2 });
        if (n.type === 'text' && g.single.type === 'text') {
          if (n.autoWidth && corner) {
            n.style = g.single.style;
            n.runs = g.single.runs;
            scaleTextSize(n, Math.abs(sy));
          } else if (hx === 0.5 && !isFrameText(d, n)) return;
          else n.autoWidth = false;
        }
        n.width = w;
        n.height = h;
        n.x = c.x - w / 2;
        n.y = c.y - h / 2;
        if (n.type === 'line' && g.single.type === 'line') {
          const flipped = x1 < x0 !== y1 < y0;
          n.direction = flipped ? (g.single.direction === 1 ? -1 : 1) : g.single.direction;
        }
        return;
      }
      const origin = localToWorld(f, { x: ax, y: ay });
      const sxx = (x1 - x0) / (f.width || 1);
      const syy = (y1 - y0) / (f.height || 1);
      for (const id of g.ids)
        scaleNode(
          findNode(d, id)!.node,
          hx === 0.5 && !keepRatio ? 1 : sxx,
          hy === 0.5 && !keepRatio ? 1 : syy,
          fromCenter ? boxCenter(f) : origin,
          keepRatio,
        );
    });
  }

  // ————— Repères —————

  /** Repère sous le point écran, à 4 px près. */
  private hitGuide(sx: number, sy: number): { axis: 'x' | 'y'; index: number } | null {
    const g = editor.doc.guides;
    if (!g || !ui.get().settings.rulers) return null;
    const v = this.view;
    const ix = g.x.findIndex((x) => Math.abs(x * v.zoom + v.panX - sx) <= 4);
    if (ix >= 0) return { axis: 'x', index: ix };
    const iy = g.y.findIndex((y) => Math.abs(y * v.zoom + v.panY - sy) <= 4);
    return iy >= 0 ? { axis: 'y', index: iy } : null;
  }

  /**
   * Glisse un repère : nouveau (`index` null, tiré depuis une règle) ou existant. Relâché hors
   * du canevas (sur une règle), le repère est supprimé.
   */
  dragGuide(axis: 'x' | 'y', index: number | null, e: PointerEvent): void {
    const target = e.target as Element;
    target.setPointerCapture?.(e.pointerId);
    editor.begin();
    let idx = index;
    const pos = (ev: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const p = this.toWorld(ev.clientX - r.left, ev.clientY - r.top);
      let v = axis === 'x' ? p.x : p.y;
      if (this.snapping() && !ev.ctrlKey) {
        const lines = collectSnapLines(editor.doc, new Set(), false);
        const s = snapPoint(p, lines, this.snapThreshold(), this.gridStep());
        v = axis === 'x' ? s.x : s.y;
      }
      return Math.round(v * 100) / 100;
    };
    const inside = (ev: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return ev.clientX >= r.left && ev.clientY >= r.top && ev.clientX <= r.right && ev.clientY <= r.bottom;
    };
    const move = (ev: PointerEvent) => {
      const v = pos(ev);
      const show = inside(ev);
      editor.preview((d) => {
        const g = (d.guides ??= { x: [], y: [] });
        const list = g[axis];
        if (idx === null) {
          if (!show) return;
          list.push(v);
        } else if (show) list[idx] = v;
        else list.splice(idx, 1);
      });
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move as EventListener);
      target.removeEventListener('pointerup', up as EventListener);
      target.removeEventListener('pointercancel', up as EventListener);
      if (ev.type === 'pointercancel' || (idx === null && !inside(ev))) {
        editor.cancel();
        return;
      }
      move(ev);
      editor.commit('history.guide');
    };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up as EventListener);
    target.addEventListener('pointercancel', up as EventListener);
  }

  /** Image en cours de recadrage, si elle est toujours seule sélectionnée. */
  cropNode(): ImageNode | null {
    const id = ui.get().cropId;
    if (!id || editor.selection.length !== 1 || editor.selection[0] !== id) return null;
    const n = findNode(editor.doc, id)?.node;
    return n?.type === 'image' && !n.locked ? n : null;
  }

  private dragCropResize(g: Extract<Gesture, { kind: 'cropResize' }>, p: Vec) {
    const o = g.node;
    const full = g.full;
    const [hx, hy] = HANDLES[g.handle];
    const l = worldToLocal(o, p);
    let x0 = 0,
      y0 = 0,
      x1 = o.width,
      y1 = o.height;
    const clampX = (v: number) => Math.min(full.x + full.width, Math.max(full.x, v));
    const clampY = (v: number) => Math.min(full.y + full.height, Math.max(full.y, v));
    if (hx === 0) x0 = Math.min(clampX(l.x), x1 - 1);
    if (hx === 1) x1 = Math.max(clampX(l.x), x0 + 1);
    if (hy === 0) y0 = Math.min(clampY(l.y), y1 - 1);
    if (hy === 1) y1 = Math.max(clampY(l.y), y0 + 1);
    const c = localToWorld(o, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    editor.preview((d) => {
      const n = findNode(d, o.id)!.node;
      if (n.type !== 'image') return;
      n.width = x1 - x0;
      n.height = y1 - y0;
      n.x = c.x - n.width / 2;
      n.y = c.y - n.height / 2;
      n.crop = {
        x: (x0 - full.x) / full.width,
        y: (y0 - full.y) / full.height,
        width: (x1 - x0) / full.width,
        height: (y1 - y0) / full.height,
      };
    });
  }

  private dragCropPan(g: Extract<Gesture, { kind: 'cropPan' }>, p: Vec) {
    const o = g.node;
    const a = worldToLocal(o, g.start);
    const b = worldToLocal(o, p);
    if (!g.moved && Math.hypot(b.x - a.x, b.y - a.y) * this.view.zoom < 2) return;
    g.moved = true;
    const full = g.full;
    // Le cadre reste à l'intérieur de l'image.
    const fx = Math.min(0, Math.max(o.width - full.width, full.x + b.x - a.x));
    const fy = Math.min(0, Math.max(o.height - full.height, full.y + b.y - a.y));
    editor.preview((d) => {
      const n = findNode(d, o.id)!.node;
      if (n.type !== 'image') return;
      n.crop = {
        x: -fx / full.width,
        y: -fy / full.height,
        width: o.width / full.width,
        height: o.height / full.height,
      };
    });
  }

  private dragCreate(
    g: Extract<Gesture, { kind: 'create' }>,
    pRaw: Vec,
    shift: boolean,
    alt: boolean,
    snap: boolean,
  ) {
    this.guides = [];
    let p = pRaw;
    if (snap) {
      const s = snapPoint(pRaw, g.lines, this.snapThreshold(), this.gridStep());
      p = s;
      this.guides = s.guides;
    }
    let dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (!g.nodeId && Math.hypot(dx, dy) * this.view.zoom < 3) return;
    if (g.tool === 'line') {
      if (shift) {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        dx = Math.cos(ang) * len;
        dy = Math.sin(ang) * len;
      }
    } else if (shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    let box: Box;
    if (alt && g.tool !== 'line')
      box = {
        x: g.start.x - Math.abs(dx),
        y: g.start.y - Math.abs(dy),
        width: Math.abs(dx) * 2,
        height: Math.abs(dy) * 2,
      };
    else box = rectFrom(g.start, { x: g.start.x + dx, y: g.start.y + dy });
    const node = g.nodeId ? null : this.makeNode(g.tool, box, Math.sign(dx) * Math.sign(dy) < 0 ? -1 : 1);
    if (node) {
      g.nodeId = node.id;
      editor.begin();
    }
    const id = g.nodeId!;
    const fresh = node;
    const dir: 1 | -1 = Math.sign(dx) * Math.sign(dy) < 0 ? -1 : 1;
    editor.preview((d) => {
      let n = findNode(d, id)?.node;
      if (!n) {
        const ab = findArtboard(d, g.artboardId)!;
        ab.children.push(fresh ?? this.makeNode(g.tool, box, dir));
        n = ab.children[ab.children.length - 1];
        n.id = id;
      }
      n.x = box.x;
      n.y = box.y;
      n.width = Math.max(1, box.width);
      n.height = g.tool === 'line' ? box.height : Math.max(1, box.height);
      if (n.type === 'line') n.direction = dir;
      if (n.type === 'text') {
        n.autoWidth = false;
        // Persona Mise en page : l'outil Texte trace des cadres de texte.
        if (ui.get().persona === 'layout') n.frame = true;
      }
      return [id];
    });
  }

  private makeNode(tool: ToolId, box: Box, direction: 1 | -1): SceneNode {
    const d = ui.get().defaults;
    switch (tool) {
      case 'rect': {
        const r = createRect({ ...box, name: t('name.rect') }, d);
        r.cornerRadius = d.cornerRadius;
        return r;
      }
      case 'ellipse':
        return createEllipse({ ...box, name: t('name.ellipse') }, d);
      case 'polygon':
        return createPolygon({ ...box, name: t('name.polygon') }, d, d.sides);
      case 'star':
        return createStar({ ...box, name: t('name.star') }, d, d.points, d.innerRatio);
      case 'line':
        return createLine({ ...box, direction, name: t('name.line') }, d);
      default:
        return createText({ ...box, name: t('name.text'), autoWidth: false }, d);
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    const g = this.gesture;
    this.gesture = null;
    this.guides = [];
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!g && this.photo.pointerUp()) {
      this.requestDraw();
      return;
    }
    if (!g && this.paths.pointerUp()) {
      this.requestDraw();
      return;
    }
    if (!g) return;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    switch (g.kind) {
      case 'pan':
        this.updateCursor();
        break;
      case 'move':
        if (!g.moved) {
          editor.cancel();
          break;
        }
        // Un objet glissé sur un autre plan de travail y est rattaché.
        editor.preview((d) => {
          const ids = g.recipe?.(d);
          reparentToArtboards(d, ids ?? g.ids);
          return ids;
        });
        editor.commit(g.clones ? 'history.duplicate' : 'history.move');
        break;
      case 'resize':
        editor.commit('history.resize');
        break;
      case 'rotate':
        editor.commit('history.rotate');
        break;
      case 'marquee':
        break;
      case 'cropResize':
        editor.commit('history.crop');
        break;
      case 'cropPan':
        if (g.moved) editor.commit('history.crop');
        else editor.cancel();
        break;
      case 'artboardMove':
        if (g.moved) editor.commit('history.artboard');
        else editor.cancel();
        break;
      case 'artboardCreate': {
        const box = rectFrom(g.start, p);
        if (box.width * this.view.zoom < 4 || box.height * this.view.zoom < 4) break;
        const ab = createArtboard({
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
          name: t('name.artboard', { n: editor.doc.artboards.length + 1 }),
        });
        editor.apply('history.artboard', (d) => {
          d.artboards.push(ab);
          return [];
        });
        editor.setActiveArtboard(ab.id);
        break;
      }
      case 'create':
        if (g.nodeId) {
          editor.commit('history.add');
          if (g.tool === 'text') beginTextEdit(g.nodeId, false);
          break;
        }
        // Simple clic : texte artistique, ou forme de taille par défaut.
        if (g.tool === 'text') {
          const d = ui.get().defaults;
          const node = createText(
            {
              x: g.start.x,
              y: g.start.y - d.text.fontSize * 0.6,
              width: 10,
              height: d.text.fontSize,
              name: t('name.text'),
              autoWidth: true,
            },
            d,
          );
          beginTextEdit(node.id, true, node, g.artboardId);
        } else {
          const size = 100;
          const box =
            g.tool === 'line'
              ? { x: g.start.x, y: g.start.y, width: size, height: 0 }
              : { x: g.start.x - size / 2, y: g.start.y - size / 2, width: size, height: size };
          const node = this.makeNode(g.tool, box, 1);
          editor.apply('history.add', (d) => {
            findArtboard(d, g.artboardId)!.children.push(node);
            return [node.id];
          });
        }
        break;
    }
    this.requestDraw();
  };

  private onPointerCancel = () => {
    this.paths.pointerCancel();
    this.photo.pointerCancel();
    if (this.gesture && this.gesture.kind !== 'pan' && this.gesture.kind !== 'marquee') editor.cancel();
    this.gesture = null;
    this.guides = [];
    this.requestDraw();
  };

  private onPointerLeave = () => {
    ui.set({ cursor: null });
    this.photo.pointerLeave();
    if (this.hoverId) {
      this.hoverId = null;
      this.requestDraw();
    }
  };

  private onDoubleClick = (e: MouseEvent) => {
    const tool = ui.get().tool;
    if (tool !== 'select' && tool !== 'direct') return;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    if (this.paths.doubleClick(p, { x: e.clientX - rect.left, y: e.clientY - rect.top })) return;
    const hit = this.hitTest(p, true);
    if (!hit) return;
    if (hit.type === 'text') {
      editor.select([hit.id]);
      beginTextEdit(hit.id, false);
      return;
    }
    if (hit.type === 'image') {
      editor.select([hit.id]);
      ui.set({ cropId: hit.id });
      return;
    }
    // Double-clic dans un groupe : sélectionne l'objet à l'intérieur.
    editor.select([hit.id]);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left,
      sy = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      this.zoomAt(this.view.zoom * factor, sx, sy);
      return;
    }
    const v = this.view;
    const k = e.deltaMode === 1 ? 16 : 1;
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    ui.set({ view: { ...v, panX: v.panX - dx * k, panY: v.panY - dy * k } });
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const down = e.type === 'keydown';
    if (down) e.preventDefault();
    if (this.spaceDown !== down) {
      this.spaceDown = down;
      this.updateCursor();
    }
  };

  private updateHover(p: Vec, sx: number, sy: number) {
    const tool = this.effectiveTool();
    let hover: string | null = null;
    let cursor = '';
    const crop = tool === 'select' || tool === 'direct' ? this.cropNode() : null;
    if (crop) {
      const h = this.hitHandle(sx, sy);
      const full = cropFull(crop);
      const l = worldToLocal(crop, p);
      const inside =
        l.x >= full.x && l.y >= full.y && l.x <= full.x + full.width && l.y <= full.y + full.height;
      this.canvas.style.cursor =
        h && h !== 'rotate' ? handleCursor(h, crop.rotation) : inside ? 'move' : 'default';
      return;
    }
    if (tool === 'select' || tool === 'direct') {
      const h = this.hitHandle(sx, sy);
      const guide = h ? null : this.hitGuide(sx, sy);
      if (guide) cursor = guide.axis === 'x' ? 'col-resize' : 'row-resize';
      else if (h === 'rotate') cursor = 'grab';
      else if (h) cursor = handleCursor(h, this.selectionFrame()?.rotation ?? 0);
      else hover = this.hitTest(p, tool === 'direct')?.id ?? null;
    }
    this.canvas.style.cursor = cursor || this.toolCursor(tool);
    if (hover !== this.hoverId) {
      this.hoverId = hover;
      this.requestDraw();
    }
  }

  /** Épreuvage à l'écran : les pages montrent les couleurs qu'elles auront une fois imprimées en CMJN. */
  private softProof(doc: PoulpeDocument) {
    const { view } = ui.get();
    const k = this.dpr;
    const W = this.canvas.width,
      H = this.canvas.height;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const ab of doc.artboards) {
      const x0 = Math.max(0, Math.floor((ab.x * view.zoom + view.panX) * k));
      const y0 = Math.max(0, Math.floor((ab.y * view.zoom + view.panY) * k));
      const x1 = Math.min(W, Math.ceil(((ab.x + ab.width) * view.zoom + view.panX) * k));
      const y1 = Math.min(H, Math.ceil(((ab.y + ab.height) * view.zoom + view.panY) * k));
      if (x1 <= x0 || y1 <= y0) continue;
      const img = this.ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      softProofPixels(img.data);
      this.ctx.putImageData(img, x0, y0);
    }
    this.ctx.restore();
  }

  private toolCursor(tool: ToolId): string {
    if (ui.get().linkFrom) return 'copy';
    switch (tool) {
      case 'hand':
        return 'grab';
      case 'zoom':
        return 'zoom-in';
      case 'text':
        return 'text';
      case 'select':
      case 'direct':
        return 'default';
      default:
        return 'crosshair';
    }
  }

  private updateCursor() {
    this.canvas.style.cursor = this.toolCursor(this.effectiveTool());
  }

  // ————— Dessin —————

  draw(): void {
    const t0 = performance.now();
    const ctx = this.ctx;
    const { doc, selection, activeArtboardId } = editor.getState();
    const { view, settings, editingTextId, cropId, perspectiveId, maskEditId } = ui.get();
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.colors.pasteboard;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.panX, dpr * view.panY);
    // Objets susceptibles de changer à chaque image : ils sont dessinés en direct, le reste vient du cache.
    const top = topLevelOf(doc);
    const hot = new Set<string>();
    for (const id of [...selection, editingTextId, cropId, perspectiveId, maskEditId]) {
      const t = id && top.get(id);
      if (t) hot.add(t);
    }
    const cacheView = {
      scale: dpr * view.zoom,
      ox: dpr * view.panX,
      oy: dpr * view.panY,
      width: this.canvas.width,
      height: this.canvas.height,
    };
    const allowStale = t0 - this.viewChangedAt < SETTLE_MS;
    let stale = false;
    this.cache.prune(doc);
    for (const ab of doc.artboards) {
      // Plan de travail hors de l'écran : rien à dessiner.
      const sx = ab.x * view.zoom + view.panX,
        sy = ab.y * view.zoom + view.panY;
      if (
        sx > this.width + 40 ||
        sy > this.height + 40 ||
        sx + ab.width * view.zoom < -40 ||
        sy + ab.height * view.zoom < -40
      )
        continue;
      this.drawArtboardShadow(sx * dpr, sy * dpr, ab.width * view.zoom * dpr, ab.height * view.zoom * dpr);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ab.x, ab.y, ab.width, ab.height);
      if (ab.background.type === 'none') this.drawChecker(ab);
      stale =
        this.cache.drawArtboard(
          ctx,
          doc,
          ab,
          { images: this.images, editingId: editingTextId },
          cacheView,
          hot,
          allowStale,
        ) || stale;
      if (settings.grid) this.drawGrid(ab);
    }
    // Aperçu étiré pendant un zoom : redessiné net quand le geste s'arrête.
    clearTimeout(this.refreshTimer);
    if (stale) this.refreshTimer = setTimeout(() => this.requestDraw(), SETTLE_MS);
    if (ui.get().softProof) this.softProof(doc);
    // Calques d'interface, en pixels d'écran.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (settings.rulers) this.drawPageGuides(doc);
    this.drawArtboardLabels(doc, activeArtboardId);
    if (doc.guides && settings.rulers) this.drawDocGuides(doc.guides);
    const tool = ui.get().tool;
    if (this.hoverId && !selection.includes(this.hoverId)) {
      const n = findNode(doc, this.hoverId)?.node;
      if (n) this.outline(n, this.colors.sel, 1);
    }
    for (const id of selection) {
      const n = findNode(doc, id)?.node;
      if (n) this.outline(n, this.colors.sel, 1);
    }
    this.drawFrames(doc, selection);
    if (editingTextId) this.drawTextSelection(doc, editingTextId);
    const crop = this.cropNode();
    if (crop) this.drawCropGhost(doc, crop);
    if (!editingTextId && (tool === 'select' || tool === 'direct' || SHAPE_TOOLS.includes(tool)))
      this.drawHandles();
    this.paths.draw(ctx, this.colors.sel);
    this.photo.draw(ctx);
    const g = this.gesture;
    if (g?.kind === 'marquee' || g?.kind === 'artboardCreate') {
      const b = rectFrom(g.start, g.current);
      const a = this.toScreen(b);
      ctx.save();
      ctx.fillStyle = 'rgba(77,163,255,0.12)';
      ctx.strokeStyle = this.colors.sel;
      ctx.setLineDash(g.kind === 'marquee' ? [4, 3] : []);
      ctx.fillRect(a.x, a.y, b.width * view.zoom, b.height * view.zoom);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.width * view.zoom, b.height * view.zoom);
      ctx.restore();
    }
    if (this.guides.length) {
      ctx.save();
      ctx.strokeStyle = this.colors.guide;
      ctx.lineWidth = 1;
      for (const gd of this.guides) {
        ctx.beginPath();
        if (gd.axis === 'x') {
          const x = Math.round(this.toScreen({ x: gd.pos, y: 0 }).x) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, this.height);
        } else {
          const y = Math.round(this.toScreen({ x: 0, y: gd.pos }).y) + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(this.width, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    recordFrame(performance.now() - t0);
    window.dispatchEvent(new Event('poulpe:drawn'));
  }

  private drawDocGuides(guides: { x: number[]; y: number[] }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.colors.docGuide;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const gx of guides.x) {
      const x = Math.round(this.toScreen({ x: gx, y: 0 }).x) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
    }
    for (const gy of guides.y) {
      const y = Math.round(this.toScreen({ x: 0, y: gy }).y) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Damier de transparence : un motif de 16 px d'écran, au lieu de milliers de petits carrés. */
  /**
   * Ombre portée d'un plan de travail, en pixels du canevas. Un flou d'ombre (`shadowBlur`) sur un
   * grand rectangle coûte plus de 20 ms par image quand le moteur web dessine sans carte graphique
   * (WebKitGTK avec certains pilotes) : l'ombre d'un carré est floutée une seule fois, puis ses
   * coins sont recopiés et ses bords étirés, pour le même rendu.
   */
  private drawArtboardShadow(x: number, y: number, w: number, h: number) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const blur = 18 * dpr;
    const offsetY = 4 * dpr;
    // Étendue du flou (trois écarts types) ; le carré floué fait 2e de côté, l'image 4e.
    const e = Math.ceil(1.5 * blur);
    if (w < 2 * e || h < 2 * e) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = blur;
      ctx.shadowOffsetY = offsetY;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return;
    }
    if (this.shadowSprite?.dpr !== dpr) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 4 * e;
      const c = canvas.getContext('2d')!;
      // Le carré est dessiné hors de l'image : seule son ombre y tombe.
      c.shadowColor = 'rgba(0,0,0,0.35)';
      c.shadowBlur = blur;
      c.shadowOffsetX = 8 * e;
      c.fillStyle = '#000';
      c.fillRect(e - 8 * e, e, 2 * e, 2 * e);
      this.shadowSprite = { canvas, dpr, e };
    }
    const img = this.shadowSprite.canvas;
    const s = 2 * e; // taille d'un coin dans l'image
    y += offsetY;
    const [x0, x1, y0, y1] = [x - e, x + w - e, y - e, y + h - e];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Coins.
    ctx.drawImage(img, 0, 0, s, s, x0, y0, s, s);
    ctx.drawImage(img, s, 0, s, s, x1, y0, s, s);
    ctx.drawImage(img, 0, s, s, s, x0, y1, s, s);
    ctx.drawImage(img, s, s, s, s, x1, y1, s, s);
    // Bords : une colonne (ou une ligne) du milieu de l'image, étirée.
    const mw = x1 - x0 - s;
    const mh = y1 - y0 - s;
    if (mw > 0) {
      ctx.drawImage(img, s - 1, 0, 1, s, x0 + s, y0, mw, s);
      ctx.drawImage(img, s - 1, s, 1, s, x0 + s, y1, mw, s);
    }
    if (mh > 0) {
      ctx.drawImage(img, 0, s - 1, s, 1, x0, y0 + s, s, mh);
      ctx.drawImage(img, s, s - 1, s, 1, x1, y0 + s, s, mh);
    }
    ctx.restore();
  }

  private drawChecker(ab: Artboard) {
    const ctx = this.ctx;
    if (!this.checker) {
      const tile = document.createElement('canvas');
      tile.width = tile.height = 16;
      const t = tile.getContext('2d')!;
      t.fillStyle = '#ffffff';
      t.fillRect(0, 0, 16, 16);
      t.fillStyle = '#e6e6e6';
      t.fillRect(8, 0, 8, 8);
      t.fillRect(0, 8, 8, 8);
      this.checker = ctx.createPattern(tile, 'repeat');
    }
    if (!this.checker) return;
    const s = 1 / this.view.zoom;
    // Le motif part du coin du plan de travail et garde sa taille à l'écran.
    this.checker.setTransform(new DOMMatrix().translate(ab.x, ab.y).scale(s, s));
    ctx.save();
    ctx.fillStyle = this.checker;
    ctx.fillRect(ab.x, ab.y, ab.width, ab.height);
    ctx.restore();
  }

  private drawGrid(ab: Artboard) {
    const ctx = this.ctx;
    const step = this.gridSpacing();
    const z = this.view.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ab.x, ab.y, ab.width, ab.height);
    ctx.clip();
    ctx.strokeStyle = 'rgba(77,163,255,0.25)';
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    for (let x = Math.ceil(ab.x / step) * step; x <= ab.x + ab.width; x += step) {
      ctx.moveTo(x, ab.y);
      ctx.lineTo(x, ab.y + ab.height);
    }
    for (let y = Math.ceil(ab.y / step) * step; y <= ab.y + ab.height; y += step) {
      ctx.moveTo(ab.x, y);
      ctx.lineTo(ab.x + ab.width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawArtboardLabels(doc: PoulpeDocument, activeId: string) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '11px "Inter", system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    for (const ab of doc.artboards) {
      const p = this.toScreen(ab);
      ctx.fillStyle = ab.id === activeId ? this.colors.fg : this.colors.muted;
      ctx.font = `${ab.id === activeId ? 600 : 400} 11px "Inter", system-ui, sans-serif`;
      const label = ab.master
        ? `${ab.name} · ${t('pages.masterTag')}`
        : masterOf(doc, ab)
          ? `${ab.name} · ${masterOf(doc, ab)!.name}`
          : ab.name;
      ctx.fillText(label, p.x, p.y - 6);
      const w = ctx.measureText(label).width;
      ctx.fillStyle = this.colors.muted;
      ctx.font = '400 11px "Inter", system-ui, sans-serif';
      ctx.fillText(`${Math.round(ab.width)} × ${Math.round(ab.height)} px`, p.x + w + 8, p.y - 6);
    }
    ctx.restore();
  }

  private outline(n: SceneNode, color: string, width: number) {
    const ctx = this.ctx;
    const v = this.view;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (n.type === 'group') {
      const b = nodeBounds(n);
      const a = this.toScreen(b);
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(a.x, a.y, b.width * v.zoom, b.height * v.zoom);
    } else {
      ctx.translate(v.panX, v.panY);
      ctx.scale(v.zoom, v.zoom);
      ctx.translate(n.x + n.width / 2, n.y + n.height / 2);
      ctx.rotate((n.rotation * Math.PI) / 180);
      ctx.translate(-n.width / 2, -n.height / 2);
      ctx.lineWidth = width / v.zoom;
      ctx.stroke(nodePath(n));
    }
    ctx.restore();
  }

  /** Partie masquée de l'image recadrée, en transparence autour du cadre. */
  private drawCropGhost(doc: PoulpeDocument, n: ImageNode) {
    const img = this.images.get(doc, n.assetId);
    const full = cropFull(n);
    const ctx = this.ctx;
    const v = this.view;
    ctx.save();
    ctx.translate(v.panX, v.panY);
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(n.x + n.width / 2, n.y + n.height / 2);
    ctx.rotate((n.rotation * Math.PI) / 180);
    ctx.translate(-n.width / 2, -n.height / 2);
    ctx.beginPath();
    ctx.rect(full.x, full.y, full.width, full.height);
    ctx.rect(0, 0, n.width, n.height);
    ctx.save();
    ctx.clip('evenodd');
    ctx.globalAlpha = 0.4;
    if (img) ctx.drawImage(img, full.x, full.y, full.width, full.height);
    ctx.restore();
    ctx.setLineDash([4 / v.zoom, 3 / v.zoom]);
    ctx.lineWidth = 1 / v.zoom;
    ctx.strokeStyle = this.colors.sel;
    ctx.strokeRect(full.x, full.y, full.width, full.height);
    ctx.restore();
  }

  /** Sélection et curseur du texte en cours d'édition, dans chaque cadre de sa chaîne. */
  private drawTextSelection(doc: PoulpeDocument, id: string) {
    const head = findNode(doc, id)?.node;
    const sel = textSelection();
    if (head?.type !== 'text' || !sel || head.path) return;
    const ctx = this.ctx;
    const v = this.view;
    const parts = editParts(doc, id);
    const caretPart = sel.start === sel.end ? partAt(parts, sel.start) : null;
    for (const { node: n, layout } of parts) {
      if (caretPart && caretPart.node !== n) continue;
      ctx.save();
      ctx.translate(v.panX, v.panY);
      ctx.scale(v.zoom, v.zoom);
      ctx.translate(n.x + n.width / 2, n.y + n.height / 2);
      ctx.rotate((n.rotation * Math.PI) / 180);
      ctx.translate(-n.width / 2, -n.height / 2);
      if (caretPart) {
        const c = caretAt(layout, sel.start, measureText);
        ctx.fillStyle = this.colors.sel;
        ctx.fillRect(c.x - 0.75 / v.zoom, c.top, 1.5 / v.zoom, c.height);
      } else {
        ctx.fillStyle = 'rgba(77,163,255,0.35)';
        for (const line of layout.lines) {
          const a = Math.max(sel.start, line.start);
          const b = Math.min(sel.end, line.stop);
          if (b < a || (b === a && !(line.start === line.stop && sel.start <= a && a < sel.end))) continue;
          const x0 = charX(line, a, measureText);
          // Une fin de ligne sélectionnée (retour à la ligne compris) se voit par un petit débord.
          const x1 = charX(line, b, measureText) + (sel.end > line.end ? line.size * 0.25 : 0);
          ctx.fillRect(x0, line.top, Math.max(x1 - x0, 1 / v.zoom), line.height);
        }
      }
      ctx.restore();
    }
  }

  /** Cadres de texte : contour pointillé, liens entre cadres de la sélection et indicateur de débordement. */
  private drawFrames(doc: PoulpeDocument, selection: string[]) {
    const ctx = this.ctx;
    const v = this.view;
    const sel = new Set(selection);
    const linkFrom = ui.get().linkFrom;
    this.overflowMarks = [];
    for (const { node: n } of walkTexts(doc)) {
      if (!isFrameText(doc, n) || !n.visible) continue;
      const head = chainHead(doc, n.id);
      const chain = head ? editPartsChain(doc, head.id) : null;
      const inSel = !!chain?.nodes.some((c) => sel.has(c.id));
      ctx.save();
      ctx.translate(v.panX, v.panY);
      ctx.scale(v.zoom, v.zoom);
      ctx.translate(n.x + n.width / 2, n.y + n.height / 2);
      ctx.rotate((n.rotation * Math.PI) / 180);
      ctx.translate(-n.width / 2, -n.height / 2);
      ctx.lineWidth = 1 / v.zoom;
      ctx.setLineDash([3 / v.zoom, 3 / v.zoom]);
      ctx.strokeStyle = inSel ? this.colors.sel : 'rgba(120,120,130,0.55)';
      ctx.strokeRect(0, 0, n.width, n.height);
      ctx.restore();
      // Débordement : petit carré rouge « + » en bas à droite du dernier cadre.
      const last = chain?.nodes[chain.nodes.length - 1];
      const overflow = last?.id === n.id && chain!.overflow;
      if (overflow || linkFrom === n.id || (inSel && last?.id === n.id)) {
        const q = this.toScreen(localToWorld(n, { x: n.width, y: n.height }));
        const s = 12;
        ctx.save();
        ctx.fillStyle = overflow ? '#e5484d' : this.colors.sel;
        ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(q.x - 3.5, q.y);
        ctx.lineTo(q.x + 3.5, q.y);
        ctx.moveTo(q.x, q.y - 3.5);
        ctx.lineTo(q.x, q.y + 3.5);
        ctx.stroke();
        ctx.restore();
        this.overflowMarks.push({ id: n.id, x: q.x, y: q.y });
      }
    }
    // Liens entre les cadres de la chaîne sélectionnée.
    for (const id of selection) {
      const n = findNode(doc, id)?.node;
      if (n?.type !== 'text' || !isLinked(doc, id)) continue;
      const head = chainHead(doc, id)!;
      const nodes = editPartsChain(doc, head.id).nodes;
      ctx.save();
      ctx.strokeStyle = this.colors.sel;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k + 1 < nodes.length; k++) {
        const a = this.toScreen(localToWorld(nodes[k], { x: nodes[k].width, y: nodes[k].height }));
        const b = this.toScreen(localToWorld(nodes[k + 1], { x: 0, y: 0 }));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.restore();
      break;
    }
  }

  private overflowMarks: { id: string; x: number; y: number }[] = [];

  /** Indicateur de débordement (ou de lien) sous le pointeur. */
  private hitOverflow(sx: number, sy: number): string | null {
    for (const m of this.overflowMarks) if (Math.abs(m.x - sx) <= 8 && Math.abs(m.y - sy) <= 8) return m.id;
    return null;
  }

  /** Marges des pages et limite du fond perdu (sur les pages, pas sur le reste du plan de travail). */
  private drawPageGuides(doc: PoulpeDocument) {
    const layout = doc.layout;
    if (!layout?.margins && !layout?.bleed) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1;
    for (const ab of doc.artboards) {
      const m = pageMargins(doc, ab);
      if (m) {
        const a = this.toScreen({ x: ab.x + m.left, y: ab.y + m.top });
        const b = this.toScreen({ x: ab.x + ab.width - m.right, y: ab.y + ab.height - m.bottom });
        ctx.strokeStyle = 'rgba(214,92,214,0.8)';
        ctx.strokeRect(
          Math.round(a.x) + 0.5,
          Math.round(a.y) + 0.5,
          Math.round(b.x - a.x),
          Math.round(b.y - a.y),
        );
      }
      if (layout.bleed && !ab.master) {
        const k = layout.bleed;
        // En vis-à-vis, pas de fond perdu du côté de la reliure.
        const left = isLeftPage(doc, ab);
        const facing = !!layout.facing;
        const a = this.toScreen({ x: ab.x - (facing && !left ? 0 : k), y: ab.y - k });
        const b = this.toScreen({ x: ab.x + ab.width + (facing && left ? 0 : k), y: ab.y + ab.height + k });
        ctx.strokeStyle = 'rgba(229,72,77,0.7)';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(
          Math.round(a.x) + 0.5,
          Math.round(a.y) + 0.5,
          Math.round(b.x - a.x),
          Math.round(b.y - a.y),
        );
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  private drawHandles() {
    if (this.paths.editablePath()) return;
    const f = this.selectionFrame();
    if (!f) return;
    const ctx = this.ctx;
    const corners = [
      { x: 0, y: 0 },
      { x: f.width, y: 0 },
      { x: f.width, y: f.height },
      { x: 0, y: f.height },
    ].map((c) => this.toScreen(localToWorld(f, c)));
    ctx.save();
    ctx.strokeStyle = this.colors.sel;
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    if (this.anySelectedLocked()) {
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#ffffff';
    if (!this.cropNode()) {
      const top = this.toScreen(localToWorld(f, { x: f.width / 2, y: 0 }));
      const rot = this.toScreen(this.rotateHandle(f));
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(rot.x, rot.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rot.x, rot.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const s = HANDLE_SIZE;
    for (const { p } of this.handlePoints(f)) {
      const q = this.toScreen(p);
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate((f.rotation * Math.PI) / 180);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.strokeRect(-s / 2 + 0.5, -s / 2 + 0.5, s - 1, s - 1);
      ctx.restore();
    }
    ctx.restore();
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

function rectFrom(a: Vec, b: Vec): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function handleCursor(h: HandleId, rotation: number): string {
  const base: Record<HandleId, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const a = (((base[h] + rotation) % 180) + 180) % 180;
  const names = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  return names[Math.round(a / 45) % 4];
}

/** Image entière dans le repère local d'une image recadrée. */
export function cropFull(n: ImageNode): Box {
  const c = n.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = n.width / c.width,
    height = n.height / c.height;
  return { x: -c.x * width, y: -c.y * height, width, height };
}

/** Cadre de texte (hauteur fixe) ou cadre d'une chaîne de cadres liés. */
function isFrameText(doc: PoulpeDocument, n: SceneNode): boolean {
  return n.type === 'text' && !n.path && (!!n.frame || !!n.next || isLinked(doc, n.id));
}

function* walkTexts(doc: PoulpeDocument): Generator<{ node: TextNode }> {
  const visit = function* (nodes: SceneNode[]): Generator<{ node: TextNode }> {
    for (const n of nodes) {
      if (n.type === 'group') yield* visit(n.children);
      else if (n.type === 'text') yield { node: n };
    }
  };
  for (const ab of doc.artboards) yield* visit(ab.children);
}

/** Cadres d'une chaîne et débordement, d'après la répartition du texte. */
function editPartsChain(doc: PoulpeDocument, headId: string): { nodes: TextNode[]; overflow: boolean } {
  const head = findNode(doc, headId)?.node;
  if (head?.type !== 'text' || !needsFlow(doc, head)) return { nodes: [], overflow: false };
  const page = findNode(doc, headId)!.artboard;
  const flow = cachedFlow(doc, headId, ui.get().editingTextId === headId ? null : pageFieldsOf(doc, page));
  return { nodes: flow.parts.map((p) => p.node), overflow: flow.overflow };
}
