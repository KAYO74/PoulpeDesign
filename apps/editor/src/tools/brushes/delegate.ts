import { findNode, type SceneNode, type Vec } from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { t } from '../../i18n';
import { imageAt } from '../../photo/pixels';
import { FloodSelect, selectShape } from '../../photo/selection';
import {
  brushSettings,
  editor,
  isBrushTool,
  pushRecentColor,
  setBrush,
  ui,
  type SelectionMode,
  type ToolId,
} from '../../store';
import type { ToolDelegate } from '../types';
import { MagneticLasso } from './magnetic';
import { paintArtboardAt, paintNode, sampleColor } from './sample';
import { brushOptions } from './state';

/*
 * Gestes communs aux pinceaux de la Persona Photo (comme dans Affinity Photo) : Alt + glisser
 * prélève la couleur, Ctrl + Alt + glisser règle la taille (horizontalement) et la dureté
 * (verticalement), Maj + chiffres règlent le flux, Maj + [ et ] la dureté. Et deux sélections :
 * la baguette magique dont on règle la tolérance en glissant, le lasso magnétique.
 */

/** Outils qui peignent une couleur : Alt prélève la couleur sous le pointeur. */
const PICK_TOOLS: ToolId[] = ['brush', 'fill', 'colorReplace'];

type Gesture =
  | { kind: 'resize'; tool: ToolId; at: Vec; start: Vec; size: number; hardness: number }
  | { kind: 'pick'; at: Vec; color: string | null }
  | {
      kind: 'wand';
      session: FloodSelect;
      start: Vec;
      at: Vec;
      t0: number;
      moved: boolean;
      dirty: boolean;
      raf: number;
    };

/** Mode d'une nouvelle sélection d'après les touches (comme les autres outils de sélection). */
function selectionMode(e: PointerEvent): SelectionMode {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return ui.get().selectionMode;
}

/** Calque choisi pour la source « calque actuel » de la baguette magique. */
function currentLayer(p: Vec): SceneNode | null {
  if (editor.selection.length === 1) {
    const n = findNode(editor.doc, editor.selection[0])?.node;
    if (n && n.visible) return n;
  }
  return imageAt(p);
}

