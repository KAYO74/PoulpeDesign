import {
  applyAdjustment,
  autoLevels,
  createAdjustment,
  createDocument,
  createImage,
  defaultAdjustment,
  findArtboard,
  findNode,
  newId,
  type Adjustment,
  type AdjustmentKind,
  type AdjustmentNode,
  type PoulpeDocument,
  type SceneNode,
} from '@poulpe/core';
import { drawArtboard, drawNode, registerBitmap, setLiveBitmap } from '@poulpe/render';
import { getController } from '../components/Viewport';
import { t } from '../i18n';
import { editor, toast, ui } from '../store';
import {
  commitBitmap,
  copyDrawable,
  docToMask,
  docToPixels,
  images,
  localToDoc,
  makeCanvas,
  maskOf,
  maskSize,
  pixelsOf,
  pruneAssets,
  selectedImage,
} from './pixels';
import { clearSelection, getSelection, selectionIn, selectAll } from './selection';
import { recordStep } from '../macros/recorder';
import { nativeApply } from '../engine';

/*
 * Commandes de la Persona Photo : masques, calques de réglage, filtres appliqués aux pixels,
 * pixellisation, ouverture d'une photo.
 */

export function selectedNode(): SceneNode | null {
  if (editor.selection.length !== 1) return null;
  return findNode(editor.doc, editor.selection[0])?.node ?? null;
}

export function selectedAdjustment(): AdjustmentNode | null {
  const n = selectedNode();
  return n?.type === 'adjustment' ? n : null;
}

// ————— Masques —————

export function canAddMask(): boolean {
  const n = selectedNode();
  return !!n && n.type !== 'group' && !n.mask && !n.locked;
}

/**
 * Ajoute un masque de calque. S'il y a une sélection de pixels, seule la sélection reste visible
 * (comme dans Affinity et Photoshop) ; sinon le masque est blanc (tout visible).
 */
export function addMask(nodeId = editor.selection[0]): void {
  const n = nodeId ? findNode(editor.doc, nodeId)?.node : null;
  if (!n || n.type === 'group' || n.mask) return;
  const { width, height } = maskSize(n);
  const fromSel = selectionIn(width, height, docToMask(n, width, height));
  const canvas = fromSel ?? makeCanvas(width, height);
  if (!fromSel) {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  commitBitmap(n.id, 'mask', canvas, 'history.addMask');
  if (fromSel) clearSelection(false);
}

export function hasMask(): boolean {
  return !!selectedNode()?.mask;
}

export function removeMask(): void {
  const n = selectedNode();
  if (!n?.mask) return;
  if (ui.get().maskEditId === n.id) ui.set({ maskEditId: null });
  editor.apply('history.removeMask', (d) => {
    const m = findNode(d, n.id)?.node;
    if (m) delete m.mask;
    pruneAssets(d);
  });
}

export function toggleMask(): void {
  const n = selectedNode();
  if (!n?.mask) return;
  editor.apply('history.toggleMask', (d) => {
    const m = findNode(d, n.id)?.node;
    if (m?.mask) m.mask = { ...m.mask, enabled: !m.mask.enabled };
  });
}

export function invertMask(): void {
  const n = selectedNode();
  if (!n?.mask) return;
  const src = maskOf(n);
  if (!src) return;
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(src, 0, 0);
  commitBitmap(n.id, 'mask', out, 'history.invertMask');
}

/** Peindre dans le masque du calque sélectionné (ou revenir à ses pixels). */
export function toggleMaskEdit(id: string | null = editor.selection[0] ?? null): void {
  const cur = ui.get().maskEditId;
  if (!id || cur === id) {
    ui.set({ maskEditId: null });
    return;
  }
  const n = findNode(editor.doc, id)?.node;
  if (!n || n.type === 'group') return;
  if (!n.mask) addMask(id);
  ui.set({ maskEditId: id });
}

// ————— Calques de réglage —————

/**
 * Ajoute un calque de réglage au-dessus de la sélection (ou en haut du plan de travail actif).
 * Avec une sélection de pixels, le réglage ne s'applique qu'à la sélection.
 */
export function addAdjustment(
  kind: AdjustmentKind,
  adjustment: Adjustment = defaultAdjustment(kind),
  name: string = t(`adjust.${kind}`),
): void {
  const doc = editor.doc;
  const loc = editor.selection.length ? findNode(doc, editor.selection[editor.selection.length - 1]) : null;
  const ab = loc?.artboard ?? findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0];
  if (!ab) return;
  // Dans un groupe, le réglage couvre le groupe ; sinon le plan de travail.
  const parent = loc && loc.parent !== ab ? (loc.parent as SceneNode) : null;
  const box = parent ?? ab;
  const node = createAdjustment({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    adjustment,
    name,
  });
  const sel = getSelection();
  let maskCanvas: HTMLCanvasElement | null = null;
  if (sel) {
    const { width, height } = maskSize(node);
    maskCanvas = selectionIn(width, height, docToMask(node, width, height));
  }
  const key = maskCanvas ? registerBitmap(maskCanvas) : null;
  editor.apply('history.addAdjustment', (d) => {
    if (maskCanvas && key) {
      const id = newId('img');
      d.assets[id] = { id, mime: 'image/png', width: maskCanvas.width, height: maskCanvas.height, data: key };
      node.mask = { assetId: id, enabled: true };
    }
    const l = loc ? findNode(d, loc.node.id) : null;
    if (l) l.parent.children.splice(l.index + 1, 0, node);
    else findArtboard(d, ab.id)!.children.push(node);
    return [node.id];
  });
  recordStep({ kind: 'adjustment', adjustment, nodeId: node.id });
  if (sel) clearSelection(false);
}

