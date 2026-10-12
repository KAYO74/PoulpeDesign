import type { ShapeBuilderMode } from '@poulpe/core';
import { Store } from '../../store';

/* Réglages des outils Plume, Crayon, Pinceau vectoriel, Constructeur de formes et Remplissage de zone. */

/** Modes de la plume, comme dans Affinity : nœuds à la main, lissés tout seuls, droits, ou une ligne par glisser. */
export type PenMode = 'pen' | 'smart' | 'polygon' | 'line';

export interface PathsState {
  penMode: PenMode;
  /** Aperçu du segment suivant, du dernier nœud jusqu'au pointeur. */
  rubberBand: boolean;
  /** Crayon : un trait qui revient près de son départ se ferme. */
  pencilAutoClose: boolean;
  /** Crayon : la pression du stylet règle l'épaisseur (profil de largeur). */
  pencilPressure: boolean;
  /** Crayon : un trait parti d'une courbe sélectionnée la prolonge ou la remodèle. */
  pencilSculpt: boolean;
  builderMode: ShapeBuilderMode;
  /** Remplissage de zone : zones formées par tous les objets du plan de travail, ou par la sélection. */
  fillSource: 'all' | 'selection';
  /** Pinceau vectoriel : épaisseur (px), opacité (%), lissage (0 à 100). */
  brushWidth: number;
  brushOpacity: number;
  brushSmoothing: number;
  brushPressure: boolean;
  /** Effilement des deux bouts, en % de la longueur (sans pression). */
  brushTaper: number;
  /** Longueur de la corde du stabilisateur, en pixels d'écran (0 : sans). */
  brushStabilizer: number;
}

export const pathsState = new Store<PathsState>({
  penMode: 'pen',
  rubberBand: true,
  pencilAutoClose: true,
  pencilPressure: true,
  pencilSculpt: false,
  builderMode: 'add',
  fillSource: 'all',
  brushWidth: 8,
  brushOpacity: 100,
  brushSmoothing: 50,
  brushPressure: true,
  brushTaper: 15,
  brushStabilizer: 0,
});
