import {
  boxCenter,
  findArtboard,
  fitRatio,
  inscribedSize,
  levelAngle,
  moveCrop,
  resizeCrop,
  rotateNode,
  translateNode,
  type Box,
  type CropHandle,
  type PoulpeDocument,
  type Vec,
} from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { activeArtboard } from '../../photo/retouchActions';
import { clearSelection } from '../../photo/selection';
import { editor, setTool, ui, type ToolId } from '../../store';
import type { ToolDelegate } from '../types';
import { pixelStore } from './store';

/*
 * Outil Recadrage de la Persona Photo, comme dans Affinity Photo : un cadre couvre tout le
 * document ; ses poignées le redimensionnent, glisser dedans le déplace, glisser dehors en trace
 * un nouveau. Proportions imposées et repères (tiers, grille, nombre d'or) dans la barre
 * contextuelle. Le mode Redresser fait tracer une ligne le long de l'horizon : l'image tourne
 * pour la mettre d'aplomb (aperçu immédiat) et le cadre se resserre pour cacher les coins vides.
 * Entrée applique (une seule étape d'historique, rotation comprise), Échap annule.
 *
 * Le recadrage ne détruit rien : le plan de travail change de taille et le contenu se décale,
 * les pixels hors du cadre sont gardés (cachés), comme dans Affinity.
 */

type Gesture =
  | { kind: 'move'; start: Vec; rect: Box }
  | { kind: 'resize'; handle: CropHandle; rect: Box }
  | { kind: 'new'; start: Vec; rect: Box; moved: boolean }
  | { kind: 'line'; a: Vec; b: Vec };

const CURSORS: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

const OVERLAY_LINES: Record<string, number[]> = {
  thirds: [1 / 3, 2 / 3],
  grid: [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6],
  golden: [0.382, 0.618],
  straighten: Array.from({ length: 11 }, (_, i) => (i + 1) / 12),
};

const sameBox = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < 1e-6 &&
  Math.abs(a.y - b.y) < 1e-6 &&
  Math.abs(a.width - b.width) < 1e-6 &&
  Math.abs(a.height - b.height) < 1e-6;

/** Fait tourner le contenu d'un plan de travail autour de `center` (les réglages sans masque restent à plat). */
function rotateContent(d: PoulpeDocument, abId: string, deg: number, center: Vec) {
  const a = findArtboard(d, abId);
  if (!a || !deg) return;
  for (const child of a.children) {
    if (child.type === 'adjustment' && !child.mask) continue;
    rotateNode(child, deg, center);
  }
}

let instance: CropTool | null = null;

/** Commandes de la barre contextuelle. */
export const crop = {
  apply: () => instance?.apply(),
  reset: () => instance?.reset(),
  cancel: () => {
    instance?.reset();
    setTool('select');
  },
  setAngle: (deg: number) => instance?.setAngle(deg),
  /** Les proportions viennent de changer : le cadre s'y plie, autour de son centre. */
  fitRatio: () => instance?.fitToRatio(),
};

class CropTool implements ToolDelegate {
  private session: { abId: string; ab: Box } | null = null;
  /** La rotation de l'image est montrée par un aperçu de l'éditeur (geste en cours). */
  private previewing = false;
  private gesture: Gesture | null = null;
  private hover: CropHandle | 'inside' | null = null;
  private unsub: (() => void)[];

  constructor(private readonly c: CanvasController) {
    this.unsub = [ui.subscribe(() => this.sync()), editor.subscribe(() => this.sync())];
    // Ctrl+Z pendant l'aperçu de la rotation : on annule seulement la rotation.
    window.addEventListener('keydown', this.onUndoKey, true);
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    window.removeEventListener('keydown', this.onUndoKey, true);
    if (instance === this) instance = null;
  }

  get busy(): boolean {
    return !!this.gesture;
  }

  private active(): boolean {
    return ui.get().tool === 'crop' && ui.get().persona === 'photo';
  }

  private rect(): Box | null {
    return pixelStore.get().cropRect;
  }

  private setRect(r: Box) {
    pixelStore.set({ cropRect: r });
    this.c.requestDraw();
  }