let adjustTimer: ReturnType<typeof setTimeout> | undefined;

/** Modifie le réglage d'un calque ; `live` : aperçu pendant un glissement, validé peu après. */
export function setAdjustment(id: string, patch: Partial<Adjustment>, live = false): void {
  const recipe = (d: PoulpeDocument) => {
    const n = findNode(d, id)?.node;
    if (n?.type === 'adjustment') n.adjustment = { ...n.adjustment, ...patch } as Adjustment;
  };
  if (live) {
    editor.preview(recipe);
    clearTimeout(adjustTimer);
    adjustTimer = setTimeout(() => editor.commit('history.adjustment'), 400);
  } else editor.apply('history.adjustment', recipe);
}

/** Rendu du plan de travail actif sous un objet (pour l'histogramme et les niveaux automatiques). */
export function renderBelow(maxSide = 512, stopAt?: string): ImageData | null {
  const doc = editor.doc;
  const loc = stopAt ? findNode(doc, stopAt) : null;
  const ab = loc?.artboard ?? findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0];
  if (!ab) return null;
  const k = Math.min(1, maxSide / Math.max(ab.width, ab.height));
  const c = makeCanvas(ab.width * k, ab.height * k);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(k, k);
  ctx.translate(-ab.x, -ab.y);
  if (loc) {
    // Seulement ce qui est sous le calque : on cache le calque et ceux du dessus.
    const hidden = new Set<string>();
    const ids = loc.parent.children.slice(loc.index).map((n) => n.id);
    ids.forEach((id) => hidden.add(id));
    drawArtboard(ctx, doc, ab, { images: images(), hidden });
  } else drawArtboard(ctx, doc, ab, { images: images() });
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Niveaux automatiques : un calque Niveaux réglé d'après l'image. */
export function addAutoLevels(): void {
  const px = renderBelow(512);
  if (!px) return;
  addAdjustment('levels', autoLevels({ data: px.data, width: px.width, height: px.height }));
}

// ————— Filtres appliqués aux pixels —————

export function canFilter(): boolean {
  return selectedImage() !== null;
}

