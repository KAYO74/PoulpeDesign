import { findArtboard, newId, type AlphaChannel } from '@poulpe/core';
import { registerBitmap } from '@poulpe/render';
import { t } from '../i18n';
import { editor, type SelectionMode } from '../store';
import { renderBelow } from './photoActions';
import { images, makeCanvas, pruneAssets } from './pixels';
import { selectFromAlpha, selectionSnapshot } from './selection';

/*
 * Panneau Couches (Photoshop et Affinity) : les couches rouge, verte et bleue de l'image visible,
 * et les couches alpha, des sélections enregistrées dans le document. Chaque couche se recharge
 * comme sélection : une couche de couleur sélectionne d'après sa clarté.
 */

export type ColorChannel = 'rgb' | 'r' | 'g' | 'b';

/** Valeur d'une couche pour un pixel (RVB : luminosité). */
function channelValue(d: Uint8ClampedArray, i: number, ch: ColorChannel): number {
  if (ch === 'r') return d[i];
  if (ch === 'g') return d[i + 1];
  if (ch === 'b') return d[i + 2];
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

/** Aperçu d'une couche de couleur : en gris, ou en couleurs pour la couche composite RVB. */
export function channelPreview(px: ImageData, ch: ColorChannel): HTMLCanvasElement {
  const c = makeCanvas(px.width, px.height);
  const out = new ImageData(new Uint8ClampedArray(px.data), px.width, px.height);
  if (ch !== 'rgb') {
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = channelValue(px.data, i, ch);
  }
  c.getContext('2d')!.putImageData(out, 0, 0);
  return c;
}

/** Sélection d'après la clarté d'une couche de couleur de l'image visible du plan de travail actif. */
export function selectFromColorChannel(ch: ColorChannel, mode: SelectionMode): void {
  const ab = findArtboard(editor.doc, editor.getState().activeArtboardId) ?? editor.doc.artboards[0];
  const px = renderBelow(2048);
  if (!ab || !px) return;
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = (channelValue(d, i, ch) * d[i + 3]) / 255;
    d[i] = d[i + 1] = d[i + 2] = 0;
  }
  const c = makeCanvas(px.width, px.height);
  c.getContext('2d')!.putImageData(px, 0, 0);
  selectFromAlpha(c, ab, mode);
}

/** Enregistre la sélection comme nouvelle couche alpha du document. */
export function saveSelectionAsChannel(): void {
  const snap = selectionSnapshot();
  if (!snap) return;
  const { canvas, box } = snap;
  const key = registerBitmap(canvas);
  const assetId = newId('img');
  editor.apply('history.addChannel', (d) => {
    d.assets[assetId] = {
      id: assetId,
      mime: 'image/png',
      width: canvas.width,
      height: canvas.height,
      data: key,
    };
    const list = (d.channels ??= []);
    list.push({ id: newId('chan'), name: t('channels.alphaName', { n: list.length + 1 }), assetId, ...box });
  });
}

/** Recharge une couche alpha comme sélection. */
export function loadChannel(ch: AlphaChannel, mode: SelectionMode): void {
  const img = images().get(editor.doc, ch.assetId);
  if (img) selectFromAlpha(img, ch, mode);
}

export function renameChannel(id: string, name: string): void {
  editor.apply('history.rename', (d) => {
    const ch = d.channels?.find((c) => c.id === id);
    if (ch) ch.name = name;
  });
}

export function deleteChannel(id: string): void {
  editor.apply('history.removeChannel', (d) => {
    d.channels = d.channels?.filter((c) => c.id !== id);
    if (!d.channels?.length) delete d.channels;
    pruneAssets(d);
  });
}

/** Mode de combinaison selon les touches (Maj : ajouter, Alt : retirer, les deux : intersection). */
export function modeFromKeys(e: { shiftKey: boolean; altKey: boolean }): SelectionMode {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return 'replace';
}