  /** Proportions imposées (largeur / hauteur), null si libres. */
  ratio(): number | null {
    const s = pixelStore.get();
    const ab = this.session?.ab;
    let r: number | null = null;
    if (s.cropRatio === 'original') r = ab ? ab.width / ab.height : null;
    else if (s.cropRatio === 'custom') r = s.cropW > 0 && s.cropH > 0 ? s.cropW / s.cropH : null;
    else if (s.cropRatio !== 'free') {
      const [w, h] = s.cropRatio.split(':').map(Number);
      r = w / h;
    }
    if (r && s.cropPortrait && s.cropRatio !== 'custom') r = 1 / r;
    return r;
  }

  /** Suit l'outil actif et le document : le cadre repart du plan de travail quand il change. */
  private sync = () => {
    if (!this.active()) {
      if (this.session) this.teardown();
      return;
    }
    instance = this;
    if (this.previewing && !editor.inGesture) {
      // L'aperçu a été validé ou annulé ailleurs (une autre commande, l'historique).
      this.previewing = false;
      this.session = null;
    }
    const ab = activeArtboard();
    if (!ab) return;
    const box = { x: ab.x, y: ab.y, width: ab.width, height: ab.height };
    if (
      !this.session ||
      this.session.abId !== ab.id ||
      (!this.previewing && !sameBox(this.session.ab, box))
    ) {
      this.session = { abId: ab.id, ab: box };
      const r = this.ratio();
      pixelStore.set({ cropRect: r ? fitRatio(box, r) : box, cropAngle: 0, cropStraighten: false });
    }
  };

  /** Annule l'aperçu de la rotation (le drapeau tombe avant, `sync` est rappelé par l'éditeur). */
  private stopPreview() {
    const was = this.previewing;
    this.previewing = false;
    if (was) editor.cancel();
  }

  private teardown() {
    this.stopPreview();
    this.session = null;
    this.gesture = null;
    pixelStore.set({ cropRect: null, cropAngle: 0, cropStraighten: false });
  }

  private onUndoKey = (e: KeyboardEvent) => {
    if (!this.previewing || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    const target = e.target as HTMLElement;
    if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.setAngle(0);
  };

  /** Rien n'a changé : le cadre couvre tout le document, sans rotation. */
  private pristine(): boolean {
    const r = this.rect();
    return !this.session || !r || (sameBox(r, this.session.ab) && !pixelStore.get().cropAngle);
  }

  reset(): void {
    if (!this.session) return;
    this.stopPreview();
    const r = this.ratio();
    const ab = this.session.ab;
    pixelStore.set({ cropRect: r ? fitRatio(ab, r) : ab, cropAngle: 0, cropStraighten: false });
    this.c.requestDraw();
  }

  fitToRatio(): void {
    const r = this.ratio();
    const rect = this.rect();
    if (!r || !rect || !this.session) return;
    const angle = pixelStore.get().cropAngle;
    if (angle) {
      // Image tournée : le plus grand cadre sans coin vide, à ces proportions.
      this.setAngle(angle);
      return;
    }
    // Le plus grand cadre de ces proportions dans le document, autour du centre actuel.
    const ab = this.session.ab;
    const fit = fitRatio(ab, r);
    const c = boxCenter(rect),
      f = boxCenter(fit);
    this.setRect(moveCrop(fit, c.x - f.x, c.y - f.y, ab));
  }

  /** Rotation de l'image (degrés) : aperçu immédiat, et le cadre se resserre pour cacher les coins vides. */
  setAngle(deg: number): void {
    const session = this.session;
    if (!session) return;
    const angle = Math.max(-45, Math.min(45, deg));
    const center = boxCenter(session.ab);
    if (Math.abs(angle) < 0.005) this.stopPreview();
    else {
      this.previewing = true;
      // Aperçu passager : une autre commande (calque masqué, historique…) ne l'enregistre pas.
      editor.preview((d) => rotateContent(d, session.abId, -angle, center), { transient: true });
    }
    const rect = this.rect();
    const ratio = this.ratio() ?? (rect ? rect.width / rect.height : session.ab.width / session.ab.height);
    const size = inscribedSize(session.ab.width, session.ab.height, angle, ratio);
    pixelStore.set({
      cropAngle: Math.abs(angle) < 0.005 ? 0 : angle,
      cropRect: { x: center.x - size.width / 2, y: center.y - size.height / 2, ...size },
    });
    this.c.requestDraw();
  }

  /** Applique le recadrage : une seule étape d'historique, rotation comprise. */
  apply(): void {
    const session = this.session;
    const r = this.rect();
    if (!session || !r) return;
    if (this.pristine()) return;
    const angle = pixelStore.get().cropAngle;
    const R = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.max(1, Math.round(r.width)),
      height: Math.max(1, Math.round(r.height)),
    };
    const ab = session.ab;
    const center = boxCenter(ab);
    const recipe = (d: PoulpeDocument) => {
      rotateContent(d, session.abId, -angle, center);
      const a = findArtboard(d, session.abId);
      if (!a) return;
      const dx = a.x - R.x,
        dy = a.y - R.y;
      for (const child of a.children) {
        if (child.type === 'adjustment' && !child.mask) {
          // Un réglage sans masque couvre tout le document.
          child.x = a.x;
          child.y = a.y;
          child.width = R.width;
          child.height = R.height;
        } else translateNode(child, dx, dy);
      }
      a.width = R.width;
      a.height = R.height;
    };
    // La sélection de pixels ne correspond plus à rien après le recadrage.
    clearSelection(false);
    // L'aperçu de la rotation est retiré : la commande la refait, dans la même étape.
    this.stopPreview();
    editor.apply('history.crop', recipe);
    // Le contenu gardé reste à sa place à l'écran.
    const v = ui.get().view;
    ui.set({ view: { ...v, panX: v.panX + (R.x - ab.x) * v.zoom, panY: v.panY + (R.y - ab.y) * v.zoom } });
    this.session = null;
    this.sync();
  }