/** Pixels du calque sélectionné, prêts à recevoir un filtre (limité à la sélection de pixels). */
function prepareFilter() {
  const node = selectedImage();
  if (!node) return null;
  const base = pixelsOf(node);
  if (!base) return null;
  const W = base.width,
    H = base.height;
  const toPx = docToPixels(node, W, H);
  const scale = Math.sqrt(Math.abs(toPx.a * toPx.d - toPx.b * toPx.c)) || 1;
  const ctx = base.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, W, H);
  const ab = findNode(editor.doc, node.id)?.artboard;
  let frame: { x: number; y: number; width: number; height: number } | undefined;
  if (ab) {
    const p0 = toPx.transformPoint(new DOMPoint(ab.x, ab.y));
    const p1 = toPx.transformPoint(new DOMPoint(ab.x + ab.width, ab.y + ab.height));
    frame = {
      x: Math.min(p0.x, p1.x),
      y: Math.min(p0.y, p1.y),
      width: Math.abs(p1.x - p0.x),
      height: Math.abs(p1.y - p0.y),
    };
  }
  const o = toPx.transformPoint(new DOMPoint(0, 0));
  const opts = { scale, origin: { x: o.x, y: o.y }, frame };
  /** Mélange le résultat avec l'original hors de la sélection, et en fait une toile. */
  const finish = (out: Uint8ClampedArray<ArrayBuffer>) => {
    const sel = selectionIn(W, H, toPx);
    if (sel) {
      const sd = sel.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const k = sd[i + 3] / 255;
        out[i] = d[i] + (out[i] - d[i]) * k;
        out[i + 1] = d[i + 1] + (out[i + 1] - d[i + 1]) * k;
        out[i + 2] = d[i + 2] + (out[i + 2] - d[i + 2]) * k;
        out[i + 3] = d[i + 3];
      }
    }
    const canvas = makeCanvas(W, H);
    canvas.getContext('2d')!.putImageData(new ImageData(out, W, H), 0, 0);
    return { nodeId: node.id, assetId: node.assetId, canvas };
  };
  return { node, img, W, H, opts, finish };
}

/** Pixels du calque sélectionné après le filtre (limité à la sélection de pixels). */
export function filteredPixels(
  adj: Adjustment,
): { nodeId: string; assetId: string; canvas: HTMLCanvasElement } | null {
  const p = prepareFilter();
  if (!p) return null;
  const out = new Uint8ClampedArray(p.img.data);
  applyAdjustment({ data: out, width: p.W, height: p.H }, adj, p.opts);
  return p.finish(out);
}

/**
 * Comme `filteredPixels`, mais dans l'appli de bureau une grande image est calculée par le
 * moteur Rust natif (carte graphique ou tous les cœurs), sans figer l'interface. Null si l'image
 * a changé entre-temps.
 */
async function filteredPixelsAsync(
  adj: Adjustment,
): Promise<{ nodeId: string; assetId: string; canvas: HTMLCanvasElement } | null> {
  const p = prepareFilter();
  if (!p) return null;
  const out = new Uint8ClampedArray(p.img.data);
  const px = { data: out, width: p.W, height: p.H };
  if (!(await nativeApply(px, adj, p.opts))) return filteredPixels(adj);
  // Pendant le calcul, l'image a pu être modifiée ou désélectionnée : le résultat ne vaut plus.
  if (selectedImage()?.assetId !== p.node.assetId) return null;
  return p.finish(out);
}

let previewToken = 0;

export function previewFilter(adj: Adjustment | null): void {
  const node = selectedImage();
  if (!node) return;
  if (!adj) {
    previewToken++;
    setLiveBitmap(node.assetId, null);
    return;
  }
  const token = ++previewToken;
  void filteredPixelsAsync(adj).then((r) => {
    // Un aperçu plus récent (ou sa fermeture) a pris la place de celui-ci.
    if (token !== previewToken) return;
    if (r) setLiveBitmap(r.assetId, r.canvas);
    getController()?.requestDraw();
  });
}

/** Applique le filtre au calque d'image choisi (une étape d'historique). */
export async function applyFilter(adj: Adjustment): Promise<void> {
  previewToken++;
  const r = await filteredPixelsAsync(adj);
  if (!r) return;
  recordStep({ kind: 'filter', adjustment: adj });
  setLiveBitmap(r.assetId, null);
  commitBitmap(r.nodeId, 'pixels', r.canvas, 'history.filter');
}

// ————— Pixels et sélection —————

/** Efface les pixels sélectionnés du calque choisi. Renvoie false s'il n'y a rien à faire. */
export function clearSelectedPixels(): boolean {
  const node = selectedImage();
  if (!node || !getSelection()) return false;
  const base = pixelsOf(node);
  if (!base) return false;
  const sel = selectionIn(base.width, base.height, docToPixels(node, base.width, base.height));
  if (!sel) return false;
  const ctx = base.getContext('2d')!;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(sel, 0, 0);
  commitBitmap(node.id, 'pixels', base, 'history.clearPixels');
  return true;
}