export function brushesDelegate(c: CanvasController): ToolDelegate {
  let gesture: Gesture | null = null;
  let magnetic: { session: MagneticLasso; mode: SelectionMode } | null = null;
  let hover: Vec | null = null;
  let lastClickAt: Vec | null = null;
  let lastDigit: { digit: string; at: number } | null = null;
  /** Lasso magnétique : dernière position du pointeur, traitée à la prochaine image. */
  let pendingMove: Vec | null = null;
  let moveFrame = 0;

  const zoom = () => ui.get().view.zoom;
  const photoActive = () => ui.get().persona === 'photo' && !ui.get().busy;
  /** Lasso magnétique : rayon de recherche du bord et écart entre ancrages automatiques (document). */
  const magneticRadius = () => brushOptions.get().magneticWidth / zoom();
  const magneticSpacing = () => 60 / zoom();

  const dropMagnetic = () => {
    if (!magnetic) return;
    magnetic = null;
    c.requestDraw();
  };
  window.addEventListener('poulpe:toolchange', dropMagnetic);
  // Un autre mode du lasso abandonne aussi le contour magnétique (sinon il garderait le pointeur).
  const unsubOptions = brushOptions.subscribe(() => {
    if (brushOptions.get().lassoMode !== 'magnetic') dropMagnetic();
  });

  const pick = (p: Vec) => {
    if (gesture?.kind !== 'pick') return;
    const color = sampleColor(p);
    gesture.color = color;
    if (color) ui.set({ brushColor: color });
  };

  const flushWand = () => {
    if (gesture?.kind !== 'wand' || !gesture.dirty) return;
    gesture.dirty = false;
    gesture.session.update(ui.get().tolerance, ui.get().contiguous);
    c.requestDraw();
  };

  const endWand = () => {
    if (gesture?.kind !== 'wand') return;
    cancelAnimationFrame(gesture.raf);
    flushWand();
    gesture.session.end();
  };

  const closeMagnetic = () => {
    if (!magnetic) return;
    const { session, mode } = magnetic;
    magnetic = null;
    const pts = session.close(magneticRadius());
    if (pts.length > 2) selectShape('polygon', pts, mode);
    c.requestDraw();
  };

  const magneticClick = (e: PointerEvent, p: Vec) => {
    const now = performance.now();
    if (!magnetic) {
      const session = MagneticLasso.start(p, magneticRadius());
      if (session) magnetic = { session, mode: selectionMode(e) };
      lastClickAt = p;
      c.requestDraw();
      return;
    }
    const s = magnetic.session;
    const first = s.anchors[0];
    const z = zoom();
    // Double-clic, ou clic sur le premier ancrage : on ferme.
    const nearFirst = s.anchors.length > 1 && Math.hypot(p.x - first.x, p.y - first.y) * z < 8;
    const dbl =
      now - s.lastClick < 350 &&
      !!lastClickAt &&
      Math.hypot(p.x - lastClickAt.x, p.y - lastClickAt.y) * z < 6;
    s.lastClick = now;
    lastClickAt = p;
    if (nearFirst || dbl) {
      closeMagnetic();
      return;
    }
    pendingMove = null;
    s.move(p, magneticRadius(), Infinity);
    s.fix();
    c.requestDraw();
  };

  /** Maj + 1 à 0 : flux du pinceau (1 = 10 %, 0 = 100 %, deux chiffres tapés vite = valeur précise). */
  const flowKey = (e: KeyboardEvent): boolean => {
    if (!/^(Digit|Numpad)\d$/.test(e.code)) return false;
    const d = e.code.slice(-1);
    const now = performance.now();
    const quick = lastDigit && now - lastDigit.at < 600;
    const value = quick ? Number(lastDigit!.digit + d) : d === '0' ? 100 : Number(d) * 10;
    lastDigit = quick ? null : { digit: d, at: now };
    setBrush({ flow: Math.max(1, value) });
    return true;
  };

  return {
    get busy() {
      return !!gesture || !!magnetic;
    },

    pointerDown(e, p, s) {
      if (!photoActive()) return false;
      const tool = ui.get().tool;
      // Ctrl + Alt + glisser : taille (horizontalement) et dureté (verticalement) du pinceau.
      if ((e.ctrlKey || e.metaKey) && e.altKey && isBrushTool(tool)) {
        const b = brushSettings(tool);
        gesture = { kind: 'resize', tool, at: s, start: s, size: b.size, hardness: b.hardness };
        c.photo.pointerLeave();
        return true;
      }
      // Alt + clic ou glisser avec un pinceau qui peint : prélève la couleur sous le pointeur.
      if (e.altKey && !e.ctrlKey && !e.metaKey && PICK_TOOLS.includes(tool)) {
        gesture = { kind: 'pick', at: s, color: null };
        pick(p);
        c.photo.pointerLeave();
        return true;
      }
      if (tool === 'magicWand') {
        const layer = brushOptions.get().wandSource === 'layer' ? currentLayer(p) : null;
        const session = FloodSelect.start(p, selectionMode(e), (ctx) => {
          if (layer) paintNode(ctx, layer);
          else paintArtboardAt(ctx, p);
        });
        if (!session) return true;
        session.update(ui.get().tolerance, ui.get().contiguous);
        gesture = {
          kind: 'wand',
          session,
          start: s,
          at: s,
          t0: ui.get().tolerance,
          moved: false,
          dirty: false,
          raf: 0,
        };
        return true;
      }
      if (tool === 'lasso' && brushOptions.get().lassoMode === 'magnetic') {
        magneticClick(e, p);
        return true;
      }
      return false;
    },

    pointerMove(e, p, s) {
      const g = gesture;
      if (g?.kind === 'resize') {
        const z = zoom();
        // Le bord du cercle suit le pointeur horizontalement ; monter durcit, descendre adoucit.
        const size = Math.round(Math.max(1, Math.min(2000, g.size + ((s.x - g.start.x) * 2) / z)));
        const hardness = Math.round(Math.max(0, Math.min(100, g.hardness - (s.y - g.start.y) * 0.5)));
        setBrush({ size, hardness }, g.tool);
        c.requestDraw();
        return true;
      }
      if (g?.kind === 'pick') {
        g.at = s;
        pick(p);
        c.requestDraw();
        return true;
      }
      if (g?.kind === 'wand') {
        g.at = s;
        const dx = s.x - g.start.x;
        if (!g.moved && Math.abs(dx) < 3) return true;
        g.moved = true;
        // Vers la droite : plus de tolérance, vers la gauche : moins.
        const tolerance = Math.round(Math.max(0, Math.min(255, g.t0 + dx)));
        if (tolerance !== ui.get().tolerance) {
          ui.set({ tolerance });
          g.dirty = true;
          if (!g.raf)
            g.raf = requestAnimationFrame(() => {
              g.raf = 0;
              flushWand();
            });
        }
        c.requestDraw();
        return true;
      }
      if (magnetic) {
        if (ui.get().tool !== 'lasso' || ui.get().persona !== 'photo') {
          dropMagnetic();
          return false;
        }
        hover = s;
        // Le chemin le long des bords est calculé une fois par image, pas à chaque événement.
        pendingMove = p;
        if (!moveFrame)
          moveFrame = requestAnimationFrame(() => {
            moveFrame = 0;
            if (!magnetic || !pendingMove) return;
            magnetic.session.move(pendingMove, magneticRadius(), magneticSpacing());
            pendingMove = null;
            c.requestDraw();
          });
        return true;
      }
      return false;
    },

    pointerUp() {
      const g = gesture;
      if (!g) return !!magnetic;
      if (g.kind === 'wand') endWand();
      else if (g.kind === 'pick' && g.color) pushRecentColor(g.color);
      gesture = null;
      c.requestDraw();
      return true;
    },

    cancel() {
      // Geste interrompu : la sélection et la tolérance de départ reviennent.
      if (gesture?.kind === 'wand') {
        cancelAnimationFrame(gesture.raf);
        gesture.session.cancel();
        ui.set({ tolerance: gesture.t0 });
      }
      gesture = null;
      c.requestDraw();
    },

    doubleClick() {
      if (!magnetic) return false;
      closeMagnetic();
      return true;
    },

    key(e) {
      if (ui.get().persona !== 'photo') return false;
      const tool = ui.get().tool;
      if (magnetic && tool === 'lasso') {
        if (e.key === 'Escape') {
          dropMagnetic();
          return true;
        }
        if (e.key === 'Enter') {
          closeMagnetic();
          return true;
        }
        if (e.key === 'Backspace') {
          if (!magnetic.session.undo()) magnetic = null;
          c.requestDraw();
          return true;
        }
      }
      if (!isBrushTool(tool) || !e.shiftKey || e.altKey) return false;
      // En AZERTY, Maj + & é " ' donne 1 à 4 : les modes de la Fluidité passent avant le flux.
      if (tool === 'liquify' && ['1', '2', '3', '4'].includes(e.key)) return false;
      // Maj + [ et ] : dureté du pinceau, par pas de 10 %. D'après le caractère, comme la taille :
      // en AZERTY, [ et ] sont sur les touches 5 et ), avant le flux (Maj + chiffres).
      const harder = e.key === ']' || e.key === '}';
      if (harder || e.key === '[' || e.key === '{') {
        const h = brushSettings(tool).hardness;
        const next = harder ? Math.floor(h / 10) * 10 + 10 : Math.ceil(h / 10) * 10 - 10;
        setBrush({ hardness: Math.max(0, Math.min(100, next)) });
        c.requestDraw();
        return true;
      }
      return flowKey(e);
    },

    draw(ctx) {
      const g = gesture;
      if (g?.kind === 'resize') {
        const b = brushSettings(g.tool);
        const r = Math.max(1, (b.size / 2) * zoom());
        ctx.save();
        ctx.lineWidth = 1;
        for (const [rad, color] of [
          [r, 'rgba(0,0,0,0.85)'],
          [Math.max(1, r - 1), 'rgba(255,255,255,0.9)'],
        ] as const) {
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.arc(g.at.x, g.at.y, rad, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Cercle intérieur : la partie pleine du pinceau (dureté).
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(g.at.x, g.at.y, Math.max(0.5, r * (b.hardness / 100)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        label(
          ctx,
          t('brushes.sizeHardness', { size: b.size, hardness: b.hardness }),
          g.at.x,
          g.at.y + r + 18,
        );
      }
      if (g?.kind === 'pick') {
        ctx.save();
        ctx.lineWidth = 8;
        ctx.strokeStyle = g.color ?? 'rgba(0,0,0,0)';
        ctx.beginPath();
        ctx.arc(g.at.x, g.at.y, 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        for (const [rad, color] of [
          [26.5, 'rgba(0,0,0,0.6)'],
          [17.5, 'rgba(255,255,255,0.8)'],
        ] as const) {
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.arc(g.at.x, g.at.y, rad, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (g?.kind === 'wand' && g.moved)
        label(ctx, t('brushes.toleranceValue', { n: ui.get().tolerance }), g.at.x + 14, g.at.y + 26);
      if (magnetic) {
        const pts = magnetic.session.points().map((q) => c.toScreen(q));
        ctx.save();
        ctx.lineWidth = 1;
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.strokeStyle = '#000000';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        if (hover && pts.length) {
          const end = pts[pts.length - 1];
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(hover.x, hover.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        for (const a of magnetic.session.anchors) {
          const q = c.toScreen(a);
          ctx.beginPath();
          ctx.rect(q.x - 2.5, q.y - 2.5, 5, 5);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    },

    dispose() {
      cancelAnimationFrame(moveFrame);
      window.removeEventListener('poulpe:toolchange', dropMagnetic);
      unsubOptions();
    },
  };
}

/** Petite étiquette sur fond sombre, centrée en (x, y) (pixels d'écran). */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.save();
  ctx.font = '11px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(20,20,24,0.85)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 10, w, 20, 5);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}
