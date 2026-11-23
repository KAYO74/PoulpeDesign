import { samMask, type SamClick } from '@poulpe/core';
import type { ImageNode, Vec } from '@poulpe/core';
import { t } from '../i18n';
import { imageAt, makeCanvas } from '../photo/pixels';
import { selectFromMatte } from '../photo/selection';
import { toast, ui, type SelectionMode } from '../store';
import { getPerf, subscribePerf, threadCount } from '../preferences';
import { traceSource } from './vectorize';
import { WorkerClient } from './workers';

/*
 * Outil Sélection d'objet : un clic sur un objet le sélectionne (modèle SlimSAM, sur l'ordinateur,
 * sans connexion). La première fois sur une image, elle est analysée (quelques secondes) ; les
 * clics suivants sur la même image sont presque instantanés.
 */

type EncodeRequest = {
  kind: 'encode';
  key: string;
  encoderUrl: string;
  decoderUrl: string;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  threads: number;
};
type DecodeRequest = { kind: 'decode'; key: string; clicks: SamClick[] };
type Reply = { ready?: boolean; scale?: number; logits?: Float32Array; score?: number };

const client = new WorkerClient<EncodeRequest | DecodeRequest, Reply>(
  () => new Worker(new URL('./sam.worker.ts', import.meta.url), { type: 'module' }),
);

let threads = getPerf().threads;
subscribePerf(() => {
  if (getPerf().threads === threads) return;
  threads = getPerf().threads;
  analysed = null;
  client.reset();
});

/** Côté de l'image analysée : celui que le modèle attend. */
const SIDE = 1024;

const url = (file: string) => new URL(`models/${file}`, document.baseURI).href;

/** Image dont l'analyse est gardée dans le worker. */
let analysed: { key: string; scale: number } | null = null;

const keyOf = (node: ImageNode) => `${node.assetId}|${JSON.stringify(node.crop ?? null)}`;

/** Position d'un point du document dans l'image visible du calque (de 0 à 1), ou null s'il est dehors. */
export function pointInImage(node: ImageNode, p: Vec): Vec | null {
  const a = (-node.rotation * Math.PI) / 180;
  const dx = p.x - (node.x + node.width / 2),
    dy = p.y - (node.y + node.height / 2);
  const lx = dx * Math.cos(a) - dy * Math.sin(a) + node.width / 2,
    ly = dx * Math.sin(a) + dy * Math.cos(a) + node.height / 2;
  if (lx < 0 || ly < 0 || lx > node.width || ly > node.height) return null;
  return { x: lx / node.width, y: ly / node.height };
}

/** Sélectionne l'objet sous le point `p` du document. */
export async function selectObjectAt(p: Vec, mode: SelectionMode): Promise<boolean> {
  const node = imageAt(p);
  const at = node && pointInImage(node, p);
  const px = node && traceSource(node, SIDE);
  if (!node || !at || !px) {
    toast(t('smart.objectOutside'));
    return false;
  }
  const label = t('smart.objectBusy');
  ui.set({ busy: { label, progress: 0 } });
  try {
    const key = keyOf(node);
    if (analysed?.key !== key) {
      const data = new Uint8ClampedArray(px.data);
      const r = await client.run(
        {
          kind: 'encode',
          key,
          encoderUrl: url('slimsam-encoder.onnx'),
          decoderUrl: url('slimsam-decoder.onnx'),
          data,
          width: px.width,
          height: px.height,
          threads: threadCount(),
        },
        (m) => !!m.ready,
        [data.buffer],
        (progress) => ui.set({ busy: { label, progress } }),
      );
      analysed = { key, scale: r.scale! };
    }
    const click: SamClick = { x: at.x * px.width, y: at.y * px.height, positive: true };
    const { logits } = await client.run({ kind: 'decode', key, clicks: [click] }, (m) => !!m.logits);
    const alpha = samMask(logits!, analysed.scale, px.width, px.height);
    const canvas = makeCanvas(px.width, px.height);
    const out = new ImageData(px.width, px.height);
    for (let i = 0; i < alpha.length; i++) {
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
      out.data[i * 4 + 3] = alpha[i];
    }
    canvas.getContext('2d')!.putImageData(out, 0, 0);
    selectFromMatte(node, canvas, mode);
    return true;
  } catch (e) {
    analysed = null;
    const missing = e instanceof Error && e.message === 'model-missing';
    toast(t(missing ? 'smart.objectModelMissing' : 'smart.objectFailed'));
    console.error(e);
    return false;
  } finally {
    ui.set({ busy: null });
  }
}