/** Copie les pixels sélectionnés du calque choisi sur un nouveau calque, juste au-dessus. */
export function copySelectionToLayer(): boolean {
  const node = selectedImage();
  if (!node || !getSelection()) return false;
  const base = pixelsOf(node);
  if (!base) return false;
  const sel = selectionIn(base.width, base.height, docToPixels(node, base.width, base.height));
  if (!sel) return false;
  const ctx = base.getContext('2d')!;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(sel, 0, 0);
  const key = registerBitmap(base);
  editor.apply('history.copyToLayer', (d) => {
    const loc = findNode(d, node.id);
    if (!loc) return;
    const id = newId('img');
    d.assets[id] = { id, mime: 'image/png', width: base.width, height: base.height, data: key };
    const copy = {
      ...structuredClone(loc.node as typeof node),
      id: newId('node'),
      assetId: id,
      name: t('name.pixelLayer'),
    };
    delete copy.mask;
    loc.parent.children.splice(loc.index + 1, 0, copy);
    return [copy.id];
  });
  clearSelection(false);
  return true;
}

export function canRasterize(): boolean {
  const n = selectedNode();
  return !!n && n.type !== 'image' && n.type !== 'adjustment';
}

/** Pixellise l'objet sélectionné : il devient un calque de pixels (effets et masque compris). */
export function rasterizeSelection(): void {
  const n = selectedNode();
  if (!n || n.type === 'image' || n.type === 'adjustment') return;
  const loc = findNode(editor.doc, n.id)!;
  const ab = loc.artboard;
  const k = Math.min(2, 8192 / Math.max(ab.width, ab.height));
  const canvas = makeCanvas(ab.width * k, ab.height * k);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(k, k);
  ctx.translate(-ab.x, -ab.y);
  drawNode(ctx, editor.doc, n, { images: images() });
  const key = registerBitmap(canvas);
  editor.apply('history.rasterize', (d) => {
    const l = findNode(d, n.id);
    if (!l) return;
    const id = newId('img');
    d.assets[id] = { id, mime: 'image/png', width: canvas.width, height: canvas.height, data: key };
    const img = createImage({
      x: ab.x,
      y: ab.y,
      width: ab.width,
      height: ab.height,
      assetId: id,
      name: n.name,
    });
    l.parent.children.splice(l.index, 1, img);
    pruneAssets(d);
    return [img.id];
  });
}

/** Fusionner le visible : un nouveau calque de pixels avec l'image du plan de travail actif. */
export function mergeVisible(): void {
  const doc = editor.doc;
  const ab = findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0];
  if (!ab) return;
  let k = 1;
  for (const id of Object.keys(doc.assets)) {
    const a = doc.assets[id];
    k = Math.max(k, Math.min(a.width / ab.width, a.height / ab.height));
  }
  k = Math.min(k, 8192 / Math.max(ab.width, ab.height));
  const canvas = makeCanvas(ab.width * k, ab.height * k);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(k, k);
  ctx.translate(-ab.x, -ab.y);
  drawArtboard(ctx, doc, ab, { images: images(), background: false });
  const key = registerBitmap(canvas);
  editor.apply('history.mergeVisible', (d) => {
    const id = newId('img');
    d.assets[id] = { id, mime: 'image/png', width: canvas.width, height: canvas.height, data: key };
    const img = createImage({
      x: ab.x,
      y: ab.y,
      width: ab.width,
      height: ab.height,
      assetId: id,
      name: t('name.merged'),
    });
    findArtboard(d, ab.id)!.children.push(img);
    return [img.id];
  });
}

/** Ouvre une photo dans un nouveau document à sa taille, en Persona Photo. */
export function openPhotoDocument(
  data: string,
  mime: string,
  width: number,
  height: number,
  name: string,
): void {
  const doc = createDocument({ name, width, height });
  doc.artboards[0].name = name;
  const id = newId('img');
  doc.assets[id] = { id, mime, width, height, data };
  doc.artboards[0].children.push(
    createImage({ x: 0, y: 0, width, height, assetId: id, name: t('name.background') }),
  );
  editor.load(doc);
  clearSelection(false);
  ui.set({ filePath: null, dialog: null, persona: 'photo', tool: 'brush', maskEditId: null });
  requestAnimationFrame(() => window.dispatchEvent(new Event('poulpe:fit')));
}

export { selectAll, copyDrawable, localToDoc, toast };
