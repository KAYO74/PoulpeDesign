import {
  alignNodes,
  boxCenter,
  clearRunKeys,
  cloneWithNewIds,
  createArtboard,
  createGroup,
  createImage,
  distributeNodes,
  findArtboard,
  findNode,
  groupNodes,
  newId,
  nodeBounds,
  removeNodes,
  reorderNodes,
  rotateNode,
  scaleNode,
  selectionBounds,
  topLevelIds,
  translateNode,
  ungroupNode,
  walkDocument,
  type AlignMode,
  type Artboard,
  type Cmyk,
  type Paint,
  type PoulpeDocument,
  type SceneNode,
  type TextStyle,
  type ZOrder,
  isStyled,
} from '@poulpe/core';
import { t } from './i18n';
import { applyEditingStyle, endTextEdit, isEditingText } from './canvas/textEdit';
import { fillFrame, frameTarget } from './libraryActions';
import { editor, ui } from './store';
import { recordStep } from './macros/recorder';

/*
 * Actions de l'éditeur, partagées par les menus, la barre d'outils, les panneaux et les raccourcis.
 * Chacune passe par `editor.apply`, donc s'annule.
 */

const sel = () => editor.selection;

function editableIds(doc: PoulpeDocument, ids: string[]): string[] {
  return ids.filter((id) => {
    const n = findNode(doc, id)?.node;
    return n && !n.locked;
  });
}

export function deleteSelection(): void {
  const ids = sel();
  if (!ids.length) return;
  editor.apply('history.delete', (d) => {
    removeNodes(d, editableIds(d, ids));
    return [];
  });
}

export function duplicateSelection(offset = 20): void {
  const ids = sel();
  if (!ids.length) return;
  editor.apply('history.duplicate', (d) => {
    const created: string[] = [];
    for (const id of topLevelIds(d, ids)) {
      const loc = findNode(d, id)!;
      const copy = cloneWithNewIds(loc.node as SceneNode);
      copy.name = t('name.copy', { name: loc.node.name });
      translateNode(copy, offset, offset);
      loc.parent.children.splice(loc.parent.children.indexOf(loc.node) + 1, 0, copy);
      created.push(copy.id);
    }
    return created;
  });
}

let clipboard: { nodes: SceneNode[]; assets: PoulpeDocument['assets'] } | null = null;

