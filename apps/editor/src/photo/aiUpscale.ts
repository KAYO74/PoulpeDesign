import { findNode, newId, planTiles, placeTile, tileInput, upscaleAlpha, UPSCALE_FACTOR } from '@poulpe/core';
import { registerBitmap } from '@poulpe/render';
import { t } from '../i18n';
import { getPerf, subscribePerf, threadCount } from '../preferences';
import { editor, toast, ui } from '../store';
import { WorkerClient } from '../smart/workers';
import { targetPixels } from './paintTarget';
import { makeCanvas, pruneAssets, selectedImage } from './pixels';

/*
 * Édition › Agrandir par IA : le calque d'image gagne en définition (×2 ou ×4) avec le modèle
 * Real-ESRGAN, sur l'ordinateur, sans connexion. La taille du calque dans le document ne change
 * pas : il a simplement plus de pixels, donc plus de détails à l'impression ou au zoom.
 */

/** Pixels maximum du résultat ×4 (même pour ×2 : on réduit ensuite). */
export const UPSCALE_MAX_OUTPUT = 100_000_000;

type Request = { modelUrl: string; input: Float32Array; width: number; height: number; threads: number };
const client = new WorkerClient<Request, { result: Float32Array }>(
  () => new Worker(new URL('../smart/upscale.worker.ts', import.meta.url), { type: 'module' }),
);

let threads = getPerf().threads;
subscribePerf(() => {
  if (getPerf().threads === threads) return;
  threads = getPerf().threads;
  client.reset();
});

const modelUrl = () => new URL('models/realesrgan-x4.onnx', document.baseURI).href;

let nodeId: string | null = null;

export const canAiUpscale = (): boolean => selectedImage() !== null && !ui.get().busy;

/** Taille de l'image du calque (en pixels), pour la fenêtre. */
export function upscaleSource(): { width: number; height: number } | null {
  const n = nodeId ? findNode(editor.doc, nodeId)?.node : null;
  const a = n?.type === 'image' ? editor.doc.assets[n.assetId] : null;
  return a ? { width: a.width, height: a.height } : null;
}

/** Ouvre la fenêtre (il faut un calque d'image sélectionné). */
export function openAiUpscale(): void {
  const n = selectedImage();
  if (!n) return;
  nodeId = n.id;
  ui.set({ dialog: 'aiUpscale' });
}

export function closeAiUpscale(): void {
  nodeId = null;
  ui.set({ dialog: null });
}

/** Agrandit le calque ; renvoie false si c'est annulé ou impossible. */
export async function applyAiUpscale(
  factor: 2 | 4,
  onProgress: (part: number) => void,
  cancelled: () => boolean,
): Promise<boolean> {
  const id = nodeId;
  const node = id ? findNode(editor.doc, id)?.node : null;
  if (!node || node.type !== 'image') return false;
  const px = targetPixels(node, 'pixels');
  if (!px) return false;
  const w = px.base.width,
    h = px.base.height;
  if (w * h * UPSCALE_FACTOR ** 2 > UPSCALE_MAX_OUTPUT) return false;
  const src = px.base.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h);
  const full = UPSCALE_FACTOR;
  const out = new Uint8ClampedArray(w * full * h * full * 4);
  const tiles = planTiles(w, h);
  for (let i = 0; i < tiles.length; i++) {
    if (cancelled()) return false;
    const tile = tiles[i];
    const input = tileInput(src, tile);
    const { result } = await client.run(
      {
        modelUrl: modelUrl(),
        input,
        width: tile.x1 - tile.x0,
        height: tile.y1 - tile.y0,
        threads: threadCount(),
      },
      (m) => !!m.result,
      [input.buffer],
    );
    placeTile(out, w * full, result, tile);
    onProgress((i + 1) / tiles.length);
  }
  if (cancelled()) return false;
  upscaleAlpha(src, out);

  // ×4 : tel quel ; ×2 : on réduit le résultat ×4 (plus net qu'un agrandissement ×2 direct).
  const big = makeCanvas(w * full, h * full);
  const bigCtx = big.getContext('2d')!;
  bigCtx.putImageData(new ImageData(out, big.width, big.height), 0, 0);
  let final = big;
  if (factor === 2) {
    final = makeCanvas(w * 2, h * 2);
    const g = final.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(big, 0, 0, final.width, final.height);
  }
  const key = registerBitmap(final);
  editor.apply('history.aiUpscale', (d) => {
    const n = findNode(d, node.id)?.node;
    if (!n || n.type !== 'image') return;
    const assetId = newId('img');
    d.assets[assetId] = {
      id: assetId,
      mime: 'image/png',
      width: final.width,
      height: final.height,
      data: key,
    };
    n.assetId = assetId;
    pruneAssets(d);
  });
  return true;
}

export function toastUpscaleFailed(missing: boolean): void {
  toast(t(missing ? 'aiupscale.modelMissing' : 'aiupscale.failed'));
}