  // ————— Gestes —————

  private screenRect(r: Box) {
    const a = this.c.toScreen({ x: r.x, y: r.y });
    const b = this.c.toScreen({ x: r.x + r.width, y: r.y + r.height });
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  private hitTest(s: Vec, p: Vec): CropHandle | 'inside' | null {
    const r = this.rect();
    if (!r) return null;
    const { x0, y0, x1, y1 } = this.screenRect(r);
    const mx = (x0 + x1) / 2,
      my = (y0 + y1) / 2;
    const pts: [CropHandle, number, number][] = [
      ['nw', x0, y0],
      ['ne', x1, y0],
      ['se', x1, y1],
      ['sw', x0, y1],
      ['n', mx, y0],
      ['e', x1, my],
      ['s', mx, y1],
      ['w', x0, my],
    ];
    for (const [h, x, y] of pts) if (Math.hypot(s.x - x, s.y - y) <= 9) return h;
    const inY = s.y > y0 && s.y < y1,
      inX = s.x > x0 && s.x < x1;
    if (inY && Math.abs(s.x - x0) <= 5) return 'w';
    if (inY && Math.abs(s.x - x1) <= 5) return 'e';
    if (inX && Math.abs(s.y - y0) <= 5) return 'n';
    if (inX && Math.abs(s.y - y1) <= 5) return 's';
    if (p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height) return 'inside';
    return null;
  }

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    if (!this.active()) return false;
    this.sync();
    const r = this.rect();
    if (!this.session || !r || ui.get().busy) return true;
    if (pixelStore.get().cropStraighten) {
      this.gesture = { kind: 'line', a: p, b: p };
      return true;
    }
    const hit = this.hitTest(s, p);
    if (hit === 'inside') this.gesture = { kind: 'move', start: p, rect: r };
    else if (hit) this.gesture = { kind: 'resize', handle: hit, rect: r };
    else this.gesture = { kind: 'new', start: p, rect: r, moved: false };
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    const g = this.gesture;
    if (!g) {
      if (this.active()) this.hover = this.hitTest(s, p);
      return false;
    }
    const bounds = this.session?.ab ?? null;
    if (g.kind === 'line') {
      g.b = p;
      this.c.requestDraw();
      return true;
    }
    if (g.kind === 'move') {
      this.setRect(moveCrop(g.rect, p.x - g.start.x, p.y - g.start.y, bounds));
      return true;
    }
    // Maj : garde les proportions du cadre de départ quand elles sont libres.
    const ratio = this.ratio() ?? (e.shiftKey ? g.rect.width / g.rect.height : null);
    if (g.kind === 'resize') {
      this.setRect(resizeCrop(g.rect, g.handle, p, ratio, bounds));
      return true;
    }
    const z = ui.get().view.zoom;
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) * z < 4) return true;
    g.moved = true;
    const handle = `${p.y < g.start.y ? 'n' : 's'}${p.x < g.start.x ? 'w' : 'e'}` as CropHandle;
    const from = { x: g.start.x, y: g.start.y, width: 0, height: 0 };
    this.setRect(resizeCrop(from, handle, p, ratio, bounds, 0));
    return true;
  }

  pointerUp(e: PointerEvent): boolean {
    const g = this.gesture;
    if (!g) return false;
    this.gesture = null;
    if (g.kind === 'line') {
      const z = ui.get().view.zoom;
      if (Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) * z >= 6) {
        // L'image affichée est déjà tournée : la nouvelle ligne s'ajoute à la rotation.
        this.setAngle(pixelStore.get().cropAngle + levelAngle(g.a, g.b));
        pixelStore.set({ cropStraighten: false });
      }
    } else if (g.kind === 'new') {
      const r = this.rect();
      if (!g.moved || !r || r.width < 1 || r.height < 1) this.setRect(g.rect);
    }
    void e;
    this.c.requestDraw();
    return true;
  }

  cancel(): void {
    const g = this.gesture;
    this.gesture = null;
    if (g && g.kind !== 'line') this.setRect(g.rect);
  }

  key(e: KeyboardEvent): boolean {
    if (!this.active() || !this.session) return false;
    if (e.key === 'Enter') {
      this.apply();
      return true;
    }
    if (e.key === 'Escape' && (!this.pristine() || pixelStore.get().cropStraighten)) {
      this.reset();
      return true;
    }
    // Pendant l'aperçu de la rotation, les flèches, les chiffres (opacité) et Suppr ne touchent pas
    // aux calques : la rotation et le cadre attendent Entrée ou Échap.
    if (
      this.previewing &&
      (e.key.startsWith('Arrow') ||
        /^(Digit|Numpad)\d$/.test(e.code) ||
        e.key === 'Delete' ||
        e.key === 'Backspace')
    )
      return true;
    return false;
  }

  cursor(tool: ToolId): string | null {
    if (tool !== 'crop' || ui.get().persona !== 'photo') return null;
    if (pixelStore.get().cropStraighten) return 'crosshair';
    const g = this.gesture;
    if (g?.kind === 'move') return 'move';
    if (g?.kind === 'resize') return CURSORS[g.handle];
    if (this.hover === 'inside') return 'move';
    if (this.hover) return CURSORS[this.hover];
    return 'crosshair';
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.active()) return;
    const r = this.rect();
    if (!r) return;
    const { x0, y0, x1, y1 } = this.screenRect(r);
    const w = x1 - x0,
      h = y1 - y0;
    ctx.save();
    // Hors du cadre : assombri.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.rect(-10, -10, this.c.width + 20, this.c.height + 20);
    ctx.rect(x0, y0, w, h);
    ctx.fill('evenodd');
    // Repères.
    const s = pixelStore.get();
    const lines =
      OVERLAY_LINES[s.cropStraighten || this.gesture?.kind === 'line' ? 'straighten' : s.cropOverlay];
    if (lines) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const k of lines) {
        const x = Math.round(x0 + w * k) + 0.5,
          y = Math.round(y0 + h * k) + 0.5;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
    }
    // Cadre et poignées.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(w), Math.round(h));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1a1d';
    const mx = (x0 + x1) / 2,
      my = (y0 + y1) / 2;
    for (const [x, y] of [
      [x0, y0],
      [mx, y0],
      [x1, y0],
      [x1, my],
      [x1, y1],
      [mx, y1],
      [x0, y1],
      [x0, my],
    ]) {
      ctx.beginPath();
      ctx.rect(Math.round(x) - 4.5, Math.round(y) - 4.5, 9, 9);
      ctx.fill();
      ctx.stroke();
    }
    // Ligne du redressement.
    const g = this.gesture;
    if (g?.kind === 'line') {
      const a = this.c.toScreen(g.a),
        b = this.c.toScreen(g.b);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffd400';
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function cropDelegate(c: CanvasController): ToolDelegate {
  const tool = new CropTool(c);
  instance = tool;
  return tool;
}