export function copySelection(): void {
  const doc = editor.doc;
  const ids = topLevelIds(doc, sel());
  if (!ids.length) return;
  const nodes = ids.map((id) => structuredClone(findNode(doc, id)!.node) as SceneNode);
  const assets: PoulpeDocument['assets'] = {};
  const collect = (n: SceneNode) => {
    if (n.type === 'image' && doc.assets[n.assetId]) assets[n.assetId] = doc.assets[n.assetId];
    if (n.mask && doc.assets[n.mask.assetId]) assets[n.mask.assetId] = doc.assets[n.mask.assetId];
    if (n.type === 'group') n.children.forEach(collect);
  };
  nodes.forEach(collect);
  clipboard = { nodes, assets };
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

export function hasClipboard(): boolean {
  return clipboard !== null;
}

export function paste(): void {
  if (!clipboard) return;
  const clip = clipboard;
  const abId = editor.getState().activeArtboardId;
  editor.apply('history.paste', (d) => {
    Object.assign(d.assets, clip.assets);
    const ab = findArtboard(d, abId) ?? d.artboards[0];
    if (!ab) return;
    const created = clip.nodes.map((n) => {
      const copy = cloneWithNewIds(n);
      translateNode(copy, 20, 20);
      ab.children.push(copy);
      return copy.id;
    });
    return created;
  });
}

export function selectAll(): void {
  const ab = findArtboard(editor.doc, editor.getState().activeArtboardId);
  if (ab) editor.select(ab.children.filter((n) => !n.locked && n.visible).map((n) => n.id));
}

export function groupSelection(): void {
  const ids = sel();
  if (!ids.length) return;
  editor.apply('history.group', (d) => {
    const id = groupNodes(d, ids, createGroup([], t('name.group')));
    return id ? [id] : undefined;
  });
}

export function ungroupSelection(): void {
  const ids = sel();
  editor.apply('history.ungroup', (d) => {
    const out: string[] = [];
    for (const id of ids) {
      const n = findNode(d, id)?.node;
      if (n?.type === 'group') out.push(...ungroupNode(d, id));
      else out.push(id);
    }
    return out;
  });
}

/** Groupe la sélection et transforme l'objet du dessous en masque d'écrêtage (ou retire le masque). */
export function toggleClipMask(): void {
  const ids = sel();
  const only = ids.length === 1 ? findNode(editor.doc, ids[0])?.node : null;
  if (only?.type === 'group') {
    editor.apply('history.clip', (d) => {
      const g = findNode(d, only.id)!.node;
      if (g.type === 'group') g.clip = !g.clip;
    });
    return;
  }
  if (ids.length < 2) return;
  editor.apply('history.clip', (d) => {
    const g = createGroup([], t('name.group'));
    g.clip = true;
    const id = groupNodes(d, ids, g);
    return id ? [id] : undefined;
  });
}

export function reorder(order: ZOrder): void {
  const ids = sel();
  if (ids.length) editor.apply('history.order', (d) => void reorderNodes(d, ids, order));
}

export function align(mode: AlignMode): void {
  const ids = sel();
  if (ids.length) editor.apply('history.align', (d) => void alignNodes(d, editableIds(d, ids), mode));
}

export function distribute(axis: 'h' | 'v'): void {
  const ids = sel();
  if (ids.length > 2)
    editor.apply('history.align', (d) => void distributeNodes(d, editableIds(d, ids), axis));
}

export function rotateSelection(deg: number): void {
  const ids = sel();
  const b = selectionBounds(editor.doc, ids);
  if (!b) return;
  const c = boxCenter(b);
  editor.apply('history.rotate', (d) => {
    for (const id of topLevelIds(d, editableIds(d, ids))) rotateNode(findNode(d, id)!.node, deg, c);
  });
}

export function flipSelection(axis: 'h' | 'v'): void {
  const ids = sel();
  const b = selectionBounds(editor.doc, ids);
  if (!b) return;
  const c = boxCenter(b);
  editor.apply('history.flip', (d) => {
    for (const id of topLevelIds(d, editableIds(d, ids))) {
      const n = findNode(d, id)!.node;
      scaleNode(n, axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1, c);
      const mirror = (m: SceneNode) => {
        if (m.type === 'group') m.children.forEach(mirror);
        else m.rotation = -m.rotation;
      };
      mirror(n);
    }
  });
}

export function nudge(dx: number, dy: number): void {
  const ids = sel();
  if (!ids.length) return;
  recordStep({ kind: 'nudge', dx, dy });
  editor.apply('history.move', (d) => {
    for (const id of topLevelIds(d, editableIds(d, ids))) translateNode(findNode(d, id)!.node, dx, dy);
  });
}

/** Modifie une propriété de chaque objet sélectionné (et des objets des groupes sélectionnés). */
export function updateSelected(
  label: string,
  fn: (n: SceneNode) => void,
  opts: { deep?: boolean } = {},
): void {
  const ids = sel();
  if (!ids.length) return;
  editor.apply(label, (d) => {
    for (const id of ids) {
      const n = findNode(d, id)?.node;
      if (!n) continue;
      const visit = (m: SceneNode) => {
        if (m.type === 'group' && opts.deep) m.children.forEach(visit);
        else fn(m);
      };
      visit(n);
    }
  });
}

/** Couleur choisie en CMJN pendant `withCmyk` : ses valeurs exactes vont dans le document. */
let cmykNote: { hex: string; value: Cmyk } | null = null;

/** Exécute un changement de couleur en retenant les valeurs CMJN exactes de la nouvelle couleur. */
export function withCmyk(hex: string, value: Cmyk, fn: () => void): void {
  cmykNote = { hex: hex.toLowerCase(), value };
  try {
    fn();
  } finally {
    // Changement qui n'est pas passé par un objet (édition de texte, réglage par défaut).
    if (cmykNote) editor.apply('history.style', recordCmyk);
    cmykNote = null;
  }
}

function recordCmyk(doc: PoulpeDocument): void {
  if (!cmykNote) return;
  doc.layout ??= {};
  const map = { ...(doc.layout.cmyk ?? {}) };
  delete map[cmykNote.hex];
  map[cmykNote.hex] = cmykNote.value;
  // On garde les 200 dernières couleurs choisies en CMJN.
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete map[k];
  doc.layout.cmyk = map;
}

export function setPaint(target: 'fill' | 'stroke', paint: Paint, gesture = false): void {
  if (isEditingText()) {
    // Pendant l'édition d'un texte, une couleur unie va aux caractères sélectionnés.
    if (target === 'fill' && paint.type === 'solid' && applyEditingStyle({ color: paint.color })) return;
    endTextEdit();
  }
  // La couleur choisie reste celle des prochains objets, même après un changement d'outil (comme Affinity).
  const d = ui.get().defaults;
  ui.set({
    defaults: target === 'fill' ? { ...d, fill: paint } : { ...d, stroke: { ...d.stroke, paint } },
    ...(target === 'fill' && paint.type === 'solid' ? { brushColor: paint.color } : {}),
  });
  const ids = sel();
  if (!ids.length) return;
  const recipe = (doc: PoulpeDocument) => {
    for (const id of ids) {
      const visit = (m: SceneNode) => {
        if (m.type === 'group') return m.children.forEach(visit);
        if (!isStyled(m)) return;
        if (target === 'fill') {
          m.fill = paint;
          if (m.type === 'text' && m.runs) m.runs = clearRunKeys(m.runs, ['color'], m.style, m.text.length);
        } else m.stroke = { ...m.stroke, paint };
      };
      const n = findNode(doc, id)?.node;
      if (n) visit(n);
    }
    if (cmykNote) {
      recordCmyk(doc);
      cmykNote = null;
    }
  };
  if (gesture) editor.preview(recipe);
  else editor.apply('history.style', recipe);
}

export function setTextStyle(patch: Partial<TextStyle>): void {
  if (applyEditingStyle(patch)) return;
  const ids = sel();
  const texts = ids.filter((id) => findNode(editor.doc, id)?.node.type === 'text');
  if (!texts.length) {
    const d = ui.get().defaults;
    ui.set({ defaults: { ...d, text: { ...d.text, ...patch } } });
    return;
  }
  editor.apply('history.text', (d) => {
    for (const id of texts) {
      const n = findNode(d, id)!.node;
      if (n.type === 'text') {
        n.style = { ...n.style, ...patch };
        // Appliqué au texte entier, le réglage remplace celui des plages.
        if (n.runs) n.runs = clearRunKeys(n.runs, Object.keys(patch), n.style, n.text.length);
      }
    }
  });
}

export function addArtboard(width?: number, height?: number): void {
  const doc = editor.doc;
  const last = doc.artboards[doc.artboards.length - 1];
  const w = width ?? last?.width ?? 1080;
  const h = height ?? last?.height ?? 1080;
  const x = last ? last.x + last.width + 100 : 0;
  const y = last ? last.y : 0;
  const ab = createArtboard({
    x,
    y,
    width: w,
    height: h,
    name: t('name.artboard', { n: doc.artboards.length + 1 }),
  });
  editor.apply('history.artboard', (d) => {
    d.artboards.push(ab);
    return [];
  });
  editor.setActiveArtboard(ab.id);
}

export function deleteArtboard(id = editor.getState().activeArtboardId): void {
  if (editor.doc.artboards.length <= 1) return;
  editor.apply('history.artboard', (d) => {
    d.artboards = d.artboards.filter((a) => a.id !== id);
    return [];
  });
}

export function updateArtboard(id: string, patch: Partial<Artboard>, gesture = false): void {
  const recipe = (d: PoulpeDocument) => {
    const ab = findArtboard(d, id);
    if (!ab) return;
    if (patch.x !== undefined || patch.y !== undefined) {
      const dx = (patch.x ?? ab.x) - ab.x,
        dy = (patch.y ?? ab.y) - ab.y;
      ab.children.forEach((n) => translateNode(n, dx, dy));
    }
    Object.assign(ab, patch);
  };
  if (gesture) editor.preview(recipe);
  else editor.apply('history.artboard', recipe);
}

/**
 * Place une image au centre du plan de travail actif, à une taille raisonnable. Déposée sur un
 * cadre photo (ou importée quand un cadre est sélectionné), elle remplit ce cadre.
 */
export function placeImage(
  data: string,
  mime: string,
  width: number,
  height: number,
  at?: { x: number; y: number },
): void {
  const doc = editor.doc;
  const assetId = newId('img');
  const frame = frameTarget(doc, at);
  if (frame) {
    editor.apply('history.image', (d) => {
      d.assets[assetId] = { id: assetId, mime, width, height, data };
      const id = fillFrame(frame, assetId, width, height, d);
      return id ? [id] : undefined;
    });
    ui.set({ tool: 'select' });
    return;
  }
  const ab = findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0];
  if (!ab) return;
  const k = Math.min(1, (ab.width * 0.8) / width, (ab.height * 0.8) / height);
  const w = width * k,
    h = height * k;
  const cx = at?.x ?? ab.x + ab.width / 2,
    cy = at?.y ?? ab.y + ab.height / 2;
  const node = createImage({
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
    assetId,
    name: t('name.image'),
  });
  editor.apply('history.image', (d) => {
    d.assets[assetId] = { id: assetId, mime, width, height, data };
    findArtboard(d, ab.id)!.children.push(node);
    return [node.id];
  });
  ui.set({ tool: 'select' });
}

export function addSwatch(color: string): void {
  if (editor.doc.swatches.includes(color)) return;
  editor.apply('history.swatch', (d) => void d.swatches.push(color));
}

export function removeSwatch(color: string): void {
  editor.apply('history.swatch', (d) => {
    d.swatches = d.swatches.filter((c) => c !== color);
  });
}

/** Le premier objet sélectionné, s'il existe. */
export function primarySelected(doc: PoulpeDocument, ids: string[]): SceneNode | null {
  return ids.length ? (findNode(doc, ids[0])?.node ?? null) : null;
}

export function boundsOf(doc: PoulpeDocument, ids: string[]) {
  return ids.length === 1 ? nodeBounds(findNode(doc, ids[0])!.node) : selectionBounds(doc, ids);
}

export function allNodes(doc: PoulpeDocument): SceneNode[] {
  return [...walkDocument(doc)].map((l) => l.node);
}
