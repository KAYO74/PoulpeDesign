import {
  Stabilizer,
  applyAdjustment,
  dodgeBurnPixels,
  findNode,
  floodMask,
  gaussianBlurred,
  healBlend,
  liquifyDab,
  luma,
  parseColor,
  similarDab,
  warpPerspective,
  type ImageNode,
  type Pixels,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import { compositeOp, setLiveBitmap } from '@poulpe/render';
import type { CanvasController } from '../canvas/controller';
import { t } from '../i18n';
import { compositeIn, nodesAboveOf } from '../tools/brushes/sample';
import { brushOptions } from '../tools/brushes/state';
import {
  brushSettings,
  editor,
  isBrushTool,
  setBrush,
  toast,
  ui,
  type BrushSettings,
  type SelectionMode,
  type ToolId,
} from '../store';
import { inpaintAsync } from './inpaintClient';
import { addMask } from './photoActions';
import {
  commitBitmap,
  copyDrawable,
  docToMask,
  localToDoc,
  docToPixels,
  imageAt,
  images,
  makeCanvas,
  maskSize,
  newPixelLayer,
  selectedImage,
} from './pixels';
import {
  QuickSelect,
  getSelection,
  selectShape,
  selectSimilar,
  selectionIn,
  selectionOutline,
} from './selection';

/*
 * Outils de la Persona Photo : sélections (rectangle, ellipse, lasso, baguette magique),
 * pinceau, gomme, pot de peinture, tampon de duplication, densité − et +, flou et netteté au
 * pinceau, gomme magique, lasso polygonal, sélection rapide, correcteur, doigt, fluidité,
 * redressement et correction de perspective.
 *
 * Un coup de pinceau travaille sur une copie des pixels du calque (ou de son masque) : la copie
 * est affichée à la place de l'image pendant le geste, puis enregistrée dans le document en une
 * seule étape d'historique au relâchement.
 */

const SELECT_TOOLS: ToolId[] = [
  'marqueeRect',
  'marqueeEllipse',
  'lasso',
  'polyLasso',
  'magicWand',
  'quickSelect',
];
/** Outils qui transforment le calque entier. */
const GEOMETRY_TOOLS: ToolId[] = ['straighten', 'perspective'];
/** Outils qui peignent une couleur : sans calque de pixels choisi, ils en créent un. */
const CREATES_LAYER: ToolId[] = ['brush', 'fill'];
/** Outils qui recopient une version transformée des pixels sous le pinceau. */
const SOURCE_TOOLS: ToolId[] = ['clone', 'heal', 'dodge', 'burn', 'blurBrush', 'sharpenBrush'];
/** Outils qui déplacent les pixels du calque eux-mêmes, touche après touche. */
const WARP_TOOLS: ToolId[] = ['smudge', 'liquify'];
/** Outils de la version 1.2 sans pinceau (voir tools/pixel), qui gèrent eux-mêmes leurs gestes. */
const PIXEL_V12_TOOLS: ToolId[] = ['crop', 'pixelGradient', 'floodEraser', 'patch'];

export function isPhotoTool(tool: ToolId): boolean {
  return (
    SELECT_TOOLS.includes(tool) ||
    isBrushTool(tool) ||
    tool === 'fill' ||
    GEOMETRY_TOOLS.includes(tool) ||
    PIXEL_V12_TOOLS.includes(tool)
  );
}

/** Retouche au pinceau ajoutée par un outil de la version 1.2 (voir tools/pixel). */
export interface BrushExtension {
  /** Libellé de l'historique. */
  history: string;
  /** Pixels déposés à la place de ceux du calque, transformés tuile par tuile (lu au début du geste). */
  source?: () => (px: Pixels, x0: number, y0: number) => void;
  /** Le pinceau efface (comme la gomme). */
  erase?: boolean;
  /** La touche ne couvre que les pixels proches de la couleur prélevée sous le centre du pinceau. */
  similar?: () => { tolerance: number; continuous: boolean; contiguous: boolean };
}

/** Cible d'un coup de pinceau hors calque : le masque rapide peint dans la sélection. */
export interface StrokeRedirect {
  /** Toile de départ (l'opacité est la valeur peinte) et passage du document à ses pixels. */
  base: HTMLCanvasElement;
  toPx: DOMMatrix;
  /** Aperçu pendant le geste (null à la fin), avec la zone qui vient de changer. */
  live(canvas: HTMLCanvasElement | null, dirty?: Rect): void;
  commit(canvas: HTMLCanvasElement): void;
}

/** Points d'entrée des outils de la version 1.2 dans les pinceaux de la Persona Photo. */
export const photoHooks: {
  brushes: Partial<Record<ToolId, BrushExtension>>;
  /** Le pinceau ou la gomme peint ailleurs que dans un calque (masque rapide). */
  redirect: ((tool: ToolId) => StrokeRedirect | null) | null;
  /** Les fourmis de la sélection sont cachées (masque rapide). */
  hideAnts: () => boolean;
} = { brushes: {}, redirect: null, hideAnts: () => false };

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Pixels d'origine transformés à la demande, par tuiles (densité, flou, netteté au pinceau). */
class LazySource {
  readonly canvas: HTMLCanvasElement;
  private done: Uint8Array;
  private cols: number;
  private static TILE = 256;
  constructor(
    private base: HTMLCanvasElement,
    private compute: (px: Pixels, x0: number, y0: number) => void,
    private margin: number,
  ) {
    this.canvas = makeCanvas(base.width, base.height);
    this.cols = Math.ceil(base.width / LazySource.TILE);
    this.done = new Uint8Array(this.cols * Math.ceil(base.height / LazySource.TILE));
  }

  ensure(r: Rect): void {
    const T = LazySource.TILE;
    const bctx = this.base.getContext('2d', { willReadFrequently: true })!;
    const sctx = this.canvas.getContext('2d')!;
    for (let ty = Math.floor(r.y0 / T); ty <= Math.floor((r.y1 - 1) / T); ty++)
      for (let tx = Math.floor(r.x0 / T); tx <= Math.floor((r.x1 - 1) / T); tx++) {
        const i = ty * this.cols + tx;
        if (tx < 0 || ty < 0 || tx >= this.cols || i >= this.done.length || this.done[i]) continue;
        this.done[i] = 1;
        const m = Math.ceil(this.margin);
        const x0 = Math.max(0, tx * T - m),
          y0 = Math.max(0, ty * T - m);
        const x1 = Math.min(this.base.width, (tx + 1) * T + m),
          y1 = Math.min(this.base.height, (ty + 1) * T + m);
        const img = bctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        this.compute({ data: img.data, width: img.width, height: img.height }, x0, y0);
        const ix = tx * T - x0,
          iy = ty * T - y0;
        sctx.putImageData(
          img,
          x0,
          y0,
          ix,
          iy,
          Math.min(T, this.base.width - tx * T),
          Math.min(T, this.base.height - ty * T),
        );
      }
  }
}

interface Stroke {
  tool: ToolId;
  nodeId: string;
  which: 'pixels' | 'mask';
  /** Image affichée à la place pendant le geste. */
  assetId: string;
  toPx: DOMMatrix;
  /** Pixels de la cible par pixel du document. */
  pxScale: number;
  base: HTMLCanvasElement;
  work: HTMLCanvasElement;
  /** Couverture accumulée du coup de pinceau. */
  buf: HTMLCanvasElement;
  /** Aperçu rouge de la gomme magique. */
  tint: HTMLCanvasElement | null;
  sel: HTMLCanvasElement | null;
  source: LazySource | HTMLCanvasElement | null;
  stamp: HTMLCanvasElement;
  settings: BrushSettings;
  /** Valeur peinte dans un masque, de 0 (cacher) à 1 (montrer). */
  maskValue: number;
  last: Vec;
  /** Distance restant à parcourir avant la prochaine touche. */
  carry: number;
  /** Le calque vient d'être créé pour ce coup de pinceau. */
  pending: boolean;
  /** Doigt : couleur emportée par le pinceau, à la taille de l'empreinte. */
  pickup: HTMLCanvasElement | null;
  /** Fluidité : position de la touche précédente (le geste pousse de l'une à l'autre). */
  prevDab: Vec | null;
  /** Le pinceau efface (gomme, gomme d'arrière-plan). */
  erase: boolean;
  /** Masque rapide : le geste peint dans la sélection. */
  redirect: StrokeRedirect | null;
  /** Couverture limitée aux pixels proches de la couleur prélevée dans `ref`. */
  similar: { tolerance: number; continuous: boolean; contiguous: boolean } | null;
  ref: HTMLCanvasElement;
  sample: { r: number; g: number; b: number; a: number } | null;
  /** Stabilisateur du tracé (positions du document), s'il est activé. */
  stab?: Stabilizer | null;
  /** Correcteur dont la source est faite des calques du dessous : il peint aussi hors des pixels existants. */
  sourceOver?: boolean;
}

function luminance(color: string): number {
  const c = parseColor(color);
  return luma(c.r, c.g, c.b) / 255;
}

/** Empreinte ronde du pinceau, au rayon donné, bord plus ou moins doux. */
function makeStamp(radius: number, hardness: number, color: string): HTMLCanvasElement {
  const r = Math.max(0.5, radius);
  const size = Math.ceil(r * 2) + 2;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, r);
  const h = Math.min(0.99, Math.max(0, hardness / 100));
  const col = parseColor(color);
  const rgba = (a: number) => `rgba(${col.r},${col.g},${col.b},${a})`;
  g.addColorStop(0, rgba(1));
  g.addColorStop(h, rgba(1));
  // Bord doux : décroissance en douceur (courbe en cloche approchée).
  g.addColorStop(h + (1 - h) * 0.5, rgba(0.5));
  g.addColorStop(1, rgba(0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export class PhotoTools {
  private stroke: Stroke | null = null;
  /** `origin` : point de départ du glisser ; Alt enfoncé au départ retire de la sélection (sinon : depuis le centre). */
  private marquee: {
    start: Vec;
    current: Vec;
    mode: SelectionMode;
    shape: 'rect' | 'ellipse';
    origin: Vec;
    altAtStart: boolean;
  } | null = null;
  private lasso: { points: Vec[]; mode: SelectionMode } | null = null;
  /** Lasso polygonal : sommets posés un par un ; `hover` suit le pointeur. */
  private poly: { points: Vec[]; mode: SelectionMode; hover: Vec; lastClick: number } | null = null;
  private quick: { session: QuickSelect; last: Vec } | null = null;
  private straight: { start: Vec; current: Vec } | null = null;
  /** Perspective : coins du quadrilatère (document) et coin en cours de déplacement. */
  private persp: { nodeId: string; quad: Vec[]; drag: number } | null = null;
  private pointer: Vec | null = null;
  private cloneSource: Vec | null = null;
  /** Décalage du tampon (source − destination, en pixels du document), gardé d'un coup à l'autre. */
  private cloneOffset: Vec | null = null;
  /** Dernier point du coup de pinceau précédent (document) : Maj + clic trace un trait droit depuis lui. */
  private lastStrokePoint: { nodeId: string; p: Vec } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unsub: () => void;
  private unsubOptions: () => void;
  private tmp = makeCanvas(64, 64);
  private tmp2 = makeCanvas(64, 64);

  constructor(private readonly c: CanvasController) {
    // Les fourmis de la sélection bougent : on redessine régulièrement tant qu'il y en a.
    this.unsub = ui.subscribe(() => this.updateTimer());
    // Un autre mode du lasso abandonne le polygone en cours (sinon il garderait le pointeur).
    this.unsubOptions = brushOptions.subscribe(() => {
      if (!this.poly || brushOptions.get().lassoMode === 'polygonal') return;
      this.poly = null;
      this.updateTimer();
      this.c.requestDraw();
    });
  }

  dispose(): void {
    this.unsub();
    this.unsubOptions();
    clearInterval(this.timer);
  }

  private updateTimer() {
    const need = ui.get().hasPixelSelection || !!this.lasso || !!this.poly || !!ui.get().busy;
    if (need && !this.timer) this.timer = setInterval(() => this.c.requestDraw(), 140);
    else if (!need && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get busy(): boolean {
    return !!(this.stroke || this.marquee || this.lasso || this.poly || this.quick || this.straight);
  }

  private mode(e: PointerEvent | MouseEvent): SelectionMode {
    if (e.shiftKey && e.altKey) return 'intersect';
    if (e.shiftKey) return 'add';
    if (e.altKey) return 'subtract';
    return ui.get().selectionMode;
  }

  // ————— Pointeur —————

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    const tool = ui.get().tool;
    if (!isPhotoTool(tool) || ui.get().persona !== 'photo') return false;
    this.pointer = s;
    this.altDown = e.altKey;
    if (ui.get().busy) return true;
    if (tool === 'marqueeRect' || tool === 'marqueeEllipse') {
      this.marquee = {
        start: p,
        current: p,
        mode: this.mode(e),
        shape: tool === 'marqueeRect' ? 'rect' : 'ellipse',
        origin: p,
        altAtStart: e.altKey,
      };
      return true;
    }
    if (tool === 'lasso' && brushOptions.get().lassoMode !== 'polygonal') {
      this.lasso = { points: [p], mode: this.mode(e) };
      this.updateTimer();
      return true;
    }
    if (tool === 'magicWand') {
      selectSimilar(p, images(), this.mode(e));
      return true;
    }
    // Lasso en mode polygonal (et l'ancien outil Lasso polygonal).
    if (tool === 'polyLasso' || tool === 'lasso') {
      this.polyClick(p, e);
      return true;
    }
    if (tool === 'quickSelect') {
      const session = QuickSelect.start(p, images(), this.mode(e));
      if (session) {
        this.quick = { session, last: p };
        session.dab(p, brushSettings(tool).size / 2);
        this.c.requestDraw();
      }
      return true;
    }
    if (tool === 'straighten') {
      this.straight = { start: p, current: p };
      return true;
    }
    if (tool === 'perspective') {
      this.perspDown(p);
      return true;
    }
    if ((tool === 'clone' || tool === 'heal') && e.altKey) {
      this.cloneSource = p;
      this.cloneOffset = null;
      toast(t('photo.cloneSourceSet'));
      return true;
    }
    if (tool === 'fill') {
      this.fillAt(p);
      return true;
    }
    if (!isBrushTool(tool)) return true;
    this.beginStroke(tool, p, e);
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    const tool = ui.get().tool;
    this.altDown = e.altKey;
    const active = isPhotoTool(tool) && ui.get().persona === 'photo';
    if (active || this.pointer) {
      this.pointer = active ? s : null;
      if (isBrushTool(tool)) this.c.requestDraw();
    }
    if (this.marquee) {
      const m = this.marquee;
      let dx = p.x - m.origin.x,
        dy = p.y - m.origin.y;
      if (e.shiftKey && m.mode !== 'add') {
        // Maj pendant le tracé : carré ou cercle.
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * d;
        dy = Math.sign(dy || 1) * d;
      }
      // Depuis le centre : option de la barre, ou Alt enfoncé pendant le tracé.
      const center = brushOptions.get().fromCenter || (e.altKey && !m.altAtStart);
      m.start = center ? { x: m.origin.x - dx, y: m.origin.y - dy } : m.origin;
      m.current = { x: m.origin.x + dx, y: m.origin.y + dy };
      this.c.requestDraw();
      return true;
    }
    if (this.poly) {
      this.poly.hover = p;
      this.c.requestDraw();
      return true;
    }
    if (this.quick) {
      const r = brushSettings('quickSelect').size / 2;
      const q = this.quick;
      const d = Math.hypot(p.x - q.last.x, p.y - q.last.y);
      if (d >= r * 0.5) {
        const steps = Math.ceil(d / (r * 0.75));
        for (let i = 1; i <= steps; i++)
          q.session.dab(
            { x: q.last.x + ((p.x - q.last.x) * i) / steps, y: q.last.y + ((p.y - q.last.y) * i) / steps },
            r,
          );
        q.last = p;
        this.c.requestDraw();
      }
      return true;
    }
    if (this.straight) {
      this.straight.current = p;
      this.c.requestDraw();
      return true;
    }
    if (this.persp && this.persp.drag >= 0) {
      this.persp.quad[this.persp.drag] = p;
      this.c.requestDraw();
      return true;
    }
    if (this.lasso) {
      const last = this.lasso.points[this.lasso.points.length - 1];
      const z = ui.get().view.zoom;
      if (Math.hypot(p.x - last.x, p.y - last.y) * z > 2) this.lasso.points.push(p);
      this.c.requestDraw();
      return true;
    }
    if (this.stroke && !this.stroke.pending) {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const rect = this.c.canvas.getBoundingClientRect();
      const pts = events.length
        ? events.map((ev) => ({
            p: this.c.toWorld(ev.clientX - rect.left, ev.clientY - rect.top),
            pressure: ev.pressure,
            pen: ev.pointerType === 'pen',
          }))
        : [{ p, pressure: e.pressure, pen: e.pointerType === 'pen' }];
      const stab = this.stroke.stab;
      for (const q of pts) {
        const pressure = q.pen ? q.pressure : 1;
        if (!stab) this.strokeTo(q.p, pressure);
        else for (const r of stab.push({ ...q.p, pressure })) this.strokeTo(r, r.pressure);
      }
      this.recompose();
      return true;
    }
    return false;
  }

  pointerUp(): boolean {
    if (this.quick) {
      this.quick.session.end();
      this.quick = null;
      this.c.requestDraw();
      return true;
    }
    if (this.straight) {
      const st = this.straight;
      this.straight = null;
      this.applyStraighten(st.start, st.current);
      this.c.requestDraw();
      return true;
    }
    if (this.persp && this.persp.drag >= 0) {
      this.persp.drag = -1;
      return true;
    }
    if (this.marquee) {
      const m = this.marquee;
      this.marquee = null;
      selectShape(m.shape, [m.start, m.current], m.mode, brushOptions.get().antialias);
      this.c.requestDraw();
      return true;
    }
    if (this.lasso) {
      const l = this.lasso;
      this.lasso = null;
      if (l.points.length > 2) selectShape('polygon', l.points, l.mode);
      else if (l.mode === 'replace') selectShape('rect', [l.points[0], l.points[0]], 'replace');
      this.updateTimer();
      this.c.requestDraw();
      return true;
    }
    if (this.stroke && !this.stroke.pending) {
      // La fenêtre du stabilisateur rattrape le pointeur.
      const rest = this.stroke.stab?.finish() ?? [];
      for (const r of rest) this.strokeTo(r, r.pressure);
      if (rest.length) this.recompose();
      void this.endStroke();
      return true;
    }
    return false;
  }

  pointerCancel(): void {
    this.marquee = null;
    this.lasso = null;
    this.straight = null;
    if (this.quick) {
      this.quick.session.end();
      this.quick = null;
    }
    if (this.stroke && !this.stroke.pending) {
      this.showLive(this.stroke, null);
      this.stroke = null;
    }
    this.c.requestDraw();
  }

  pointerLeave(): void {
    this.pointer = null;
    this.c.requestDraw();
  }

  /** Raccourcis de la Persona Photo : [ et ] changent la taille du pinceau, X échange les couleurs. */
  key(e: KeyboardEvent): boolean {
    if (ui.get().persona !== 'photo') return false;
    const tool = ui.get().tool;
    if ((e.key === '[' || e.key === ']') && isBrushTool(tool)) {
      const s = brushSettings(tool).size;
      const step = s < 10 ? 1 : s < 50 ? 5 : s < 200 ? 10 : 50;
      setBrush({ size: Math.max(1, Math.min(2000, e.key === ']' ? s + step : s - step)) });
      this.c.requestDraw();
      return true;
    }
    if (e.key === 'x' || e.key === 'X') {
      ui.set((s) => ({ brushColor: s.brushColor2, brushColor2: s.brushColor }));
      return true;
    }
    if (e.key === 'd' || e.key === 'D') {
      ui.set({ brushColor: '#000000', brushColor2: '#ffffff' });
      return true;
    }
    if (e.key === 'Escape' && (this.lasso || this.marquee || this.poly || this.straight)) {
      this.lasso = null;
      this.marquee = null;
      this.poly = null;
      this.straight = null;
      this.updateTimer();
      this.c.requestDraw();
      return true;
    }
    if (this.poly && e.key === 'Enter') {
      this.closePoly();
      return true;
    }
    if (this.poly && e.key === 'Backspace') {
      this.poly.points.pop();
      if (!this.poly.points.length) this.poly = null;
      this.updateTimer();
      this.c.requestDraw();
      return true;
    }
    if (this.persp && ui.get().perspectiveId && (e.key === 'Enter' || e.key === 'Escape')) {
      if (e.key === 'Enter') void this.applyPerspective();
      else this.cancelPerspective();
      return true;
    }
    if (tool === 'liquify' && ['1', '2', '3', '4'].includes(e.key)) {
      ui.set({ liquifyMode: (['push', 'twirl', 'bloat', 'pinch'] as const)[Number(e.key) - 1] });
      return true;
    }
    return false;
  }

  // ————— Lasso polygonal —————

  private polyClick(p: Vec, e: PointerEvent) {
    const now = performance.now();
    if (!this.poly) {
      this.poly = { points: [p], mode: this.mode(e), hover: p, lastClick: now };
      this.updateTimer();
      this.c.requestDraw();
      return;
    }
    const z = ui.get().view.zoom;
    const first = this.poly.points[0];
    const last = this.poly.points[this.poly.points.length - 1];
    // Double-clic, ou clic sur le premier point : on ferme.
    const nearFirst = this.poly.points.length > 2 && Math.hypot(p.x - first.x, p.y - first.y) * z < 8;
    const dbl = now - this.poly.lastClick < 350 && Math.hypot(p.x - last.x, p.y - last.y) * z < 6;
    if (nearFirst || dbl) {
      this.closePoly();
      return;
    }
    this.poly.points.push(p);
    this.poly.lastClick = now;
    this.c.requestDraw();
  }

  private closePoly() {
    const poly = this.poly;
    this.poly = null;
    if (poly && poly.points.length > 2) selectShape('polygon', poly.points, poly.mode);
    this.updateTimer();
    this.c.requestDraw();
  }

  // ————— Redressement —————

  /**
   * Fait pivoter le calque pour que la ligne tracée (un horizon, un mur) devienne horizontale ou
   * verticale. Avec « Remplir », le calque grandit juste assez pour que ses coins vides restent
   * hors de sa boîte d'origine.
   */
  private applyStraighten(a: Vec, b: Vec) {
    const z = ui.get().view.zoom;
    if (Math.hypot(b.x - a.x, b.y - a.y) * z < 6) return;
    const node = selectedImage() ?? imageAt(a);
    if (!node) {
      toast(t('photo.needPixelLayer'));
      return;
    }
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    // Ligne presque verticale : on la rend verticale.
    while (angle > 45) angle -= 90;
    while (angle < -45) angle += 90;
    if (Math.abs(angle) < 0.01) return;
    const fill = ui.get().straightenFill;
    editor.apply('history.straighten', (d) => {
      const n = findNode(d, node.id)?.node;
      if (!n) return;
      n.rotation = (((n.rotation - angle) % 360) + 360) % 360;
      if (fill) {
        const th = (Math.abs(angle) * Math.PI) / 180;
        const c = Math.cos(th),
          s2 = Math.sin(th);
        const w = n.width,
          h = n.height;
        const k = Math.max((w * c + h * s2) / w, (w * s2 + h * c) / h);
        const cx = n.x + w / 2,
          cy = n.y + h / 2;
        n.width = w * k;
        n.height = h * k;
        n.x = cx - n.width / 2;
        n.y = cy - n.height / 2;
      }
      return [n.id];
    });
  }

  // ————— Perspective —————

  private perspDown(p: Vec) {
    const z = ui.get().view.zoom;
    if (this.persp && ui.get().perspectiveId === this.persp.nodeId) {
      const i = this.persp.quad.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) * z < 10);
      if (i >= 0) {
        this.persp.drag = i;
        return;
      }
      return;
    }
    const node = selectedImage() ?? imageAt(p);
    if (!node) {
      toast(t('photo.needPixelLayer'));
      return;
    }
    editor.select([node.id]);
    const m = localToDoc(node);
    // Départ : un peu à l'intérieur des bords, pour que les poignées soient faciles à saisir.
    const ix = node.width * 0.1,
      iy = node.height * 0.1;
    const corners = [
      [ix, iy],
      [node.width - ix, iy],
      [node.width - ix, node.height - iy],
      [ix, node.height - iy],
    ].map(([x, y]) => {
      const q = m.transformPoint(new DOMPoint(x, y));
      return { x: q.x, y: q.y };
    });
    this.persp = { nodeId: node.id, quad: corners, drag: -1 };
    ui.set({ perspectiveId: node.id });
    this.c.requestDraw();
  }

  cancelPerspective(): void {
    this.persp = null;
    ui.set({ perspectiveId: null });
    this.c.requestDraw();
  }

  /** Le quadrilatère devient le calque entier (comme le recadrage en perspective de Photoshop). */
  async applyPerspective(): Promise<void> {
    const ps = this.persp;
    if (!ps) return;
    const node = findNode(editor.doc, ps.nodeId)?.node;
    this.cancelPerspective();
    if (node?.type !== 'image') return;
    const px = this.targetPixels(node, 'pixels');
    if (!px) return;
    const { base, toPx } = px;
    const quad = ps.quad.map((q) => {
      const r = toPx.transformPoint(new DOMPoint(q.x, q.y));
      return { x: r.x, y: r.y };
    });
    const ctx = base.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, base.width, base.height);
    const out = warpPerspective(
      { data: img.data, width: img.width, height: img.height },
      quad,
      base.width,
      base.height,
    );
    const canvas = makeCanvas(out.width, out.height);
    canvas
      .getContext('2d')!
      .putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height), 0, 0);
    commitBitmap(node.id, 'pixels', canvas, 'history.perspective');
  }

  // ————— Cible —————

  /**
   * Calque visé : l'image sélectionnée, ou celle sous le pointeur. Pour le pinceau et le pot de
   * peinture, un calque de pixels vide est créé s'il n'y en a pas.
   */
  private target(tool: ToolId, p: Vec): { node: SceneNode; which: 'pixels' | 'mask' } | null {
    const maskId = ui.get().maskEditId;
    if (maskId) {
      let n = findNode(editor.doc, maskId)?.node;
      if (n && n.visible && !n.locked && n.type !== 'group') {
        if (!n.mask) {
          addMask(n.id);
          n = findNode(editor.doc, maskId)?.node;
        }
        if (n) return { node: n, which: 'mask' };
      }
      ui.set({ maskEditId: null });
    }
    let node: ImageNode | null = selectedImage();
    if (!node && !CREATES_LAYER.includes(tool)) {
      node = imageAt(p);
      if (node) editor.select([node.id]);
    }
    if (!node && CREATES_LAYER.includes(tool)) {
      const id = newPixelLayer(p);
      const n = id ? findNode(editor.doc, id)?.node : null;
      if (n?.type === 'image') node = n;
    }
    if (!node) {
      toast(t('photo.needPixelLayer'));
      return null;
    }
    return { node, which: 'pixels' };
  }

  /** Pixels de départ de la cible, son repère et l'image à remplacer pendant le geste. */
  private targetPixels(node: SceneNode, which: 'pixels' | 'mask') {
    const doc = editor.doc;
    if (which === 'pixels' && node.type === 'image') {
      const img = images().get(doc, node.assetId);
      if (!img) return null;
      const base = copyDrawable(img);
      const toPx = docToPixels(node, base.width, base.height);
      return { base, toPx, assetId: node.assetId };
    }
    let base: HTMLCanvasElement;
    if (node.mask) {
      const img = images().get(doc, node.mask.assetId);
      if (!img) return null;
      base = copyDrawable(img);
    } else {
      // Pas encore de masque : on part d'un masque blanc (tout visible).
      const size = maskSize(node);
      base = makeCanvas(size.width, size.height);
      const ctx = base.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, base.width, base.height);
    }
    return {
      base,
      toPx: docToMask(node, base.width, base.height),
      assetId: node.mask?.assetId ?? `pending-mask-${node.id}`,
    };
  }

  // ————— Pinceaux —————

  private beginStroke(tool: ToolId, p: Vec, e: PointerEvent) {
    const ext = photoHooks.brushes[tool];
    // Masque rapide : le pinceau et la gomme peignent dans la sélection.
    const redirect = photoHooks.redirect?.(tool) ?? null;
    const target = redirect ? { node: null, which: 'mask' as const } : this.target(tool, p);
    if (!target) return;
    const { node, which } = target;
    const px = redirect
      ? { base: redirect.base, toPx: redirect.toPx, assetId: '' }
      : this.targetPixels(node!, which);
    if (!px) return;
    const settings = brushSettings(tool);
    const { base, toPx, assetId } = px;
    const pxScale = Math.sqrt(Math.abs(toPx.a * toPx.d - toPx.b * toPx.c)) || 1;
    const w = base.width,
      h = base.height;
    const work = copyDrawable(base);
    const buf = makeCanvas(w, h);
    const sel = redirect ? null : selectionIn(w, h, toPx);
    const color = ui.get().brushColor;
    const erase = tool === 'eraser' || !!ext?.erase;
    const maskValue = erase ? 0 : luminance(color);
    const radius = (settings.size / 2) * pxScale;
    const stampColor = which === 'pixels' && tool === 'brush' ? color : '#ffffff';
    const stamp = makeStamp(radius, tool === 'magicEraser' ? 100 : settings.hardness, stampColor);

    let source: Stroke['source'] = null;
    let sourceOver = false;
    if (which === 'pixels' && ext?.source) source = new LazySource(base, ext.source(), 0);
    else if (which === 'pixels' && SOURCE_TOOLS.includes(tool)) {
      if (tool === 'clone' || tool === 'heal') {
        if (!this.cloneSource) {
          toast(t('photo.cloneNeedSource'));
          return;
        }
        const o = brushOptions.get();
        // Aligné : le décalage est gardé d'un coup à l'autre ; sinon chaque coup repart de la source.
        if (!this.cloneOffset || !o.aligned)
          this.cloneOffset = { x: this.cloneSource.x - p.x, y: this.cloneSource.y - p.y };
        // Pixels recopiés : ceux du calque, ou ce qui est visible sous lui (avec ou sans lui).
        const below = o.cloneSource !== 'layer';
        const from = below
          ? compositeIn(node, w, h, toPx, nodesAboveOf(node.id, o.cloneSource === 'layerBelow'))
          : base;
        const s = makeCanvas(w, h);
        const sc = s.getContext('2d')!;
        sc.setTransform(this.cloneMatrix(toPx, tool === 'clone'));
        sc.drawImage(from, 0, 0);
        source = s;
        if (tool === 'heal') {
          // Correcteur : la texture de la source prend la lumière et les couleurs de la destination.
          const sigma = Math.max(2, (settings.size / 2) * pxScale * 0.5);
          const sctx = s.getContext('2d', { willReadFrequently: true })!;
          source = new LazySource(
            from,
            (q, x0, y0) => {
              const src = sctx.getImageData(x0, y0, q.width, q.height);
              q.data.set(healBlend(q, { data: src.data, width: q.width, height: q.height }, sigma));
            },
            sigma * 3,
          );
          sourceOver = below;
        }
      } else if (tool === 'dodge' || tool === 'burn') {
        // Plage de tons (ombres, tons moyens, hautes lumières) et protection de la teinte.
        const { toneRange, protectHue } = brushOptions.get();
        const amount = tool === 'dodge' ? 1 : -1;
        source = new LazySource(base, (q) => dodgeBurnPixels(q, amount, toneRange, protectHue), 0);
      } else if (tool === 'blurBrush') {
        const sigma = 3 * pxScale;
        source = new LazySource(base, (q) => q.data.set(gaussianBlurred(q, sigma)), sigma * 3);
      } else {
        source = new LazySource(
          base,
          (q) =>
            applyAdjustment(
              q,
              { kind: 'unsharpMask', amount: 150, radius: 1.5, threshold: 0 },
              { scale: pxScale },
            ),
          6 * pxScale,
        );
      }
    } else if (SOURCE_TOOLS.includes(tool)) {
      // Sur un masque, ces outils n'ont pas de sens : on peint simplement.
    }

    const similar = ext?.similar && !redirect && (which === 'pixels' || erase) ? ext.similar() : null;
    // Sur un masque, la couleur est prélevée dans les pixels du calque.
    const ref =
      similar && which === 'mask' && node?.type === 'image'
        ? (this.pixelsInMask(node, w, h, toPx) ?? base)
        : base;
    // Maj + clic : trait droit depuis la fin du coup précédent sur le même calque.
    const prev =
      e.shiftKey && this.lastStrokePoint?.nodeId === (node?.id ?? '') ? this.lastStrokePoint.p : null;
    const first = prev ?? p;
    const start = toPx.transformPoint(new DOMPoint(first.x, first.y));
    // Stabilisateur : la longueur de la corde est en pixels d'écran.
    const opts = brushOptions.get();
    const stab = opts.stabilizer
      ? new Stabilizer(
          opts.stabilizerMode,
          opts.stabilizerMode === 'rope' ? opts.ropeLength / ui.get().view.zoom : opts.windowSize,
        )
      : null;
    this.stroke = {
      tool,
      nodeId: node?.id ?? '',
      which,
      assetId,
      toPx,
      pxScale,
      base,
      work,
      buf,
      tint: tool === 'magicEraser' ? makeCanvas(w, h) : null,
      sel,
      source,
      stamp,
      settings,
      maskValue,
      last: { x: start.x, y: start.y },
      carry: 0,
      pending: false,
      pickup: null,
      prevDab: null,
      erase,
      redirect,
      similar,
      ref,
      sample: null,
      stab,
      sourceOver,
    };
    if (tool !== 'magicEraser') this.showLive(this.stroke, work);
    const pressure = e.pointerType === 'pen' ? e.pressure : 1;
    this.dab(start.x, start.y, pressure);
    if (prev) this.strokeTo(p, pressure);
    stab?.start({ ...p, pressure });
    this.recompose();
  }

  /**
   * Tampon et correcteur : passe des pixels de la source à ceux de la destination (pixels du
   * calque). Le point source choisi correspond au point de destination du décalage ; le tampon
   * peut tourner et mettre à l'échelle ce qu'il recopie autour de ce point.
   */
  private cloneMatrix(toPx: DOMMatrix, transform: boolean): DOMMatrix {
    const src = this.cloneSource!,
      off = this.cloneOffset!;
    const { cloneRotation, cloneScale } = brushOptions.get();
    const k = transform ? Math.max(0.01, cloneScale / 100) : 1;
    return toPx
      .multiply(
        new DOMMatrix()
          .translate(src.x - off.x, src.y - off.y)
          .rotate(transform ? cloneRotation : 0)
          .scale(k)
          .translate(-src.x, -src.y),
      )
      .multiply(toPx.inverse());
  }

  /** Point source du tampon qui correspond à un point de destination (document). */
  private cloneSourceAt(d: Vec): Vec {
    const src = this.cloneSource!,
      off = this.cloneOffset!;
    if (ui.get().tool !== 'clone') return { x: d.x + off.x, y: d.y + off.y };
    const { cloneRotation, cloneScale } = brushOptions.get();
    const m = new DOMMatrix()
      .translate(src.x - off.x, src.y - off.y)
      .rotate(cloneRotation)
      .scale(Math.max(0.01, cloneScale / 100))
      .translate(-src.x, -src.y)
      .inverse();
    const q = m.transformPoint(new DOMPoint(d.x, d.y));
    return { x: q.x, y: q.y };
  }

  private dirty: Rect | null = null;

  private dab(x: number, y: number, pressure: number) {
    const s = this.stroke!;
    if (s.tool === 'smudge') return this.smudgeDab(x, y);
    if (s.tool === 'liquify') return this.liquifyDab(x, y);
    if (s.similar) return this.similarDab(x, y, pressure);
    const r = (s.settings.size / 2) * s.pxScale * Math.max(0.05, pressure);
    const ctx = s.buf.getContext('2d')!;
    ctx.globalAlpha = s.tool === 'magicEraser' ? 1 : Math.max(0.01, s.settings.flow / 100);
    const k = r / ((s.stamp.width - 2) / 2);
    const size = s.stamp.width * k;
    ctx.drawImage(s.stamp, x - size / 2, y - size / 2, size, size);
    const pad = size / 2 + 2;
    const d = this.dirty;
    const rect = { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad };
    this.dirty = d
      ? {
          x0: Math.min(d.x0, rect.x0),
          y0: Math.min(d.y0, rect.y0),
          x1: Math.max(d.x1, rect.x1),
          y1: Math.max(d.y1, rect.y1),
        }
      : rect;
  }

  /** Doigt : la couleur emportée est déposée, puis se mélange à ce qui est sous le pinceau. */
  private smudgeDab(x: number, y: number) {
    const s = this.stroke!;
    const r = (s.settings.size / 2) * s.pxScale;
    const k = r / ((s.stamp.width - 2) / 2);
    const size = Math.max(2, Math.ceil(s.stamp.width * k));
    const ox = Math.round(x - size / 2),
      oy = Math.round(y - size / 2);
    const wc = s.work.getContext('2d')!;
    if (!s.pickup) {
      s.pickup = makeCanvas(size, size);
      s.pickup.getContext('2d')!.drawImage(s.work, ox, oy, size, size, 0, 0, size, size);
      return;
    }
    const strength = Math.max(0, Math.min(1, s.settings.opacity / 100));
    // Empreinte : la couleur emportée, découpée par le pinceau (et par la sélection).
    const t1 = this.scratch(size, size, 1);
    const tc = t1.getContext('2d')!;
    tc.save();
    tc.globalCompositeOperation = 'copy';
    tc.drawImage(s.pickup, 0, 0);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(s.stamp, 0, 0, s.stamp.width, s.stamp.height, 0, 0, size, size);
    if (s.sel) tc.drawImage(s.sel, ox, oy, size, size, 0, 0, size, size);
    tc.restore();
    wc.save();
    wc.globalAlpha = strength;
    wc.globalCompositeOperation = 'source-atop';
    wc.drawImage(t1, 0, 0, size, size, ox, oy, size, size);
    wc.restore();
    // Le pinceau reprend un peu de la couleur qu'il traverse.
    const pc = s.pickup.getContext('2d')!;
    pc.globalAlpha = 1 - strength;
    pc.drawImage(s.work, ox, oy, size, size, 0, 0, size, size);
    pc.globalAlpha = 1;
    this.dirty = { x0: ox, y0: oy, x1: ox + size, y1: oy + size };
  }

  /** Fluidité : déplace les pixels sous le pinceau. */
  private liquifyDab(x: number, y: number) {
    const s = this.stroke!;
    const r = (s.settings.size / 2) * s.pxScale;
    const prev = s.prevDab ?? s.last;
    const dx = x - prev.x,
      dy = y - prev.y;
    s.prevDab = { x, y };
    const mode = ui.get().liquifyMode;
    if (mode === 'push' && Math.hypot(dx, dy) < 0.01) return;
    const strength = Math.max(0.02, s.settings.opacity / 100);
    const m = Math.ceil(r + Math.hypot(dx, dy) + 2);
    const x0 = Math.max(0, Math.floor(x - m)),
      y0 = Math.max(0, Math.floor(y - m));
    const x1 = Math.min(s.work.width, Math.ceil(x + m)),
      y1 = Math.min(s.work.height, Math.ceil(y + m));
    if (x1 <= x0 || y1 <= y0) return;
    const wc = s.work.getContext('2d', { willReadFrequently: true })!;
    const img = wc.getImageData(x0, y0, x1 - x0, y1 - y0);
    const alt = this.altDown;
    const effective = alt && mode === 'bloat' ? 'pinch' : alt && mode === 'pinch' ? 'bloat' : mode;
    liquifyDab(
      { data: img.data, width: img.width, height: img.height },
      x - x0,
      y - y0,
      r,
      effective,
      mode === 'twirl' && alt ? -strength : strength,
      dx,
      dy,
    );
    wc.putImageData(img, x0, y0);
    this.dirty = { x0, y0, x1, y1 };
  }

  private altDown = false;

  /** Gomme d'arrière-plan, remplacement de couleur : la touche ne couvre que les pixels proches de la couleur prélevée. */
  private similarDab(x: number, y: number, pressure: number) {
    const s = this.stroke!;
    const sim = s.similar!;
    const r = (s.settings.size / 2) * s.pxScale * Math.max(0.05, pressure);
    const x0 = Math.max(0, Math.floor(x - r)),
      y0 = Math.max(0, Math.floor(y - r));
    const x1 = Math.min(s.ref.width, Math.ceil(x + r)),
      y1 = Math.min(s.ref.height, Math.ceil(y + r));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0,
      h = y1 - y0;
    const img = s.ref.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h);
    const d = img.data;
    if (!s.sample || sim.continuous) {
      // Couleur sous le centre du pinceau (moyenne de 3 × 3 pixels, moins sensible au bruit).
      let n = 0;
      const acc = [0, 0, 0, 0];
      for (let yy = Math.floor(y) - 1; yy <= Math.floor(y) + 1; yy++)
        for (let xx = Math.floor(x) - 1; xx <= Math.floor(x) + 1; xx++) {
          if (xx < x0 || yy < y0 || xx >= x1 || yy >= y1) continue;
          const p = ((yy - y0) * w + (xx - x0)) * 4;
          for (let c = 0; c < 4; c++) acc[c] += d[p + c];
          n++;
        }
      if (n) s.sample = { r: acc[0] / n, g: acc[1] / n, b: acc[2] / n, a: acc[3] / n };
    }
    if (!s.sample) return;
    const cov = similarDab(
      { data: d, width: w, height: h },
      x - x0,
      y - y0,
      r,
      s.settings.hardness,
      s.sample,
      sim.tolerance,
      sim.contiguous,
    );
    const out = new ImageData(w, h);
    for (let i = 0; i < cov.length; i++) {
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
      out.data[i * 4 + 3] = cov[i];
    }
    const t1 = this.scratch(w, h, 1);
    t1.getContext('2d')!.putImageData(out, 0, 0);
    const ctx = s.buf.getContext('2d')!;
    ctx.globalAlpha = Math.max(0.01, s.settings.flow / 100);
    ctx.drawImage(t1, 0, 0, w, h, x0, y0, w, h);
    const dd = this.dirty;
    this.dirty = dd
      ? { x0: Math.min(dd.x0, x0), y0: Math.min(dd.y0, y0), x1: Math.max(dd.x1, x1), y1: Math.max(dd.y1, y1) }
      : { x0, y0, x1, y1 };
  }

  /** Pixels du calque redessinés dans le repère de son masque (couleur prélevée en peignant le masque). */
  private pixelsInMask(node: ImageNode, w: number, h: number, toMask: DOMMatrix): HTMLCanvasElement | null {
    const img = images().get(editor.doc, node.assetId);
    if (!img) return null;
    const src = copyDrawable(img);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.setTransform(toMask.multiply(docToPixels(node, src.width, src.height).inverse()));
    ctx.drawImage(src, 0, 0);
    return c;
  }

  /** Aperçu du coup de pinceau : à la place de l'image du calque, ou chez la cible redirigée. */
  private showLive(s: Stroke, canvas: HTMLCanvasElement | null, dirty?: Rect) {
    if (s.redirect) s.redirect.live(canvas, dirty);
    else setLiveBitmap(s.assetId, canvas);
  }

  private strokeTo(p: Vec, pressure: number) {
    const s = this.stroke!;
    const q = s.toPx.transformPoint(new DOMPoint(p.x, p.y));
    const dx = q.x - s.last.x,
      dy = q.y - s.last.y;
    const dist = Math.hypot(dx, dy);
    const k = s.tool === 'smudge' ? 0.05 : s.tool === 'liquify' ? 0.08 : 0.1;
    const spacing = Math.max(0.75, s.settings.size * s.pxScale * k);
    let tpos = spacing - s.carry;
    const from = s.last;
    while (tpos <= dist) {
      const f = tpos / dist;
      const pt = { x: from.x + dx * f, y: from.y + dy * f };
      this.dab(pt.x, pt.y, pressure);
      tpos += spacing;
    }
    s.carry = dist - (tpos - spacing);
    s.last = { x: q.x, y: q.y };
  }

  private scratch(w: number, h: number, which: 1 | 2): HTMLCanvasElement {
    const c = which === 1 ? this.tmp : this.tmp2;
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w);
      c.height = Math.max(c.height, h);
    }
    return c;
  }

  /** Recompose la zone touchée : pixels d'origine + coup de pinceau, limité à la sélection. */
  private recompose() {
    const s = this.stroke;
    const d = this.dirty;
    this.dirty = null;
    if (!s || !d) return;
    const W = s.base.width,
      H = s.base.height;
    const x0 = Math.max(0, Math.floor(d.x0)),
      y0 = Math.max(0, Math.floor(d.y0));
    const x1 = Math.min(W, Math.ceil(d.x1)),
      y1 = Math.min(H, Math.ceil(d.y1));
    const w = x1 - x0,
      h = y1 - y0;
    if (w <= 0 || h <= 0) return;

    if (WARP_TOOLS.includes(s.tool)) {
      // Doigt et fluidité modifient directement la copie de travail.
      setLiveBitmap(s.assetId, s.work);
      this.c.requestDraw();
      return;
    }

    if (s.tool === 'magicEraser') {
      // La gomme magique ne touche pas encore aux pixels : on montre la zone en rouge.
      const tc = s.tint!.getContext('2d')!;
      // « source-in » touche toute la toile : on le limite à la zone pour garder le reste du trait.
      tc.save();
      tc.beginPath();
      tc.rect(x0, y0, w, h);
      tc.clip();
      tc.clearRect(x0, y0, w, h);
      tc.drawImage(s.buf, x0, y0, w, h, x0, y0, w, h);
      tc.globalCompositeOperation = 'source-in';
      tc.fillStyle = 'rgba(255, 60, 90, 0.55)';
      tc.fillRect(x0, y0, w, h);
      tc.restore();
      this.c.requestDraw();
      return;
    }

    // Couverture du coup de pinceau dans la zone, limitée à la sélection.
    const cov = this.scratch(w, h, 1);
    const cc = cov.getContext('2d')!;
    cc.globalCompositeOperation = 'copy';
    cc.drawImage(s.buf, x0, y0, w, h, 0, 0, w, h);
    if (s.sel) {
      cc.globalCompositeOperation = 'destination-in';
      cc.drawImage(s.sel, x0, y0, w, h, 0, 0, w, h);
    }
    cc.globalCompositeOperation = 'source-over';

    const wc = s.work.getContext('2d')!;
    wc.save();
    // (« copy » effacerait toute la toile hors de la zone : on vide seulement la zone.)
    wc.clearRect(x0, y0, w, h);
    wc.drawImage(s.base, x0, y0, w, h, x0, y0, w, h);
    const opacity = Math.max(0, Math.min(1, s.settings.opacity / 100));
    if (s.which === 'mask') {
      // Masque : on va vers la valeur peinte (blanc = visible, noir = caché).
      wc.globalAlpha = opacity;
      wc.globalCompositeOperation = 'destination-out';
      wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
      if (s.maskValue > 0) {
        wc.globalAlpha = opacity * s.maskValue;
        wc.globalCompositeOperation = 'lighter';
        wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
      }
    } else if (s.erase) {
      wc.globalAlpha = opacity;
      wc.globalCompositeOperation = 'destination-out';
      wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
    } else if (s.source) {
      const src =
        s.source instanceof LazySource ? (s.source.ensure({ x0, y0, x1, y1 }), s.source.canvas) : s.source;
      const t2 = this.scratch(w, h, 2);
      const tc = t2.getContext('2d')!;
      tc.globalCompositeOperation = 'copy';
      tc.drawImage(src, x0, y0, w, h, 0, 0, w, h);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(cov, 0, 0, w, h, 0, 0, w, h);
      tc.globalCompositeOperation = 'source-over';
      wc.globalAlpha = opacity;
      // Les retouches ne changent pas l'opacité du calque.
      wc.globalCompositeOperation = s.tool === 'clone' || s.sourceOver ? 'source-over' : 'source-atop';
      wc.drawImage(t2, 0, 0, w, h, x0, y0, w, h);
    } else if (
      s.tool === 'brush' &&
      (brushOptions.get().blend !== 'normal' || brushOptions.get().protectAlpha)
    ) {
      // Pinceau : mode de fusion, et « Protéger l'alpha » (seulement là où il y a déjà des pixels).
      const { blend, protectAlpha } = brushOptions.get();
      if (protectAlpha && blend !== 'normal') {
        const t2 = this.scratch(w, h, 2);
        const tc = t2.getContext('2d')!;
        tc.globalCompositeOperation = 'copy';
        tc.drawImage(s.base, x0, y0, w, h, 0, 0, w, h);
        tc.globalCompositeOperation = compositeOp(blend);
        tc.globalAlpha = opacity;
        tc.drawImage(cov, 0, 0, w, h, 0, 0, w, h);
        tc.globalAlpha = 1;
        tc.globalCompositeOperation = 'source-over';
        wc.globalCompositeOperation = 'source-atop';
        wc.drawImage(t2, 0, 0, w, h, x0, y0, w, h);
      } else {
        wc.globalAlpha = opacity;
        wc.globalCompositeOperation = protectAlpha ? 'source-atop' : compositeOp(blend);
        wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
      }
    } else {
      wc.globalAlpha = opacity;
      wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
    }
    wc.restore();
    this.showLive(s, s.work, { x0, y0, x1, y1 });
    this.c.requestDraw();
  }

  private async endStroke() {
    const s = this.stroke!;
    if (s.tool === 'magicEraser') {
      s.pending = true;
      try {
        await this.runInpaint(s.nodeId, s.base, s.buf, 16);
      } finally {
        this.stroke = null;
        this.c.requestDraw();
      }
      return;
    }
    this.stroke = null;
    const end = s.toPx.inverse().transformPoint(new DOMPoint(s.last.x, s.last.y));
    this.lastStrokePoint = { nodeId: s.nodeId, p: { x: end.x, y: end.y } };
    if (s.redirect) {
      s.redirect.commit(s.work);
      s.redirect.live(null);
      return;
    }
    const labels: Partial<Record<ToolId, string>> = {
      brush: 'history.brush',
      eraser: 'history.erase',
      clone: 'history.clone',
      heal: 'history.heal',
      smudge: 'history.smudge',
      liquify: 'history.liquify',
      dodge: 'history.dodge',
      burn: 'history.burn',
      blurBrush: 'history.blurBrush',
      sharpenBrush: 'history.sharpenBrush',
    };
    commitBitmap(
      s.nodeId,
      s.which,
      s.work,
      s.which === 'mask'
        ? 'history.maskPaint'
        : (labels[s.tool] ?? photoHooks.brushes[s.tool]?.history ?? 'history.brush'),
    );
    setLiveBitmap(s.assetId, null);
  }

  /**
   * Reconstruit la zone couverte par `cover` (opacité > `threshold`) dans les pixels `base` du
   * calque, puis enregistre le résultat. Sert à la gomme magique et au remplissage d'après le
   * contenu.
   */
  async runInpaint(
    nodeId: string,
    base: HTMLCanvasElement,
    cover: HTMLCanvasElement,
    threshold: number,
  ): Promise<void> {
    const W = base.width,
      H = base.height;
    const cd = cover.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    let x0 = W,
      y0 = H,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (cd[(y * W + x) * 4 + 3] > threshold) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return;
    // Zone de travail : le trou et ce qui l'entoure, où l'on va chercher de quoi le remplir.
    const m = Math.max(32, Math.round(Math.max(x1 - x0, y1 - y0) * 0.9));
    const rx = Math.max(0, x0 - m),
      ry = Math.max(0, y0 - m);
    const rw = Math.min(W, x1 + m + 1) - rx,
      rh = Math.min(H, y1 + m + 1) - ry;
    const img = base.getContext('2d', { willReadFrequently: true })!.getImageData(rx, ry, rw, rh);
    const hole = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        // Le trou est élargi d'un pixel pour ne pas laisser de liseré.
        let on = false;
        for (let dy = -1; dy <= 1 && !on; dy++)
          for (let dx = -1; dx <= 1 && !on; dx++) {
            const gx = rx + x + dx,
              gy = ry + y + dy;
            if (gx >= 0 && gy >= 0 && gx < W && gy < H && cd[(gy * W + gx) * 4 + 3] > threshold) on = true;
          }
        if (on) hole[y * rw + x] = 1;
      }
    ui.set({ busy: { label: t('photo.inpainting'), progress: 0 } });
    try {
      const data = await inpaintAsync(img.data, rw, rh, hole, (f) =>
        ui.set({ busy: { label: t('photo.inpainting'), progress: f } }),
      );
      const out = copyDrawable(base);
      out.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), rw, rh), rx, ry);
      if (findNode(editor.doc, nodeId)) commitBitmap(nodeId, 'pixels', out, 'history.magicEraser');
    } catch {
      toast(t('photo.inpaintFailed'));
    } finally {
      ui.set({ busy: null });
    }
  }

  // ————— Pot de peinture —————

  private fillAt(p: Vec) {
    const target = this.target('fill', p);
    if (!target) return;
    const px = this.targetPixels(target.node, target.which);
    if (!px) return;
    const { base, toPx } = px;
    const W = base.width,
      H = base.height;
    const q = toPx.transformPoint(new DOMPoint(p.x, p.y));
    if (q.x < 0 || q.y < 0 || q.x >= W || q.y >= H) return;
    const ctx = base.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, W, H);
    // Couleurs comparées : celles du calque, ou tout ce qui est visible (option Source).
    const { fillSource, fillBlend } = brushOptions.get();
    const all = fillSource === 'all' && target.which === 'pixels';
    const ref = all
      ? compositeIn(target.node, W, H, toPx)
          .getContext('2d', { willReadFrequently: true })!
          .getImageData(0, 0, W, H)
      : img;
    const mask = floodMask(
      { data: ref.data, width: W, height: H },
      q.x,
      q.y,
      ui.get().tolerance,
      ui.get().contiguous,
    );
    const sel = selectionIn(W, H, toPx);
    const sd = sel?.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const op = brushSettings('brush').opacity / 100;
    const col = parseColor(ui.get().brushColor);
    const d = img.data;
    const value = luminance(ui.get().brushColor) * 255;
    // Mode de fusion : la couleur est posée par le navigateur, à travers le masque du remplissage.
    const blended = target.which === 'pixels' && fillBlend !== 'normal' ? new ImageData(W, H) : null;
    for (let i = 0; i < mask.length; i++) {
      let k = (mask[i] / 255) * op;
      if (sd) k *= sd[i * 4 + 3] / 255;
      if (k <= 0) continue;
      const j = i * 4;
      if (blended) {
        blended.data[j] = col.r;
        blended.data[j + 1] = col.g;
        blended.data[j + 2] = col.b;
        blended.data[j + 3] = k * 255;
        continue;
      }
      if (target.which === 'mask') {
        d[j + 3] = d[j + 3] + (value - d[j + 3]) * k;
        d[j] = d[j + 1] = d[j + 2] = 255;
        continue;
      }
      // Couleur posée par-dessus (fusion normale).
      const a = d[j + 3] / 255;
      const outA = k + a * (1 - k);
      if (outA <= 0) continue;
      d[j] = (col.r * k + d[j] * a * (1 - k)) / outA;
      d[j + 1] = (col.g * k + d[j + 1] * a * (1 - k)) / outA;
      d[j + 2] = (col.b * k + d[j + 2] * a * (1 - k)) / outA;
      d[j + 3] = outA * 255;
    }
    const out = makeCanvas(W, H);
    const octx = out.getContext('2d')!;
    octx.putImageData(img, 0, 0);
    if (blended) {
      const paint = makeCanvas(W, H);
      paint.getContext('2d')!.putImageData(blended, 0, 0);
      octx.globalCompositeOperation = compositeOp(fillBlend);
      octx.drawImage(paint, 0, 0);
    }
    commitBitmap(
      target.node.id,
      target.which,
      out,
      target.which === 'mask' ? 'history.maskPaint' : 'history.fill',
    );
  }

  // ————— Dessin —————

  /** Dessine les aides de la Persona Photo, en pixels d'écran. */
  draw(ctx: CanvasRenderingContext2D): void {
    const view = ui.get().view;
    const toScreen = (p: Vec) => this.c.toScreen(p);
    // Aperçu rouge de la gomme magique, posé sur le calque.
    const s = this.stroke;
    if (s?.tint) {
      ctx.save();
      const dpr = ctx.getTransform().a;
      const screen = new DOMMatrix([
        dpr * view.zoom,
        0,
        0,
        dpr * view.zoom,
        dpr * view.panX,
        dpr * view.panY,
      ]);
      ctx.setTransform(screen.multiply(s.toPx.inverse()));
      ctx.drawImage(s.tint, 0, 0);
      ctx.restore();
    }
    // Fourmis de la sélection.
    const outline = photoHooks.hideAnts() ? null : selectionOutline();
    if (outline) {
      const offset = (Date.now() / 60) % 8;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const line of outline.lines) {
        for (let i = 0; i < line.length; i += 2) {
          const sp = toScreen(outline.toDoc(line[i], line[i + 1]));
          if (i === 0) ctx.moveTo(Math.round(sp.x) + 0.5, Math.round(sp.y) + 0.5);
          else ctx.lineTo(Math.round(sp.x) + 0.5, Math.round(sp.y) + 0.5);
        }
      }
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.strokeStyle = '#000000';
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -offset;
      ctx.stroke();
      ctx.restore();
    }
    const dashed = (draw: () => void) => {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffffff';
      draw();
      ctx.stroke();
      ctx.strokeStyle = '#000000';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    };
    if (this.marquee) {
      const a = toScreen(this.marquee.start),
        b = toScreen(this.marquee.current);
      const x = Math.min(a.x, b.x),
        y = Math.min(a.y, b.y),
        w = Math.abs(b.x - a.x),
        h = Math.abs(b.y - a.y);
      dashed(() => {
        ctx.beginPath();
        if (this.marquee!.shape === 'rect') ctx.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, w, h);
        else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      });
    }
    if (this.lasso && this.lasso.points.length > 1) {
      const pts = this.lasso.points.map(toScreen);
      dashed(() => {
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      });
    }
    if (this.poly) {
      const pts = [...this.poly.points, this.poly.hover].map(toScreen);
      dashed(() => {
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      });
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      for (const q of pts.slice(0, -1)) {
        ctx.beginPath();
        ctx.rect(q.x - 2.5, q.y - 2.5, 5, 5);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    if (this.straight) {
      const a = toScreen(this.straight.start),
        b = toScreen(this.straight.current);
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffd400';
      ctx.stroke();
      ctx.restore();
    }
    if (this.persp && ui.get().perspectiveId === this.persp.nodeId && ui.get().tool === 'perspective') {
      const q = this.persp.quad.map(toScreen);
      ctx.save();
      // Quadrillage 3 × 3 pour aligner les bords de l'objet à redresser.
      ctx.strokeStyle = 'rgba(255, 212, 0, 0.6)';
      ctx.lineWidth = 1;
      const lerp = (a: Vec, b: Vec, k: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      ctx.beginPath();
      for (const k of [1 / 3, 2 / 3]) {
        const a = lerp(q[0], q[1], k),
          b = lerp(q[3], q[2], k);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        const c = lerp(q[0], q[3], k),
          d = lerp(q[1], q[2], k);
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
      }
      ctx.stroke();
      ctx.strokeStyle = '#ffd400';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1a1a1d';
      for (const p of q) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    // Source du tampon.
    const tool = ui.get().tool;
    if ((tool === 'clone' || tool === 'heal') && this.cloneSource && ui.get().persona === 'photo') {
      let src = this.cloneSource;
      // Non aligné : le prochain coup repartira du point source.
      if (this.cloneOffset && this.pointer && (brushOptions.get().aligned || this.stroke))
        src = this.cloneSourceAt(this.c.toWorld(this.pointer.x, this.pointer.y));
      const q = toScreen(src);
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(q.x - 8, q.y);
      ctx.lineTo(q.x + 8, q.y);
      ctx.moveTo(q.x, q.y - 8);
      ctx.lineTo(q.x, q.y + 8);
      ctx.stroke();
      ctx.restore();
    }
    // Stabilisateur en mode corde : la corde tendue entre le pinceau et le pointeur.
    if (this.pointer && s?.stab?.mode === 'rope') {
      const b0 = s.toPx.inverse().transformPoint(new DOMPoint(s.last.x, s.last.y));
      const b = toScreen({ x: b0.x, y: b0.y });
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(this.pointer.x, this.pointer.y);
      ctx.stroke();
      ctx.restore();
    }
    // Contour du pinceau sous le pointeur.
    if (this.pointer && isBrushTool(tool) && ui.get().persona === 'photo') {
      const r = (brushSettings(tool).size / 2) * view.zoom;
      const { x, y } = this.pointer;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, r - 1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Remplissage d'après le contenu : reconstruit la sélection dans le calque choisi. */
  async contentAwareFill(): Promise<void> {
    const node = selectedImage();
    if (!node || !getSelection()) return;
    const px = this.targetPixels(node, 'pixels');
    if (!px) return;
    const cover = selectionIn(px.base.width, px.base.height, px.toPx);
    if (!cover) return;
    await this.runInpaint(node.id, px.base, cover, 100);
  }
}
