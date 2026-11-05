import { HEIC_EXTENSIONS, HeicError, decodeHeic, isHeic } from '@poulpe/engine';
import heicUrl from '@poulpe/engine/wasm/poulpe_heic.wasm?url';
import { t } from '../i18n';

/*
 * Photos HEIC / HEIF (iPhone…) : lues par le décodeur Rust (chargé seulement pour ces fichiers)
 * puis converties en PNG, que le reste de l'appli sait déjà afficher, éditer et enregistrer.
 */

export { HEIC_EXTENSIONS, isHeic };
export const isHeicName = (name: string): boolean =>
  HEIC_EXTENSIONS.includes(name.split('.').pop()!.toLowerCase());

/** Convertit une photo HEIC en image PNG. Lève une `HeicError` si elle n'est pas lisible. */
export async function heicBlob(bytes: Uint8Array): Promise<Blob> {
  const img = await decodeHeic(fetch(heicUrl), bytes);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new HeicError('unreadable');
  return blob;
}

/** Comme `heicBlob`, en octets ; null (avec un message à l'écran) si la photo n'est pas lisible. */
export async function heicToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await (await heicBlob(bytes)).arrayBuffer());
  } catch (e) {
    window.alert(
      t(
        e instanceof HeicError && e.reason === 'tooBig'
          ? 'heic.tooBig'
          : e instanceof HeicError && e.reason === 'unsupported'
            ? 'heic.unsupported'
            : 'heic.unreadable',
      ),
    );
    return null;
  }
}
