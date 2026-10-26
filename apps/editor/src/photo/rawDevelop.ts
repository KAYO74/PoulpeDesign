import { DEFAULT_DEVELOP, RAW_EXTENSIONS, RawPhoto, type DevelopSettings } from '@poulpe/engine';
import rawUrl from '@poulpe/engine/wasm/poulpe_raw.wasm?url';
import { t } from '../i18n';
import { ui } from '../store';
import { applyLocals, type LocalAdjust } from './localAdjust';
import { openPhotoDocument } from './photoActions';

/*
 * Développement des photos RAW (comme la Persona Develop d'Affinity Photo ou Camera Raw) :
 * ouvrir un RAW affiche la fenêtre de développement ; « Développer » ouvre la photo réglée, en
 * taille réelle, dans un nouveau document en Persona Photo.
 */

export { RAW_EXTENSIONS };
export const isRawName = (name: string): boolean =>
  RAW_EXTENSIONS.includes(name.split('.').pop()!.toLowerCase());

let photo: RawPhoto | null = null;
let photoName = '';

/** Photo RAW ouverte dans la fenêtre de développement. */
export const rawPhoto = (): RawPhoto | null => photo;

/** Lit un RAW et ouvre la fenêtre de développement. Faux si le fichier n'est pas reconnu. */
export async function openRaw(bytes: Uint8Array, name: string): Promise<boolean> {
  closeRaw();
  const p = await RawPhoto.open(fetch(rawUrl), bytes).catch(() => null);
  if (!p) {
    window.alert(t('raw.unreadable'));
    return false;
  }
  photo = p;
  photoName = name;
  ui.set({ dialog: 'raw' });
  return true;
}

/** Développe en taille réelle et ouvre le résultat en Persona Photo. */
export function developRaw(settings: DevelopSettings, locals: LocalAdjust[] = []): void {
  if (!photo) return;
  const img = applyLocals(photo.render(settings, 0), locals);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const name = photoName;
  closeRaw();
  openPhotoDocument(canvas.toDataURL('image/png'), 'image/png', img.width, img.height, name);
}

export function closeRaw(): void {
  photo?.dispose();
  photo = null;
  if (ui.get().dialog === 'raw') ui.set({ dialog: null });
}

export { DEFAULT_DEVELOP, type DevelopSettings };
