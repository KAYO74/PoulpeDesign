import type { ToolDelegate, ToolModule } from '../types';
import { ContourTool } from './contourTool';
import { GradientTool } from './gradientTool';
import { MeshTool } from './meshTool';
import { WidthTool } from './widthTool';
import { ContourContext, FillContext, MeshContext, TransparencyContext, WidthContext } from './PaintContext';

/*
 * Outils de peinture de la Persona Dessin (et Mise en page pour les deux premiers), comme dans
 * Affinity : Remplissage [G], Transparence [Y], Contour [O], Largeur de trait [W] et Filet. Chaque outil
 * vérifie lui-même qu'il est actif.
 */

const module: ToolModule = {
  delegate: (c) => {
    const gradient = new GradientTool(c);
    const contour = new ContourTool(c);
    const width = new WidthTool(c);
    const mesh = new MeshTool(c);
    const d: ToolDelegate = {
      get busy() {
        return gradient.busy || contour.busy || width.busy || mesh.busy;
      },
      pointerDown: (e, p, s) =>
        gradient.pointerDown(e, p, s) ||
        contour.pointerDown(e, p, s) ||
        width.pointerDown(e, p, s) ||
        mesh.pointerDown(e, p, s),
      pointerMove: (e, p, s) =>
        gradient.pointerMove(e, p, s) ||
        contour.pointerMove(e, p, s) ||
        width.pointerMove(e, p, s) ||
        mesh.pointerMove(e, p, s),
      pointerUp: (e, p) =>
        gradient.pointerUp(e, p) || contour.pointerUp() || width.pointerUp() || mesh.pointerUp(),
      cancel: () => {
        gradient.cancel();
        contour.cancel();
        width.cancel();
        mesh.cancel();
      },
      key: (e) => gradient.key(e) || width.key(e) || mesh.key(e),
      cursor: (tool) => gradient.cursor(tool) ?? width.cursor(tool) ?? mesh.cursor(tool),
      draw: (ctx, color) => {
        gradient.draw(ctx, color);
        contour.draw(ctx, color);
        width.draw(ctx, color);
        mesh.draw(ctx, color);
      },
    };
    return d;
  },
  context: {
    gradient: FillContext,
    transparency: TransparencyContext,
    contour: ContourContext,
    strokeWidth: WidthContext,
    mesh: MeshContext,
  },
};

export default module;
