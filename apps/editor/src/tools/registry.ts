import type { ComponentType } from 'react';
import type { ToolId } from '../store';
import type { ToolModule } from './types';
import shapes from './shapes';
import paint from './paint';
import paths from './paths';
import move from './move';
import pixel from './pixel';
import brushes from './brushes';
import text from './text';
import textFlow from './textFlow';
import frames from './frames';

/* Familles d'outils ajoutées en version 1.2, branchées sur le canevas et la barre contextuelle. */

export const TOOL_MODULES: ToolModule[] = [
  shapes,
  paint,
  paths,
  move,
  pixel,
  brushes,
  text,
  textFlow,
  frames,
];

/** Barre contextuelle propre à un outil, si une famille en fournit une. */
export function contextFor(tool: ToolId): ComponentType | null {
  for (const m of TOOL_MODULES) {
    const c = m.context?.[tool];
    if (c) return c;
  }
  return null;
}

export const CONTEXT_EXTRAS: ComponentType[] = TOOL_MODULES.flatMap((m) =>
  m.contextExtra ? [m.contextExtra] : [],
);
