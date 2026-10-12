import { flattenCommands, localToWorld, shapePath, type SceneNode, type Vec } from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { linkTextFrames } from '../../layoutActions';
import { editor, ui } from '../../store';
import type { ToolDelegate } from '../types';
import { closedShapeAt, linkNewFrame } from './actions';

/*
 * Gestes de la coulée du texte sur le canevas : après un clic sur l'indicateur de débordement, un
 * clic sur un cadre le lie, un clic ailleurs pose un cadre de même taille et un glissement trace le
 * nouveau cadre à la taille voulue. Avec l'outil Cadre de texte, la forme fermée survolée (qui
 * deviendrait un cadre de sa forme au clic) s'éclaire.
 */

interface LinkDrag {
  from: string;
  start: Vec;
  current: Vec;
  moved: boolean;
}

let drag: LinkDrag | null = null;

/**
 * Clic qui suit le clic sur l'indicateur de débordement (appelé par le contrôleur, avant les
 * outils) : un texte sous le pointeur est lié tout de suite, sinon le glissement commence.
 */
export function startFrameLink(c: CanvasController, p: Vec): void {
  const from = ui.get().linkFrom;
  ui.set({ linkFrom: null });
  if (!from) return;
  const hit = c.hitTest(p, true);
  if (hit?.type === 'text') {
    linkTextFrames(from, hit.id, p);
    return;
  }
  drag = { from, start: p, current: p, moved: false };
}

export function textFlowDelegate(c: CanvasController): ToolDelegate {
  let hover: SceneNode | null = null;

  const setHover = (n: SceneNode | null) => {
    if (n?.id === hover?.id) return;
    hover = n;
    c.requestDraw();
  };

  const box = (g: LinkDrag) => ({
    x: Math.min(g.start.x, g.current.x),
    y: Math.min(g.start.y, g.current.y),
    width: Math.abs(g.current.x - g.start.x),
    height: Math.abs(g.current.y - g.start.y),
  });

  return {
    get busy() {
      return drag !== null;
    },

    pointerMove(_e, p) {
      if (drag) {
        drag.current = p;
        const z = c.view.zoom;
        if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * z > 4) drag.moved = true;
        return true;
      }
      // Outil Cadre de texte : la forme fermée sous le pointeur deviendra un cadre de sa forme.
      if (ui.get().tool === 'frameText' && !ui.get().editingTextId) {
        const hit = c.hitTest(p, true);
        setHover(hit?.type === 'text' ? null : (closedShapeAt(editor.doc, p)?.node ?? null));
      } else setHover(null);
      return false;
    },

    pointerUp(_e, p) {
      if (!drag) return false;
      const g = drag;
      drag = null;
      g.current = p;
      const b = box(g);
      if (g.moved && b.width * c.view.zoom > 4 && b.height * c.view.zoom > 4) linkNewFrame(g.from, b);
      else linkTextFrames(g.from, null, g.start);
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
      return false;
    },

    draw(ctx, color) {
      if (hover && ui.get().tool === 'frameText') {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        for (const poly of flattenCommands(shapePath(hover), 0.5)) {
          poly.points.forEach((pt, i) => {
            const s = c.toScreen(localToWorld(hover!, pt));
            if (i) ctx.lineTo(s.x, s.y);
            else ctx.moveTo(s.x, s.y);
          });
          if (poly.closed) ctx.closePath();
        }
        ctx.stroke();
        ctx.restore();
      }
      if (drag?.moved) {
        // Aperçu du cadre lié en cours de tracé.
        const b = box(drag);
        const a = c.toScreen({ x: b.x, y: b.y });
        const z = c.view.zoom;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = 'rgba(77,163,255,0.08)';
        ctx.setLineDash([4, 3]);
        ctx.fillRect(a.x, a.y, b.width * z, b.height * z);
        ctx.strokeRect(
          Math.round(a.x) + 0.5,
          Math.round(a.y) + 0.5,
          Math.round(b.width * z),
          Math.round(b.height * z),
        );
        ctx.restore();
      }
    },

    cursor(tool) {
      if (drag) return 'crosshair';
      return tool === 'frameText' && hover ? 'cell' : null;
    },

    dispose() {
      drag = null;
    },
  };
}
