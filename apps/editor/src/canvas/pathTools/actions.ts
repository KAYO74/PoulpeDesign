import {
  anchorKey,
  anchorsOf,
  breakAtAnchors,
  cloneSubpaths,
  deleteAnchors,
  exactBounds,
  findNode,
  fitDeleteAnchors,
  fromSubpaths,
  joinEnds,
  keysOf,
  nearestEnds,
  parseAnchorKey,
  pathToWorld,
  refreshSmart,
  removeNodes,
  reverseSubpaths,
  setAnchorKind,
  smoothSubpaths,
  splitAfterAnchors,
  subpathsOfKeys,
  toPathNode,
  topLevelIds,
  worldToPath,
  type PathNode,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import { t } from '../../i18n';
import { editor, toast, ui } from '../../store';
import type { NodeAction, PathTools } from '../pathTools';
import { writePath } from './common';

/*
 * Outil Nœud : actions sur les nœuds (barre contextuelle, menu du clic droit, raccourcis), jonction
 * des courbes de plusieurs objets et enregistrement des sous-tracés modifiés.
 */

/** Enregistre de nouveaux sous-tracés (un tracé vidé est supprimé). */
export function commitNodes(id: string, sps: SubPath[], label: string): void {
  if (!sps.length) {
    editor.apply('history.delete', (d) => {
      removeNodes(d, [id]);
      return [];
    });
    return;
  }
  editor.apply(label, (d) => {
    const m = findNode(d, id)?.node;
    if (m?.type === 'path') writePath(m, sps);
  });
}

/**
 * Applique une action de l'outil Nœud au tracé édité, sur les nœuds sélectionnés ou, pour les
 * actions qui portent sur la courbe, sur les sous-tracés qui les contiennent (tous sans sélection).
 */
export function editNodes(pt: PathTools, kind: NodeAction): void {
  if (kind === 'join' && !pt.editablePath()) return joinObjects(pt);
  const n = pt.editablePath();
  if (!n) return;
  let sps = cloneSubpaths(pt.subpathsOf(n));
  const keys = ui.get().nodeSelection.filter((k) => {
    const [si, ai] = parseAnchorKey(k);
    return !!sps[si]?.anchors[ai];
  });
  const keep = anchorsOf(sps, keys);
  let label = 'history.nodes';
  switch (kind) {
    case 'delete':
    case 'fitDelete':
      if (!keys.length) return;
      sps = kind === 'delete' ? deleteAnchors(sps, keys) : fitDeleteAnchors(sps, keys);
      keep.clear();
      break;
    case 'toggleClosed':
      for (const si of subpathsOfKeys(sps, keys)) sps[si].closed = !sps[si].closed;
      break;
    case 'sharp':
    case 'smooth':
    case 'smart':
      if (!keys.length) return;
      setAnchorKind(sps, keys, kind);
      break;
    case 'split': {
      if (!keys.length) return;
      const added = splitAfterAnchors(sps, keys);
      if (!added.size) return;
      keep.clear();
      added.forEach((a) => keep.add(a));
      break;
    }
    case 'break':
      if (!keys.length) return;
      sps = breakAtAnchors(sps, keys);
      keep.clear();
      break;
    case 'reverse':
      reverseSubpaths(sps, subpathsOfKeys(sps, keys));
      break;
    case 'smoothCurve': {
      const b = exactBounds(fromSubpaths(sps));
      const size = b ? Math.max(b.width, b.height) : 100;
      sps = smoothSubpaths(sps, subpathsOfKeys(sps, keys), Math.max(0.5, size * 0.01));
      keep.clear();
      break;
    }
    case 'join': {
      const ends = keys.length === 2 ? (keys as [string, string]) : nearestEnds(sps);
      const joined = ends && joinEnds(sps, ends[0], ends[1]);
      if (!joined) {
        toast(t('node.joinNothing'));
        return;
      }
      sps = joined;
      keep.clear();
      label = 'history.join';
      break;
    }
  }
  refreshSmart(sps);
  ui.set({ nodeSelection: keysOf(sps, keep) });
  commitNodes(n.id, sps, kind === 'delete' || kind === 'fitDelete' ? 'history.deleteNodes' : label);
}

/**
 * Joindre les courbes de plusieurs objets sélectionnés : ils deviennent un seul tracé, et leurs
 * extrémités libres les plus proches se rejoignent.
 */
function joinObjects(pt: PathTools): void {
  const doc = editor.doc;
  const ids = topLevelIds(doc, editor.selection);
  const nodes = ids.map((id) => findNode(doc, id)?.node).map((m) => (m && !m.locked ? toPathNode(m) : null));
  if (nodes.length < 2 || nodes.some((m) => !m)) {
    toast(t('node.joinNothing'));
    return;
  }
  const [first, ...others] = nodes as PathNode[];
  let sps = pt.subpathsOf(first);
  let owner = sps.map(() => 0);
  others.forEach((m, k) => {
    const conv = (v: Vec) => worldToPath(first, pathToWorld(m, v));
    for (const sp of pt.subpathsOf(m)) {
      sps.push({
        closed: sp.closed,
        anchors: sp.anchors.map((a) => {
          const q = conv(a);
          return { x: q.x, y: q.y, in: a.in && conv(a.in), out: a.out && conv(a.out) };
        }),
      });
      owner.push(k + 1);
    }
  });
  let joinedAny = false;
  for (let round = 0; round < others.length; round++) {
    // Extrémités les plus proches entre le premier objet (déjà joint) et un autre.
    let best: { a: string; b: string; d: number; o: number } | null = null;
    for (let i = 0; i < sps.length; i++) {
      const sa = sps[i];
      if (owner[i] !== 0 || sa.closed) continue;
      for (let j = 0; j < sps.length; j++) {
        const sb = sps[j];
        if (owner[j] === 0 || sb.closed) continue;
        for (const ia of [0, sa.anchors.length - 1])
          for (const ib of [0, sb.anchors.length - 1]) {
            const d = Math.hypot(sa.anchors[ia].x - sb.anchors[ib].x, sa.anchors[ia].y - sb.anchors[ib].y);
            if (!best || d < best.d) best = { a: anchorKey(i, ia), b: anchorKey(j, ib), d, o: owner[j] };
          }
      }
    }
    if (!best) break;
    const { a, b, o } = best;
    const [sa] = parseAnchorKey(a),
      [sb] = parseAnchorKey(b);
    const joined = joinEnds(sps, a, b);
    if (!joined) break;
    joinedAny = true;
    owner = owner.flatMap((w, i) => (i === sb ? [] : [w === o || i === sa ? 0 : w]));
    sps = joined;
  }
  if (!joinedAny) {
    toast(t('node.joinNothing'));
    return;
  }
  const node = structuredClone(first);
  writePath(node, sps);
  editor.apply('history.join', (d) => {
    const loc = findNode(d, first.id);
    if (!loc) return;
    loc.parent.children.splice(loc.index, 1, node);
    removeNodes(
      d,
      others.map((m) => m.id),
    );
    return [node.id];
  });
}
