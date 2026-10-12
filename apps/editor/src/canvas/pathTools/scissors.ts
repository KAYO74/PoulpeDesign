import {
  cachedSvgPath,
  cutPathAtPoint,
  findNode,
  hasClosedSubpath,
  setPathCommands,
  toPathNode,
  worldToPath,
  type PathCommand,
  type PathNode,
  type Vec,
} from '@poulpe/core';
import { t } from '../../i18n';
import { editor, toast } from '../../store';
import type { PathTools } from '../pathTools';
import { HIT } from './common';

/*
 * Ciseaux : un clic sur le contour d'une forme ou d'un tracé l'ouvre à cet endroit (une forme
 * devient une courbe).
 */

/** Objet découpable sous le point : une forme ou un tracé, pas un texte ni une image. */
function cuttable(pt: PathTools, p: Vec): PathNode | null {
  const hit = pt.c.hitTest(p, true);
  if (!hit || hit.locked || !hit.visible) return null;
  return toPathNode(hit);
}

/** Tracé prêt à prendre la place de l'objet d'origine (une forme devient une courbe). */
function cutNode(pn: PathNode, cmds: PathCommand[]): PathNode {
  const node = structuredClone(pn);
  setPathCommands(node, cmds);
  if (!hasClosedSubpath(cmds)) node.fill = { type: 'none' };
  return node;
}

function replaceWithPath(node: PathNode, label: string): void {
  editor.apply(label, (d) => {
    const loc = findNode(d, node.id);
    if (!loc) return;
    loc.parent.children.splice(loc.index, 1, node);
    return [node.id];
  });
}

/** Ciseaux : un clic sur le contour ouvre le tracé à cet endroit. */
export function scissors(pt: PathTools, p: Vec): void {
  const pn = cuttable(pt, p);
  const cut = pn && cutPathAtPoint(cachedSvgPath(pn.d), worldToPath(pn, p), (HIT + 2) / pt.c.view.zoom);
  if (!pn || !cut) {
    toast(t('vector.cutNothing'));
    return;
  }
  replaceWithPath(cutNode(pn, cut), 'history.scissors');
}
