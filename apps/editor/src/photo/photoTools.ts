import type { Vec } from '@poulpe/core';
import type { CanvasController } from '../canvas/controller';
import { t } from '../i18n';
import { brushOptions } from '../tools/brushes/state';
import { brushSettings, isBrushTool, setBrush, toast, ui, type SelectionMode } from '../store';
import { BrushEngine } from './brushEngine';
import { GeometryTools } from './geometryTools';
import { targetPixels } from './paintTarget';
import { fillAt, runInpaint } from './photoFill';
import { drawPhotoOverlay } from './photoOverlay';
import { images, selectedImage } from './pixels';
import { QuickSelect, getSelection, selectShape, selectSimilar, selectionIn } from './selection';
import { isPhotoTool } from './toolKinds';

// Noms exportés de ce module avant son découpage, inchangés pour les autres fichiers.
export { isPhotoTool };
export { photoHooks, type BrushExtension, type Rect, type StrokeRedirect } from './photoHooks';

/*
 * Outils de la Persona Photo : sélections (rectangle, ellipse, lasso, baguette magique),
 * pinceau, gomme, pot de peinture, tampon de duplication, densité − et +, flou et netteté au
 * pinceau, gomme magique, lasso polygonal, sélection rapide, correcteur, doigt, fluidité,
 * redressement et correction de perspective.
 *
 * Un coup de pinceau travaille sur une copie des pixels du calque (ou de son masque) : la copie
 * est affichée à la place de l'image pendant le geste, puis enregistrée dans le document en une
 * seule étape d'historique au relâchement.
 *
 * Ce fichier reçoit les gestes du pointeur et les touches, et mène les sélections ; le reste vit
 * dans les modules voisins : brushEngine.ts (coups de pinceau), brushDabs.ts (doigt, fluidité,
 * couleur semblable), brushSources.ts (empreinte, pixels transformés), paintTarget.ts (calque
 * visé), photoFill.ts (pot de peinture, gomme magique, remplissage d'après le contenu),
 * geometryTools.ts (redressement, perspective), photoOverlay.ts (dessin des aides), toolKinds.ts
 * (familles d'outils) et photoHooks.ts (points d'entrée des outils de la version 1.2).
 */

export class PhotoTools {
  // Membres sans `private` : internes au dossier photo (photoOverlay.ts dessine les gestes en cours).
  // Hors de ce dossier, seules les méthodes publiques ci-dessous servent.
  /** Coups de pinceau et tampon de duplication (voir brushEngine.ts). */
  readonly brush: BrushEngine;
  /** Redressement et perspective (voir geometryTools.ts). */
  readonly geometry: GeometryTools;
  /** `origin` : point de départ du glisser ; Alt enfoncé au départ retire de la sélection (sinon : depuis le centre). */
  marquee: {
    start: Vec;
    current: Vec;
    mode: SelectionMode;
    shape: 'rect' | 'ellipse';
    origin: Vec;
    altAtStart: boolean;
  } | null = null;
  lasso: { points: Vec[]; mode: SelectionMode } | null = null;
  /** Lasso polygonal : sommets posés un par un ; `hover` suit le pointeur. */
  poly: { points: Vec[]; mode: SelectionMode; hover: Vec; lastClick: number } | null = null;
  private quick: { session: QuickSelect; last: Vec } | null = null;
  pointer: Vec | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unsub: () => void;
  private unsubOptions: () => void;

  constructor(readonly c: CanvasController) {
    this.brush = new BrushEngine(c);
    this.geometry = new GeometryTools(c);
    // Les fourmis de la sélection bougent : on redessine régulièrement tant qu'il y en a.
    this.unsub = ui.subscribe(() => this.updateTimer());
    // Un autre mode du lasso abandonne le polygone en cours (sinon il garderait le pointeur).
    this.unsubOptions = brushOptions.subscribe(() => {
      if (!this.poly || brushOptions.get().lassoMode === 'polygonal') return;
      this.poly = null;
      this.updateTimer();
      this.c.requestDraw();
    });
    // Un autre outil (ou une autre Persona) abandonne la sélection en cours de tracé : sinon le
    // polygone garderait le pointeur et l'outil temporaire ne reviendrait plus.
    window.addEventListener('poulpe:toolchange', this.dropSelection);
  }

  dispose(): void {
    this.unsub();
    this.unsubOptions();
    window.removeEventListener('poulpe:toolchange', this.dropSelection);
    clearInterval(this.timer);
  }

  private dropSelection = () => {
    if (!this.poly && !this.lasso && !this.marquee) return;
    this.poly = null;
    this.lasso = null;
    this.marquee = null;
    this.updateTimer();
    this.c.requestDraw();
  };

