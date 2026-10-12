import type { ToolModule } from '../types';
import { BrushesExtra } from './bars';
import { brushesDelegate } from './delegate';

/*
 * Pinceaux et sélections de la Persona Photo au niveau d'Affinity Photo : trait droit (Maj + clic),
 * prélèvement de couleur (Alt), taille et dureté au glisser (Ctrl + Alt), flux au clavier
 * (Maj + chiffres), stabilisateur, préréglages ; plage de tons d'Éclaircir et Assombrir ; mode de
 * fusion du pinceau et du pot de peinture ; tampon aligné, tourné, mis à l'échelle ; sélections
 * depuis le centre, lasso polygonal et magnétique, baguette magique réglée au glisser, affinage.
 * Les coups de pinceau eux-mêmes restent dans photo/brushEngine.ts (voir photo/photoTools.ts).
 */

const module: ToolModule = {
  delegate: brushesDelegate,
  contextExtra: BrushesExtra,
};

export default module;
