import type { ComponentType } from 'react';
import type { Vec } from '@poulpe/core';
import type { CanvasController } from '../canvas/controller';
import type { ToolId } from '../store';

/**
 * Gestes d'une famille d'outils sur le canevas, en plus des outils de base. Chaque méthode
 * renvoie true quand elle a pris en charge l'événement ; elle vérifie elle-même l'outil actif.
 */
export interface ToolDelegate {
  /** Un geste est en cours : le menu du clic droit et l'outil temporaire attendent la fin. */
  readonly busy?: boolean;
  pointerDown?(e: PointerEvent, p: Vec, s: Vec): boolean;
  pointerMove?(e: PointerEvent, p: Vec, s: Vec): boolean;
  pointerUp?(e: PointerEvent, p: Vec, s: Vec): boolean;
  /** Geste interrompu (perte du pointeur, Échap…) : tout annuler. */
  cancel?(): void;
  doubleClick?(e: MouseEvent, p: Vec, s: Vec): boolean;
  /** Touche pressée sans Ctrl ni Cmd (Entrée, Échap, flèches…). */
  key?(e: KeyboardEvent): boolean;
  /** Dessin d'interface par-dessus le document, en pixels d'écran (`c.toScreen`). */
  draw?(ctx: CanvasRenderingContext2D, color: string): void;
  /** Curseur à afficher pour cet outil, ou null pour celui par défaut. */
  cursor?(tool: ToolId): string | null;
  dispose?(): void;
}

/** Une famille d'outils : ses gestes sur le canevas et sa barre contextuelle. */
export interface ToolModule {
  delegate?: (c: CanvasController) => ToolDelegate;
  /** Barre contextuelle qui remplace celle par défaut, par outil. */
  context?: Partial<Record<ToolId, ComponentType>>;
  /** Ajouté à la fin de la barre contextuelle ; rend null quand il ne sert pas. */
  contextExtra?: ComponentType;
}
