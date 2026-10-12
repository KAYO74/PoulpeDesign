import type { ToolModule } from '../types';
import { contexts } from './bars';
import { pathsDelegate } from './delegate';

/*
 * Outils de tracé de la version 1.2, comme dans Affinity Designer : plume (modes, élastique,
 * reprise d'une courbe), crayon (pression, fermeture, Sculpter), pinceau vectoriel, cutter à main
 * levée, constructeur de formes et remplissage de zone. La géométrie est dans le cœur
 * (`regions.ts`, `freehand.ts`) ; l'outil Nœud et les ciseaux restent dans `canvas/pathTools.ts`.
 */

const module: ToolModule = {
  delegate: pathsDelegate,
  context: contexts,
};

export default module;
