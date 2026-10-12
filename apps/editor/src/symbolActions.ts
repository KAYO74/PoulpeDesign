import {
  applyStyle,
  styledChildren,
  cloneSymbolNodes,
  createSymbolInstance,
  findArtboard,
  findNode,
  findStyle,
  findSymbol,
  insertNode,
  newId,
  removeNodes,
  selectionBounds,
  styleFromNode,
  symbolContent,
  symbolInstances,
  topLevelIds,
  type SavedStyle,
  type SceneNode,
  type SymbolNode,
} from '@poulpe/core';
import { t } from './i18n';
import { editor, toast } from './store';

/*
 * Symboles et styles enregistrés. Un symbole range son contenu une fois dans le document ; ses
 * instances l'affichent et suivent ses modifications. Un style met l'apparence d'un objet de côté
 * pour l'appliquer ailleurs d'un clic.
 */

const sel = () => editor.selection;

export function canMakeSymbol(): boolean {
  return topLevelIds(editor.doc, sel()).length > 0;
}

/** Transforme la sélection en symbole : son contenu est rangé, une instance le remplace. */
export function createSymbol(): void {
  const doc = editor.doc;
  const ids = topLevelIds(doc, sel());
  if (!ids.length) return;
  const box = selectionBounds(doc, ids);
  if (!box) return;
  const count = Object.keys(doc.symbols ?? {}).length + 1;
  const name = t('name.symbol', { n: count });
  const symbolId = newId('sym');
  editor.apply('history.createSymbol', (d) => {
    const parent = d.artboards.find((ab) => ab.children.some((c) => ids.includes(c.id)));
    const index = parent ? parent.children.findIndex((c) => ids.includes(c.id)) : 0;
    const taken = removeNodes(d, ids);
    if (!taken.length) return;
    d.symbols = {
      ...(d.symbols ?? {}),
      [symbolId]: { id: symbolId, name, box: { ...box }, children: taken },
    };
    const node = createSymbolInstance({ ...box, name, symbolId });
    insertNode(parent ?? d.artboards[0], node, Math.max(0, index));
    return [node.id];
  });
  toast(t('vector.symbolCreated', { name }));
}

/** Pose une nouvelle instance d'un symbole, décalée pour rester visible. */
export function placeSymbol(symbolId: string): void {
  const doc = editor.doc;
  const sym = findSymbol(doc, symbolId);
  if (!sym) return;
  const n = symbolInstances(doc, symbolId).length;
  const offset = (n % 8) * 16;
  const ab = findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0];
  const node = createSymbolInstance({
    x: sym.box.x + offset,
    y: sym.box.y + offset,
    width: sym.box.width,
    height: sym.box.height,
    name: sym.name,
    symbolId,
  });
  editor.apply('history.placeSymbol', (d) => {
    insertNode(findArtboard(d, ab.id) ?? d.artboards[0], node);
    return [node.id];
  });
}

function instancesInSelection(): SymbolNode[] {
  const doc = editor.doc;
  return sel()
    .map((id) => findNode(doc, id)?.node)
    .filter((n): n is SymbolNode => n?.type === 'symbol');
}

export function canDetachSymbol(): boolean {
  return instancesInSelection().length > 0;
}

/** Détache les instances sélectionnées : leur contenu redevient des objets ordinaires. */
export function detachSymbol(): void {
  const doc = editor.doc;
  const targets = instancesInSelection().map((n) => ({
    id: n.id,
    children: cloneSymbolNodes(symbolContent(doc, n)),
  }));
  if (!targets.length) return;
  const made: string[] = [];
  editor.apply('history.detachSymbol', (d) => {
    for (const { id, children } of targets) {
      const loc = findNode(d, id);
      if (!loc) continue;
      const index = loc.parent.children.findIndex((c) => c.id === id);
      loc.parent.children.splice(index, 1, ...(children as SceneNode[]));
      made.push(...children.map((c) => c.id));
    }
    return made;
  });
}

export function canUpdateSymbol(): boolean {
  return instancesInSelection().length === 1;
}

/**
 * Enregistre dans le symbole le contenu de l'instance sélectionnée, telle qu'elle est à l'écran.
 * Les autres instances suivent aussitôt.
 */
export function updateSymbol(): void {
  const doc = editor.doc;
  const node = instancesInSelection()[0];
  if (!node) return;
  const sym = findSymbol(doc, node.symbolId);
  if (!sym) return;
  const children = cloneSymbolNodes(symbolContent(doc, node));
  editor.apply('history.updateSymbol', (d) => {
    const s = d.symbols?.[node.symbolId];
    if (!s) return;
    s.children = children as SceneNode[];
    s.box = { x: node.x, y: node.y, width: node.width, height: node.height };
  });
  toast(t('vector.symbolUpdated', { n: symbolInstances(doc, node.symbolId).length }));
}

export function renameSymbol(symbolId: string, name: string): void {
  editor.apply('history.rename', (d) => {
    const s = d.symbols?.[symbolId];
    if (s) s.name = name;
  });
}

/** Supprime un symbole et, avec lui, ses instances. */
export function deleteSymbol(symbolId: string): void {
  const ids = symbolInstances(editor.doc, symbolId).map((n) => n.id);
  editor.apply('history.delete', (d) => {
    if (ids.length) removeNodes(d, ids);
    if (d.symbols) delete d.symbols[symbolId];
    return [];
  });
}

// ————— Styles enregistrés —————

export function canSaveStyle(): boolean {
  return sel().length === 1;
}

/** Met l'apparence de l'objet sélectionné de côté, dans les styles du document. */
export function saveStyle(): void {
  const doc = editor.doc;
  const node = findNode(doc, sel()[0])?.node;
  if (!node) return;
  const name = t('name.style', { n: (doc.styles?.length ?? 0) + 1 });
  const style = styleFromNode(node, name);
  editor.apply('history.saveStyle', (d) => {
    d.styles = [...(d.styles ?? []), style];
  });
  toast(t('vector.styleSaved', { name }));
}

export function applySavedStyle(styleId: string): void {
  const ids = topLevelIds(editor.doc, sel());
  if (!ids.length) {
    toast(t('vector.styleNeedsSelection'));
    return;
  }
  // Le style est lu hors de la commande : dans le brouillon, ce ne serait pas un objet copiable.
  const style = findStyle(editor.doc, styleId);
  if (!style) return;
  const plain: SavedStyle = structuredClone(style);
  editor.apply('history.applyStyle', (d) => {
    // Le style s'applique aussi au contenu des groupes : c'est ce qu'on attend d'un clic dessus.
    const visit = (n: SceneNode) => {
      if (n.type === 'group') styledChildren(n).forEach(visit);
      else applyStyle(n, plain);
    };
    for (const id of ids) {
      const n = findNode(d, id)?.node;
      if (n) visit(n);
    }
  });
}

export function deleteStyle(styleId: string): void {
  editor.apply('history.delete', (d) => {
    d.styles = (d.styles ?? []).filter((s) => s.id !== styleId);
  });
}

export function renameStyle(styleId: string, name: string): void {
  editor.apply('history.rename', (d) => {
    const s = d.styles?.find((x) => x.id === styleId);
    if (s) s.name = name;
  });
}

/** Styles et symboles du document, pour les panneaux. */
export function documentSymbols() {
  const doc = editor.doc;
  return Object.values(doc.symbols ?? {});
}
