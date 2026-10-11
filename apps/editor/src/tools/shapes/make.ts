import { createRect, createShape, SHAPE_KINDS, type Box, type SceneNode, type ShapeKind } from '@poulpe/core';
import { t } from '../../i18n';
import { ui, type ToolId } from '../../store';
import { shapesStore } from './state';

/* Création des formes de la version 1.2, par les mêmes gestes que le Rectangle (voir controller.ts). */

/** Outils de forme ajoutés en version 1.2 : glisser pour créer, comme le Rectangle. */
export const NEW_SHAPE_TOOLS: ToolId[] = ['roundRect', ...SHAPE_KINDS];

export const isShapeKind = (tool: string): tool is ShapeKind => (SHAPE_KINDS as string[]).includes(tool);

/** Nouvel objet de l'outil `tool` dans la boîte `box`, ou null si ce n'est pas un de ces outils. */
export function makeShapeNode(tool: ToolId, box: Box): SceneNode | null {
  const d = ui.get().defaults;
  const s = shapesStore.get();
  if (tool === 'roundRect') {
    const r = createRect({ ...box, name: t('tool.roundRect') }, d);
    r.cornerRadius = s.roundRadius;
    if (s.roundType !== 'round') r.cornerType = s.roundType;
    return r;
  }
  if (!isShapeKind(tool)) return null;
  return createShape(tool, { ...box, name: t(`tool.${tool}`) }, d, s.params[tool]);
}
