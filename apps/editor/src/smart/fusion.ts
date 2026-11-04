import {
  FUSION_MAX_PIXELS,
  createImage,
  findNode,
  newId,
  nodeBounds,
  topLevelIds,
  unionBoxes,
  walkDocument,
  type FusionMode,
  type Pixels,
  type SceneNode,
} from '@poulpe/core';
import { drawNode, registerBitmap } from '@poulpe/render';
import { t } from '../i18n';
import { images, makeCanvas } from '../photo/pixels';
import { editor } from '../store';

/*
 * Fusion d'expositions et empilement de mise au point (Calque > Fusionner des expositions…) : les
 * images choisies, prises à la suite du même cadre, donnent une nouvelle image au-dessus des autres.
 */

export interface FusionSettings {
  mode: FusionMode;
  contrast: number;
  saturation: number;
  exposure: number;
}

export const DEFAULT_FUSION: FusionSettings = { mode: 'exposure', contrast: 1, saturation: 1, exposure: 1 };

/** Calques choisis, du plus bas au plus haut. */
function chosen(): SceneNode[] {
  const top = topLevelIds(editor.doc, editor.selection);
  return [...walkDocument(editor.doc)].filter((l) => top.includes(l.node.id)).map((l) => l.node);
}

export function canFuse(): boolean {
  return chosen().filter((n) => n.type === 'image').length >= 2;
}

/** Une image par calque choisi, dessinée seule sur le cadre commun (au plus FUSION_MAX_PIXELS). */
function render(nodes: SceneNode[]) {
  const box = unionBoxes(nodes.map(nodeBounds));
  if (!box) return null;
  const x = Math.floor(box.x),
    y = Math.floor(box.y);
  const w = Math.max(1, Math.ceil(box.x + box.width) - x),
    h = Math.max(1, Math.ceil(box.y + box.height) - y);
  let k = 1;
  for (const n of nodes) {
    const a = n.type === 'image' ? editor.doc.assets[n.assetId] : null;
    if (a && n.width > 0) k = Math.max(k, a.width / n.width);
  }
  k = Math.min(k, 8192 / Math.max(w, h), Math.sqrt(FUSION_MAX_PIXELS / (w * h)));
  const out: Pixels[] = [];
  for (const n of nodes) {
    const canvas = makeCanvas(w * k, h * k);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.scale(k, k);
    ctx.translate(-x, -y);
    drawNode(ctx, editor.doc, n, { images: images() });
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    out.push({ data: d.data, width: d.width, height: d.height });
  }
  return { box: { x, y, width: w, height: h }, pixels: out };
}

let current: Worker | null = null;

/** Annule la fusion en cours. */
export function cancelFusion(): void {
  current?.terminate();
  current = null;
}

/** Fusionne les images choisies ; renvoie false si la fusion a été annulée. */
export async function fuseSelected(
  settings: FusionSettings,
  onProgress: (f: number) => void,
): Promise<boolean> {
  const nodes = chosen().filter((n) => n.type === 'image');
  if (nodes.length < 2) return false;
  const topId = nodes[nodes.length - 1].id;
  await images().ready(editor.doc);
  const src = render(nodes);
  if (!src) return false;
  const worker = new Worker(new URL('./fusion.worker.ts', import.meta.url), { type: 'module' });
  current = worker;
  const result = await new Promise<Pixels | null>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ progress?: number; result?: Pixels | null; error?: string }>) => {
      if (e.data.error) reject(new Error(e.data.error));
      else if ('result' in e.data) resolve(e.data.result ?? null);
      else if (e.data.progress !== undefined) onProgress(e.data.progress);
    };
    worker.onerror = (e) => reject(new Error(e.message));
    const imgs = src.pixels.map((p) => ({ data: p.data, width: p.width, height: p.height }));
    worker.postMessage(
      { id: 1, images: imgs, options: settings },
      imgs.map((p) => p.data.buffer),
    );
    // Fermer le worker (annulation) laisse la promesse ouverte : on la clôt ici.
    const stop = worker.terminate.bind(worker);
    worker.terminate = () => {
      stop();
      resolve(null);
    };
  }).finally(() => {
    if (current === worker) current = null;
    worker.onmessage = null;
  });
  if (!result) return false;
  const canvas = makeCanvas(result.width, result.height);
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0);
  const key = registerBitmap(canvas);
  const name = t(settings.mode === 'focus' ? 'fusion.nameFocus' : 'fusion.nameExposure');
  editor.apply('history.fusion', (d) => {
    const loc = findNode(d, topId);
    if (!loc) return;
    const id = newId('img');
    d.assets[id] = { id, mime: 'image/png', width: canvas.width, height: canvas.height, data: key };
    const b = src.box;
    const img = createImage({ x: b.x, y: b.y, width: b.width, height: b.height, assetId: id, name });
    loc.parent.children.splice(loc.index + 1, 0, img);
    return [img.id];
  });
  return true;
}
