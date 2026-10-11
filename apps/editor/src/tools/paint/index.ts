import type { ToolDelegate, ToolModule } from '../types';
import { ContourTool } from './contourTool';
import { GradientTool } from './gradientTool';
import { WidthTool } from './widthTool';
import { ContourContext, FillContext, TransparencyContext, WidthContext } from './PaintContext';

/*
 * Outils de peinture de la Persona Dessin (et Mise en page pour les deux premiers), comme dans
 * Affinity : Remplissage [G], Transparence [Y], Contour [O] et Largeur de trait [W]. Chaque outil
 * vérifie lui-même qu'il est actif.
 */

const module: ToolModule = {
  delegate: (c) => {
    const gradient = new GradientTool(c);
    const contour = new ContourTool(c);
    const width = new WidthTool(c);
    const d: ToolDelegate = {
      get busy() {
        return gradient.busy || contour.busy || width.busy;
      },
      pointerDown: (e, p, s) =>
        gradient.pointerDown(e, p, s) || contour.pointerDown(e, p, s) || width.pointerDown(e, p, s),
      pointerMove: (e, p, s) =>
        gradient.pointerMove(e, p, s) || contour.pointerMove(e, p, s) || width.pointerMove(e, p, s),
      pointerUp: (e, p) => gradient.pointerUp(e, p) || contour.pointerUp() || width.pointerUp(),
      cancel: () => {
        gradient.cancel();
        contour.cancel();
        width.cancel();
      },
      key: (e) => gradient.key(e) || width.key(e),
      cursor: (tool) => gradient.cursor(tool) ?? width.cursor(tool),
      draw: (ctx, color) => {
        gradient.draw(ctx, color);
        contour.draw(ctx, color);
        width.draw(ctx, color);
      },
    };
    return d;
  },
  context: {
    gradient: FillContext,
    transparency: TransparencyContext,
    contour: ContourContext,
    strokeWidth: WidthContext,
  },
};

export default module;
