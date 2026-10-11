import type { ToolModule } from '../types';
import { CornerContext, ShapeContextExtra } from './ContextBars';
import { shapesDelegate } from './delegate';

/*
 * Outils de forme (version 1.2) : rectangle arrondi, triangle, flèche, bulle, anneau, secteur,
 * engrenage, nuage, cœur et spirale, poignées rouges des formes, outil Coin non destructif.
 * La création elle-même passe par les gestes du Rectangle (voir make.ts et controller.ts).
 */
const module: ToolModule = {
  delegate: shapesDelegate,
  context: { corner: CornerContext },
  contextExtra: ShapeContextExtra,
};

export default module;
