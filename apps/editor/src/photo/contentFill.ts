import { findNode, newId } from '@poulpe/core';
import { registerBitmap, setLiveBitmap } from '@poulpe/render';
import { getController } from '../components/Viewport';
import { t } from '../i18n';
import { editor, toast, ui } from '../store';
import { targetPixels } from './paintTarget';
import { computeInpaint, type InpaintSettings } from './photoFill';
import { commitBitmap, selectedImage } from './pixels';
import { clearSelection, getSelection, selectionIn } from './selection';

/*
 * Édition › Remplir d'après le contenu (Photoshop : Remplissage d'après le contenu) : la
 * sélection est reconstruite à partir de l'image autour, avec un aperçu dans le document. On
 * règle la zone où chercher, on tire d'autres variantes, et le résultat va dans le calque ou
 * sur un nouveau calque au-dessus.
 */

interface Session {
  nodeId: string;
  assetId: string;
  base: HTMLCanvasElement;
  cover: HTMLCanvasElement;
  result: HTMLCanvasElement | null;
  /** Calcul en cours : un calcul plus récent remplace celui-ci. */
  token: number;
}

let session: Session | null = null;

/** Ouvre la fenêtre (il faut une sélection de pixels sur un calque d'image). */
export function openContentFill(): void {
  const node = selectedImage();
  if (!node || !getSelection()) return;
  const px = targetPixels(node, 'pixels');
  if (!px) return;
  const cover = selectionIn(px.base.width, px.base.height, px.toPx);
  if (!cover) return;
  session = { nodeId: node.id, assetId: node.assetId, base: px.base, cover, result: null, token: 0 };
  ui.set({ dialog: 'contentFill' });
}

/** Calcule l'aperçu avec ces réglages et l'affiche dans le document. */
export async function previewContentFill(settings: InpaintSettings): Promise<boolean> {
  const s = session;
  if (!s) return false;
  const token = ++s.token;
  try {
    const out = await computeInpaint(s.base, s.cover, 100, settings);
    if (session !== s || token !== s.token) return false;
    s.result = out;
    setLiveBitmap(s.assetId, out);
    getController()?.requestDraw();
    return !!out;
  } catch {
    toast(t('photo.inpaintFailed'));
    return false;
  }
}

/** Ferme la fenêtre : garde le résultat (dans le calque ou sur un nouveau calque) ou l'oublie. */
export function closeContentFill(keep: boolean, newLayer = false): void {
  const s = session;
  session = null;
  ui.set({ dialog: null });
  if (!s) return;
  setLiveBitmap(s.assetId, null);
  getController()?.requestDraw();
  if (!keep || !s.result || !findNode(editor.doc, s.nodeId)) return;
  if (!newLayer) {
    commitBitmap(s.nodeId, 'pixels', s.result, 'history.contentFill');
    return;
  }
  // Nouveau calque : seulement les pixels reconstruits, au-dessus du calque d'origine.
  const out = s.result;
  const ctx = out.getContext('2d')!;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(s.cover, 0, 0);
  const key = registerBitmap(out);
  const source = findNode(editor.doc, s.nodeId)!.node;
  if (source.type !== 'image') return;
  const id = newId('img');
  const copy = { ...structuredClone(source), id: newId('node'), assetId: id, name: t('contentfill.layer') };
  editor.apply('history.contentFill', (d) => {
    const loc = findNode(d, s.nodeId);
    if (!loc) return;
    d.assets[id] = { id, mime: 'image/png', width: out.width, height: out.height, data: key };
    delete copy.mask;
    delete copy.filters;
    loc.parent.children.splice(loc.index + 1, 0, copy);
    return [copy.id];
  });
  clearSelection(false);
}
