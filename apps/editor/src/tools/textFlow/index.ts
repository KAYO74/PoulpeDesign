import type { ToolModule } from '../types';
import { textFlowDelegate } from './delegate';
import { TextFlowExtra } from './TextFlowBar';

/*
 * Coulée et habillage du texte (Persona Mise en page, et les cadres de texte partout), comme dans
 * Affinity Publisher : habillage des objets, coulée automatique (Maj+clic sur le « + » rouge),
 * cadre lié tracé à la souris, cadres de texte de forme et réglages des cadres.
 */
const module: ToolModule = {
  delegate: textFlowDelegate,
  contextExtra: TextFlowExtra,
};

export default module;
