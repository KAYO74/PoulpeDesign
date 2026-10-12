import type { GradientKind, StrokeJoin } from '@poulpe/core';
import { Store } from '../../store';

/** Types de peinture du menu de l'outil Remplissage. */
export type FillKind = 'none' | 'solid' | GradientKind | 'bitmap';

export interface PaintToolState {
  /** Type des dégradés tracés sur un objet qui n'en a pas encore (outil Remplissage). */
  fillKind: FillKind;
  /** Type des transparences tracées (outil Transparence). */
  transKind: GradientKind;
  /** Arrêt choisi du dégradé affiché (outils Remplissage et Transparence, panneau Couleur). */
  stop: number;
  /** Point de largeur choisi (outil Largeur de trait). */
  widthPoint: number | null;
  /** Réglages des nouveaux contours (outil Contour). */
  contour: { radius: number; join: StrokeJoin; miterLimit: number };
}

export const paintStore = new Store<PaintToolState>({
  fillKind: 'linear',
  transKind: 'linear',
  stop: 0,
  widthPoint: null,
  contour: { radius: 10, join: 'round', miterLimit: 4 },
});
