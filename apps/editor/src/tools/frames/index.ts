import type { ToolModule } from '../types';
import { FramesExtra, contexts } from './bars';
import { framesDelegate } from './delegate';

/*
 * Cadres d'image, outil Image, Tableau et panneau Pages (Persona Mise en page, comme dans
 * Affinity Publisher). Les actions sont dans frameActions.ts, tableActions.ts et pageActions.ts.
 */

const module: ToolModule = {
  delegate: framesDelegate,
  context: contexts,
  contextExtra: FramesExtra,
};

export default module;
