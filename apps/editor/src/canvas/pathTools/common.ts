import {
  fromSubpaths,
  setPathCommands,
  smartMarks,
  type PathNode,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import type { SnapLines } from '../snapping';

/*
 * Outil Nœud : constantes, types et petites fonctions partagés par les modules de `pathTools/`.
 */

export const HIT = 7;

/** Poignées du cadre de transformation des nœuds (option « Transformer »). */
export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';
export interface Box4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type NodeDrag =
  | {
      kind: 'anchors';
      id: string;
      base: SubPath[];
      start: Vec;
      keys: string[];
      moved: boolean;
      /** Nœud saisi (repère du tracé) : c'est lui qui s'aimante. */
      grab: Vec;
      /** Autres nœuds du tracé (monde), pour s'aligner dessus. */
      targets: Vec[];
      lines: SnapLines | null;
    }
  | { kind: 'handle'; id: string; base: SubPath[]; key: string; which: 'in' | 'out'; smooth: boolean }
  | {
      kind: 'segment';
      id: string;
      base: SubPath[];
      si: number;
      seg: number;
      t: number;
      startScreen: Vec;
      moved: boolean;
      /** Simple clic : ajouter un nœud, redresser (Alt) ou supprimer le segment (Ctrl). */
      mod: SegmentMod;
    }
  | {
      kind: 'box';
      id: string;
      base: SubPath[];
      keys: string[];
      handle: BoxHandle;
      /** Cadre des nœuds sélectionnés (monde), centre et point de départ du pointeur. */
      box: Box4;
      center: Vec;
      start: Vec;
      startScreen: Vec;
      moved: boolean;
    };

export type SegmentMod = 'add' | 'straighten' | 'delete';

/** Écrit des sous-tracés dans un tracé (brouillon), avec ses nœuds intelligents. */
export function writePath(n: PathNode, sps: SubPath[]): void {
  setPathCommands(n, fromSubpaths(sps));
  const marks = smartMarks(sps);
  if (marks.length) n.smartNodes = marks;
  else delete n.smartNodes;
}

/** Effet d'un clic sur un segment, d'après les touches : comme dans Affinity. */
export function segmentMod(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): SegmentMod {
  return e.ctrlKey || e.metaKey ? 'delete' : e.altKey ? 'straighten' : 'add';
}

/** Effet d'une sélection de nœuds à la zone (comme dans Affinity). */
export type NodeSelOp = 'replace' | 'add' | 'subtract' | 'toggle';
