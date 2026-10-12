import { isBrushTool, type ToolId } from '../store';

/* Familles d'outils de la Persona Photo (voir photoTools.ts). */

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
export const CREATES_LAYER: ToolId[] = ['brush', 'fill'];
/** Outils qui recopient une version transformée des pixels sous le pinceau. */
export const SOURCE_TOOLS: ToolId[] = ['clone', 'heal', 'dodge', 'burn', 'blurBrush', 'sharpenBrush'];
/** Outils qui déplacent les pixels du calque eux-mêmes, touche après touche. */
export const WARP_TOOLS: ToolId[] = ['smudge', 'liquify'];
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
