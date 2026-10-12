import type { CellRange, FrameFit } from '@poulpe/core';
import { Store } from '../../store';

/* Réglages et état des outils Cadre d'image, Image, Tableau et de la sélection de pages. */

/** Image choisie avec l'outil Image, en attente d'être posée (clic ou glisser). */
export interface PendingImage {
  data: string;
  mime: string;
  width: number;
  height: number;
}

export interface FramesState {
  /** Ajustement des nouveaux cadres d'image. */
  fit: FrameFit;
  /** Nouveaux tableaux : lignes, colonnes et ligne d'en-tête. */
  rows: number;
  cols: number;
  header: boolean;
  pending: PendingImage | null;
  /** Cellules choisies dans un tableau (outil Tableau). */
  cells: { tableId: string; range: CellRange } | null;
  /** Pages choisies dans le panneau Pages (Maj ou Ctrl + clic), en plus de la page active. */
  pages: string[];
}

export const framesState = new Store<FramesState>({
  fit: 'fill',
  rows: 3,
  cols: 3,
  header: false,
  pending: null,
  cells: null,
  pages: [],
});
