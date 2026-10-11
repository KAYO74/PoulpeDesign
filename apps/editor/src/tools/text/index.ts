import type { ToolModule } from '../types';
import { textDelegate } from './delegate';
import { TextContext, TextExtra } from './TextBar';

/*
 * Outils Texte artistique et Cadre de texte (touche T, qui passe de l'un à l'autre), comme dans
 * Affinity Designer et Publisher.
 */
const module: ToolModule = {
  delegate: textDelegate,
  context: { text: TextContext, frameText: TextContext },
  contextExtra: TextExtra,
};

export default module;
