import {
  createImage,
  findNode,
  newId,
  nodeBounds,
  topLevelIds,
  walkDocument,
  type Pixels,
  type SceneNode,
} from '@poulpe/core';
import { drawNode, registerBitmap } from '@poulpe/render';
import { t } from '../i18n';
import { images, makeCanvas } from '../photo/pixels';
import { editor } from '../store';

/*
 * Panorama (Calque > Assembler un panorama…) : les photos choisies, qui se recouvrent en partie,
 * donnent une nouvelle image au-dessus des autres ; les originaux restent en place.
 */

/** Plus grand côté (pixels) d'une photo pendant l'assemblage. */
const MAX_SIDE = 3000;

export interface PanoramaSettings {
  exposure: boolean;
  perspective: boolean;
}

export const DEFAULT_PANORAMA: PanoramaSettings = { exposure: true, perspective: true };

/** Photos choisies, dans l'ordre de la prise de vue : de gauche à droite, puis de haut en bas. */
function chosen(): SceneNode[] {
  const top = topLevelIds(editor.doc, editor.selection);
  const list = [...walkDocument(editor.doc)].filter((l) => top.includes(l.node.id)).map((l) => l.node);
  return list.filter((n) => n.type === 'image').sort((a, b) => a.x - b.x || a.y - b.y);
}

export function canPanorama(): boolean {
  return chosen().length >= 2;
}

let current: Worker | null = null;

/** Annule l'assemblage en cours. */
export function cancelPanorama(): void {
  current?.terminate();
  current = null;
}

/** Assemble les photos choisies ; renvoie false si l'assemblage a été annulé. */
export async function stitchSelected(
  settings: PanoramaSettings,
  onProgress: (f: number) => void,
): Promise<boolean> {
  const nodes = chosen();
  if (nodes.length < 2) return false;
  const topId = [...walkDocument(editor.doc)].filter((l) => nodes.some((n) => n.id === l.node.id)).pop()!.node
    .id;
  await images().ready(editor.doc);
  // Même échelle pour toutes les photos : celle de la moins détaillée, plafonnée.
  let k = Infinity;
  for (const n of nodes) {
    const a = n.type === 'image' ? editor.doc.assets[n.assetId] : null;
    const b = nodeBounds(n);
    if (a && b.width > 0) k = Math.min(k, a.width / b.width);
    k = Math.min(k, MAX_SIDE / Math.max(b.width, b.height, 1));
  }
  if (!Number.isFinite(k) || k <= 0) k = 1;
  const pixels: Pixels[] = nodes.map((n) => {
    const b = nodeBounds(n);
    const canvas = makeCanvas(b.width * k, b.height * k);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.scale(canvas.width / b.width, canvas.height / b.height);
    ctx.translate(-b.x, -b.y);
    drawNode(ctx, editor.doc, n, { images: images() });
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: d.data, width: d.width, height: d.height };
  });
  const worker = new Worker(new URL('./panorama.worker.ts', import.meta.url), { type: 'module' });
  current = worker;
  const result = await new Promise<
    (Pixels & { offsets: { x: number; y: number }[]; ref: number; origin: { x: number; y: number } }) | null
  >((resolve, reject) => {
    worker.onmessage = (
      e: MessageEvent<{
        progress?: number;
        result?:
          | (Pixels & { offsets: { x: number; y: number }[]; ref: number; origin: { x: number; y: number } })
          | null;
        error?: string;
        code?: string;
        index?: number;
      }>,
    ) => {
      if (e.data.error) {
        const { code, index = 0 } = e.data;
        if (code === 'noOverlap') reject(new Error(t('panorama.noOverlap', { a: index, b: index + 1 })));
        else if (code === 'tooLarge') reject(new Error(t('panorama.tooLarge')));
        else if (code === 'tooFew') reject(new Error(t('panorama.tooFew')));
        else reject(new Error(e.data.error));
      } else if ('result' in e.data) resolve(e.data.result ?? null);
      else if (e.data.progress !== undefined) onProgress(e.data.progress);
    };
    worker.onerror = (e) => reject(new Error(e.message));
    // Fermer le worker (annulation) laisse la promesse ouverte : on la clôt ici.
    const stop = worker.terminate.bind(worker);
    worker.terminate = () => {
      stop();
      resolve(null);
    };
    worker.postMessage(
      { id: 1, images: pixels, options: settings },
      pixels.map((p) => p.data.buffer),
    );
  }).finally(() => {
    if (current === worker) current = null;
    worker.onmessage = null;
    worker.terminate();
  });
  if (!result) return false;
  const canvas = makeCanvas(result.width, result.height);
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0);
  const key = registerBitmap(canvas);
  const first = nodeBounds(nodes[result.ref]);
  editor.apply('history.panorama', (d) => {
    const loc = findNode(d, topId);
    if (!loc) return;
    const id = newId('img');
    d.assets[id] = { id, mime: 'image/png', width: canvas.width, height: canvas.height, data: key };
    const img = createImage({
      x: first.x + result.origin.x / k,
      y: first.y + result.origin.y / k,
      width: result.width / k,
      height: result.height / k,
      assetId: id,
      name: t('panorama.name'),
    });
    loc.parent.children.splice(loc.index + 1, 0, img);
    return [img.id];
  });
  return true;
}
