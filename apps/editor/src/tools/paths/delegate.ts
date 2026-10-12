import type { CanvasController } from '../../canvas/controller';
import { ui } from '../../store';
import type { ToolDelegate } from '../types';
import { VectorBrushTool } from './brush';
import { ShapeBuilderTool } from './builder';
import type { SubTool } from './common';
import { VectorFillTool } from './fill';
import { KnifeTool } from './knife';
import { PenTool } from './pen';
import { PencilTool } from './pencil';

/* Gestes des outils de tracé sur le canevas : chaque outil a sa classe, le geste en cours passe en premier. */

export function pathsDelegate(c: CanvasController): ToolDelegate {
  const pen = new PenTool(c);
  const tools: Partial<Record<string, SubTool>> = {
    pen,
    pencil: new PencilTool(c),
    vectorBrush: new VectorBrushTool(c),
    knife: new KnifeTool(c),
    shapeBuilder: new ShapeBuilderTool(c),
    vectorFill: new VectorFillTool(c),
  };
  const all = Object.values(tools) as SubTool[];
  const current = (): SubTool | null => tools[ui.get().tool] ?? null;
  /** L'outil dont un geste est en cours, sinon l'outil actif. */
  const target = (): SubTool | null => all.find((x) => x.busy) ?? current();
  return {
    get busy() {
      return all.some((x) => x.busy);
    },
    pointerDown: (e, p, s) => current()?.pointerDown(e, p, s) ?? false,
    pointerMove: (e, p, s) => target()?.pointerMove(e, p, s) ?? false,
    pointerUp: (e, p, s) => all.some((x) => x.busy && x.pointerUp(e, p, s)),
    cancel: () => all.forEach((x) => x.cancel()),
    key: (e) => target()?.key?.(e) ?? false,
    draw: (ctx, color) => all.forEach((x) => x.draw(ctx, color)),
    dispose: () => pen.dispose(),
  };
}
