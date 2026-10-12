import { colorizePixels, parseColor, spongePixels } from '@poulpe/core';
import { photoHooks } from '../../photo/photoTools';
import { ui } from '../../store';
import { pixelStore } from './store';

/*
 * Pinceaux de la version 1.2 branchés sur ceux de la Persona Photo (voir `photoHooks`) : éponge,
 * remplacement de couleur et gomme d'arrière-plan. Le pinceau commun s'occupe du tracé, de la
 * pression, de la sélection, du masque et de l'historique ; ici, seulement ce qu'ils déposent.
 */

export function registerPixelBrushes(): void {
  // Éponge : les pixels saturés ou désaturés, déposés avec la force et le flux du pinceau.
  photoHooks.brushes.sponge = {
    history: 'history.sponge',
    source: () => {
      const amount = pixelStore.get().spongeMode === 'saturate' ? 1 : -1;
      return (px) => spongePixels(px, amount);
    },
  };
  // Remplacement de couleur : la couleur principale, avec la luminosité des pixels proches de la
  // couleur prélevée sous le pinceau.
  photoHooks.brushes.colorReplace = {
    history: 'history.colorReplace',
    source: () => {
      const c = parseColor(ui.get().brushColor);
      return (px) => colorizePixels(px, c);
    },
    similar: () => {
      const s = pixelStore.get();
      return { tolerance: s.replaceTolerance, continuous: s.replaceContinuous, contiguous: false };
    },
  };
  // Gomme d'arrière-plan : n'efface que les pixels proches de la couleur sous le centre du pinceau,
  // les bords du sujet (d'une autre couleur) restent.
  photoHooks.brushes.backgroundEraser = {
    history: 'history.backgroundEraser',
    erase: true,
    similar: () => {
      const s = pixelStore.get();
      return { tolerance: s.bgTolerance, continuous: s.bgContinuous, contiguous: s.bgContiguous };
    },
  };
}
