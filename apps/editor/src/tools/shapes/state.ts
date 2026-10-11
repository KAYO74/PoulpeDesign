import type { CornerType, ShapeKind } from '@poulpe/core';
import { Store } from '../../store';

/* Réglages des outils de forme et de l'outil Coin (hors document). */

export interface ShapesState {
  /** Réglages des nouvelles formes, par forme (ceux par défaut s'ils manquent). */
  params: Partial<Record<ShapeKind, Record<string, number>>>;
  /** Rectangle arrondi : rayon et forme des coins des nouveaux rectangles. */
  roundRadius: number;
  roundType: CornerType;
  /** Outil Coin : rayon posé d'un simple clic, et forme des coins. */
  cornerRadius: number;
  cornerType: CornerType;
  /** Outil Coin : derniers coins touchés de l'objet sélectionné (les champs les modifient). */
  active: { id: string; keys: string[] } | null;
}

export const shapesStore = new Store<ShapesState>({
  params: {},
  roundRadius: 20,
  roundType: 'round',
  cornerRadius: 12,
  cornerType: 'round',
  active: null,
});

export const CORNER_TYPES: CornerType[] = ['round', 'straight', 'concave', 'cutout'];
