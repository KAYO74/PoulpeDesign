import type { Pixels } from '@poulpe/core';
import type { ToolId } from '../store';

/*
 * Points d'entrée des outils de la version 1.2 (voir tools/pixel) dans les pinceaux de la Persona
 * Photo. Ce module n'importe que des types : `photoHooks` existe déjà quand tools/pixel le remplit,
 * quel que soit l'ordre de chargement des modules.
 */

/** Retouche au pinceau ajoutée par un outil de la version 1.2 (voir tools/pixel). */
export interface BrushExtension {
  /** Libellé de l'historique. */
  history: string;
  /** Pixels déposés à la place de ceux du calque, transformés tuile par tuile (lu au début du geste). */
  source?: () => (px: Pixels, x0: number, y0: number) => void;
  /** Le pinceau efface (comme la gomme). */
  erase?: boolean;
  /** La touche ne couvre que les pixels proches de la couleur prélevée sous le centre du pinceau. */
  similar?: () => { tolerance: number; continuous: boolean; contiguous: boolean };
}

/** Cible d'un coup de pinceau hors calque : le masque rapide peint dans la sélection. */
export interface StrokeRedirect {
  /** Toile de départ (l'opacité est la valeur peinte) et passage du document à ses pixels. */
  base: HTMLCanvasElement;
  toPx: DOMMatrix;
  /** Aperçu pendant le geste (null à la fin), avec la zone qui vient de changer. */
  live(canvas: HTMLCanvasElement | null, dirty?: Rect): void;
  commit(canvas: HTMLCanvasElement): void;
}

/** Points d'entrée des outils de la version 1.2 dans les pinceaux de la Persona Photo. */
export const photoHooks: {
  brushes: Partial<Record<ToolId, BrushExtension>>;
  /** Le pinceau ou la gomme peint ailleurs que dans un calque (masque rapide). */
  redirect: ((tool: ToolId) => StrokeRedirect | null) | null;
  /** Les fourmis de la sélection sont cachées (masque rapide). */
  hideAnts: () => boolean;
} = { brushes: {}, redirect: null, hideAnts: () => false };

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
