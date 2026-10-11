import {
  artboardAt,
  findArtboard,
  findNode,
  flattenCommands,
  localToWorld,
  shapePath,
  styleAt,
  textPathCommands,
  type SceneNode,
  type TextNode,
  type Vec,
} from '@poulpe/core';
import { measureText } from '@poulpe/render';
import type { CanvasController } from '../../canvas/controller';
import { editedTextId, textSelection } from '../../canvas/textEdit';
import { t } from '../../i18n';
import { editor, ui, type ToolId } from '../../store';
import type { ToolDelegate } from '../types';
import { nudgeTracking, selectedTexts } from './actions';
import {
  artisticTextAt,
  dragFontSize,
  outlineAt,
  pathCaretStops,
  sizedArtisticText,
  startPathText,
} from './create';

/** Distance (pixels d'écran) à laquelle un clic attrape le contour d'une forme. */
const OUTLINE_TOL = 6;

/** Curseur « texte sur tracé » : une barre d'insertion au-dessus d'une courbe. */
const PATH_CURSOR = (() => {
  const d = 'M7 2.5h4 M9 2.5v11 M7 13.5h4 M2.5 19.5c3-4 6-4 6.5-1s4 3 7-1';
  const body =
    `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="#1a1a1d" stroke-width="1.3" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 9 8, text`;
})();

interface SizeDrag {
  start: Vec;
  current: Vec;
  artboardId: string;
  /** Le pointeur a assez bougé verticalement pour choisir une taille. */
  moved: boolean;
}

/**
 * Gestes de l'outil Texte artistique : glisser pour choisir la taille de la police, clic sur un
 * contour pour un texte sur tracé (le contour visé s'éclaire, le curseur change). L'outil Cadre
 * de texte garde le tracé de cadre du contrôleur (avec aimantation) ; son simple clic est dans
 * `clickFrame`.
 */
