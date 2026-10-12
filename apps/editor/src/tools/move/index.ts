import type { ToolModule } from '../types';
import { MoveExtra, StylePickerBar, VectorCropBar } from './bars';
import { moveDelegate } from './delegate';

/*
 * Outil Déplacer et outil Plan de travail comme dans Affinity (sélection automatique, point
 * d'origine, objet de dessous, duplication intelligente, poignées du plan de travail), Recadrage
 * vectoriel et Pipette de style. Les points d'appel du contrôleur du canevas sont dans hooks.ts.
 */

const module: ToolModule = {
  delegate: moveDelegate,
  context: { vectorCrop: VectorCropBar, stylePicker: StylePickerBar },
  contextExtra: MoveExtra,
};

export default module;