  private updateTimer() {
    const need = ui.get().hasPixelSelection || !!this.lasso || !!this.poly || !!ui.get().busy;
    if (need && !this.timer) this.timer = setInterval(() => this.c.requestDraw(), 140);
    else if (!need && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get busy(): boolean {
    return !!(
      this.brush.stroke ||
      this.marquee ||
      this.lasso ||
      this.poly ||
      this.quick ||
      this.geometry.straight
    );
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
    this.brush.altDown = e.altKey;
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
      this.geometry.straight = { start: p, current: p };
      return true;
    }
    if (tool === 'perspective') {
      this.geometry.perspDown(p);
      return true;
    }
    if ((tool === 'clone' || tool === 'heal') && e.altKey) {
      this.brush.cloneSource = p;
      this.brush.cloneOffset = null;
      toast(t('photo.cloneSourceSet'));
      return true;
    }
    if (tool === 'fill') {
      fillAt(p);
      return true;
    }
    if (!isBrushTool(tool)) return true;
    this.brush.beginStroke(tool, p, e);
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    const tool = ui.get().tool;
    this.brush.altDown = e.altKey;
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
    if (this.geometry.straight) {
      this.geometry.straight.current = p;
      this.c.requestDraw();
      return true;
    }
    if (this.geometry.persp && this.geometry.persp.drag >= 0) {
      this.geometry.persp.quad[this.geometry.persp.drag] = p;
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
    if (this.brush.stroke && !this.brush.stroke.pending) {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const rect = this.c.canvas.getBoundingClientRect();
      const pts = events.length
        ? events.map((ev) => ({
            p: this.c.toWorld(ev.clientX - rect.left, ev.clientY - rect.top),
            pressure: ev.pressure,
            pen: ev.pointerType === 'pen',
          }))
        : [{ p, pressure: e.pressure, pen: e.pointerType === 'pen' }];
      const stab = this.brush.stroke.stab;
      for (const q of pts) {
        const pressure = q.pen ? q.pressure : 1;
        if (!stab) this.brush.strokeTo(q.p, pressure);
        else for (const r of stab.push({ ...q.p, pressure })) this.brush.strokeTo(r, r.pressure);
      }
      this.brush.recompose();
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
    if (this.geometry.straight) {
      const st = this.geometry.straight;
      this.geometry.straight = null;
      this.geometry.applyStraighten(st.start, st.current);
      this.c.requestDraw();
      return true;
    }
    if (this.geometry.persp && this.geometry.persp.drag >= 0) {
      this.geometry.persp.drag = -1;
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
    if (this.brush.stroke && !this.brush.stroke.pending) {
      // La fenêtre du stabilisateur rattrape le pointeur.
      const rest = this.brush.stroke.stab?.finish() ?? [];
      for (const r of rest) this.brush.strokeTo(r, r.pressure);
      if (rest.length) this.brush.recompose();
      void this.brush.endStroke();
      return true;
    }
    return false;
  }

  pointerCancel(): void {
    this.marquee = null;
    this.lasso = null;
    this.poly = null;
    this.geometry.straight = null;
    if (this.quick) {
      this.quick.session.end();
      this.quick = null;
    }
    if (this.brush.stroke && !this.brush.stroke.pending) {
      this.brush.showLive(this.brush.stroke, null);
      this.brush.stroke = null;
    }
    this.updateTimer();
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
    if (e.key === 'Escape' && (this.lasso || this.marquee || this.poly || this.geometry.straight)) {
      this.lasso = null;
      this.marquee = null;
      this.poly = null;
      this.geometry.straight = null;
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
    if (this.geometry.persp && ui.get().perspectiveId && (e.key === 'Enter' || e.key === 'Escape')) {
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

  // ————— Perspective (voir geometryTools.ts) —————

  cancelPerspective(): void {
    this.geometry.cancelPerspective();
  }

  /** Le quadrilatère devient le calque entier (comme le recadrage en perspective de Photoshop). */
  applyPerspective(): Promise<void> {
    return this.geometry.applyPerspective();
  }

  // ————— Gomme magique et remplissage d'après le contenu (voir photoFill.ts) —————

  /**
   * Reconstruit la zone couverte par `cover` (opacité > `threshold`) dans les pixels `base` du
   * calque, puis enregistre le résultat. Sert à la gomme magique et au remplissage d'après le
   * contenu.
   * Délègue à la fonction du même nom de photoFill.ts.
   */
  runInpaint(
    nodeId: string,
    base: HTMLCanvasElement,
    cover: HTMLCanvasElement,
    threshold: number,
  ): Promise<void> {
    return runInpaint(nodeId, base, cover, threshold);
  }

  // ————— Dessin —————

  /** Dessine les aides de la Persona Photo, en pixels d'écran. */
  draw(ctx: CanvasRenderingContext2D): void {
    drawPhotoOverlay(this, ctx);
  }

  /** Remplissage d'après le contenu : reconstruit la sélection dans le calque choisi. */
  async contentAwareFill(): Promise<void> {
    const node = selectedImage();
    if (!node || !getSelection()) return;
    const px = targetPixels(node, 'pixels');
    if (!px) return;
    const cover = selectionIn(px.base.width, px.base.height, px.toPx);
    if (!cover) return;
    await this.runInpaint(node.id, px.base, cover, 100);
  }
}