export function textDelegate(c: CanvasController): ToolDelegate {
  let drag: SizeDrag | null = null;
  let hover: SceneNode | null = null;

  const setHover = (n: SceneNode | null) => {
    if (n?.id === hover?.id) return;
    hover = n;
    c.requestDraw();
  };

  /** Point d'un objet (repère local) à l'écran. */
  const screenOf = (n: SceneNode, l: Vec) => c.toScreen(localToWorld(n, l));

  const strokePolys = (
    ctx: CanvasRenderingContext2D,
    n: SceneNode,
    polys: { points: Vec[]; closed: boolean }[],
  ) => {
    ctx.beginPath();
    for (const poly of polys) {
      poly.points.forEach((pt, i) => {
        const s = screenOf(n, pt);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      if (poly.closed) ctx.closePath();
    }
    ctx.stroke();
  };

  /** Courbe, curseur et sélection d'un texte sur tracé en cours d'édition. */
  const drawPathEditing = (ctx: CanvasRenderingContext2D, color: string) => {
    const id = editedTextId();
    const n = id ? findNode(editor.doc, id)?.node : null;
    const sel = textSelection();
    if (n?.type !== 'text' || !n.path || !sel) return;
    const zoom = c.view.zoom;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4, 3]);
    strokePolys(ctx, n, flattenCommands(textPathCommands(n), 0.5));
    ctx.restore();
    const { path, stops } = pathCaretStops(n, measureText);
    if (path.length <= 0) return;
    const rot = (n.rotation * Math.PI) / 180;
    const place = (s: number) => {
      const a = path.at(path.closed ? s : Math.min(path.length, Math.max(0, s)));
      return a ? { p: screenOf(n as TextNode, a), angle: a.angle + rot } : null;
    };
    ctx.save();
    if (sel.start === sel.end) {
      const at = place(stops[Math.min(sel.start, stops.length - 1)]);
      const size = styleAt(n, Math.max(0, sel.start - 1)).fontSize * zoom;
      if (at) {
        ctx.translate(at.p.x, at.p.y);
        ctx.rotate(at.angle);
        ctx.fillStyle = color;
        ctx.fillRect(-0.75, -size * 0.9, 1.5, size * 1.1);
      }
    } else {
      ctx.fillStyle = 'rgba(77,163,255,0.35)';
      for (let i = sel.start; i < sel.end && i + 1 < stops.length; i++) {
        const w = stops[i + 1] - stops[i];
        const at = place(stops[i] + w / 2);
        if (!at || w <= 0) continue;
        const size = styleAt(n, i).fontSize * zoom;
        ctx.save();
        ctx.translate(at.p.x, at.p.y);
        ctx.rotate(at.angle);
        ctx.fillRect((-w * zoom) / 2, -size * 0.9, w * zoom, size * 1.1);
        ctx.restore();
      }
    }
    ctx.restore();
  };

  return {
    get busy() {
      return drag !== null;
    },

    pointerDown(e, p) {
      if (ui.get().tool !== 'text' || e.button !== 0) return false;
      const doc = editor.doc;
      // Un clic sur un texte le modifie (le contrôleur s'en charge).
      if (c.hitTest(p, true)?.type === 'text') return false;
      const shape = outlineAt(doc, p, OUTLINE_TOL / c.view.zoom);
      if (shape) {
        hover = null;
        startPathText(shape.node, shape.artboardId, p);
        return true;
      }
      const ab = artboardAt(doc, p) ?? findArtboard(doc, editor.getState().activeArtboardId);
      if (!ab) return false;
      editor.setActiveArtboard(ab.id);
      drag = { start: p, current: p, artboardId: ab.id, moved: false };
      return true;
    },

    pointerMove(_e, p) {
      if (drag) {
        drag.current = p;
        if (!drag.moved && Math.abs(p.y - drag.start.y) * c.view.zoom > 3) drag.moved = true;
        return true;
      }
      if (ui.get().tool !== 'text') {
        setHover(null);
        return false;
      }
      // Survol d'un contour : le texte s'écrira le long de ce tracé.
      let shape = outlineAt(editor.doc, p, OUTLINE_TOL / c.view.zoom)?.node ?? null;
      if (shape && c.hitTest(p, true)?.type === 'text') shape = null;
      setHover(shape);
      return false;
    },

    pointerUp(_e, p) {
      if (!drag) return false;
      const g = drag;
      drag = null;
      g.current = p;
      if (g.moved && dragFontSize(g.start, g.current) * c.view.zoom > 3)
        sizedArtisticText(g.start, g.current, g.artboardId);
      else artisticTextAt(g.start, g.artboardId);
      return true;
    },

    cancel() {
      drag = null;
    },

    key(e) {
      if (e.key === 'Escape' && drag) {
        drag = null;
        c.requestDraw();
        return true;
      }
      // Alt+Gauche / Alt+Droite sur les textes sélectionnés : interlettrage (l'édition a sa propre gestion).
      const tool = ui.get().tool;
      if (
        e.altKey &&
        !e.shiftKey &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        (tool === 'select' || tool === 'text' || tool === 'frameText') &&
        selectedTexts().length
      )
        return nudgeTracking(e.key === 'ArrowLeft' ? -1 : 1);
      return false;
    },

    draw(ctx, color) {
      drawPathEditing(ctx, color);
      if (hover && ui.get().tool === 'text' && !drag) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        strokePolys(ctx, hover, flattenCommands(shapePath(hover), 0.5));
        ctx.restore();
      }
      if (drag?.moved) {
        // Aperçu de la taille : la hauteur glissée, une barre d'insertion et la taille en pixels.
        const size = dragFontSize(drag.start, drag.current);
        const top = c.toScreen({ x: drag.start.x, y: Math.min(drag.start.y, drag.current.y) });
        const h = size * c.view.zoom;
        const w = Math.max(10, h * 0.6);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(Math.round(top.x) + 0.5, Math.round(top.y) + 0.5, Math.round(w), Math.round(h));
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(top.x, top.y + h);
        ctx.stroke();
        const label = t('tx.size', { size: Math.round(size * 10) / 10 });
        ctx.font = '600 11px system-ui, sans-serif';
        const lw = ctx.measureText(label).width + 10;
        ctx.fillStyle = color;
        ctx.fillRect(top.x + w + 6, top.y + h / 2 - 9, lw, 18);
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, top.x + w + 11, top.y + h / 2);
        ctx.restore();
      }
    },

    cursor(tool: ToolId) {
      return tool === 'text' && hover ? PATH_CURSOR : null;
    },
  };
}
