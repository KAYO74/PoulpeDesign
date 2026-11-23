import {
  depthAt,
  depthBlur,
  depthInput,
  depthNormalize,
  depthResample,
  depthSize,
  findNode,
  newId,
} from '@poulpe/core';
import { registerBitmap } from '@poulpe/render';
import { t } from '../i18n';
import { getPerf, subscribePerf, threadCount } from '../preferences';
import { editor, toast, ui } from '../store';
import { WorkerClient } from '../smart/workers';
import { targetPixels } from './paintTarget';
import { makeCanvas, pruneAssets, selectedImage } from './pixels';

/*
 * Image › Flou d'objectif (profondeur) : un modèle (Depth Anything V2 Small) estime la distance
 * de chaque point de la photo ; on choisit le plan net d'un clic, et ce qui est plus près ou plus
 * loin devient flou, comme avec un grand diaphragme. Sur l'ordinateur, sans connexion.
 */

export interface DepthBlurSettings {
  /** Profondeur du plan net (0 loin, 1 près). */
  focus: number;
  /** Demi-largeur du plan net, de 0 à 0,5. */
  range: number;
  /** Force du flou, de 0 à 100 (100 = 2 % du grand côté de l'image). */
  amount: number;
}

type Request = { modelUrl: string; input: Float32Array; width: number; height: number; threads: number };
const client = new WorkerClient<Request, { result: Float32Array; width: number; height: number }>(
  () => new Worker(new URL('../smart/depth.worker.ts', import.meta.url), { type: 'module' }),
);

let threads = getPerf().threads;
subscribePerf(() => {
  if (getPerf().threads === threads) return;
  threads = getPerf().threads;
  client.reset();
});

const modelUrl = () => new URL('models/depth-anything-small.onnx', document.baseURI).href;

/** Taille du grand côté de l'aperçu. */
const PREVIEW_SIDE = 480;

interface Session {
  nodeId: string;
  assetId: string;
  /** Carte de profondeur (0 loin, 1 près) à la taille du modèle. */
  map: { data: Float32Array; width: number; height: number } | null;
  /** Image réduite pour l'aperçu et sa carte de profondeur. */
  small: { image: ImageData; depth: Float32Array } | null;
}
let session: Session | null = null;

export const canDepthBlur = (): boolean => {
  const n = selectedImage();
  return !!n && !n.crop && !ui.get().busy;
};

/** Ouvre la fenêtre (il faut un calque d'image sélectionné, sans recadrage). */
export function openDepthBlur(): void {
  const n = selectedImage();
  if (!n) return;
  session = { nodeId: n.id, assetId: n.assetId, map: null, small: null };
  ui.set({ dialog: 'depthBlur' });
}

export function closeDepthBlur(): void {
  session = null;
  ui.set({ dialog: null });
}

function currentPixels() {
  const node = session ? findNode(editor.doc, session.nodeId)?.node : null;
  if (!node || node.type !== 'image') return null;
  const px = targetPixels(node, 'pixels');
  return px ? { node, base: px.base } : null;
}

/** Estime la profondeur de l'image (une fois par fenêtre). Renvoie false si c'est impossible. */
export async function estimateDepth(): Promise<boolean> {
  const s = session;
  const cur = currentPixels();
  if (!s || !cur) return false;
  const bw = cur.base.width,
    bh = cur.base.height;
  const size = depthSize(bw, bh);
  const c = makeCanvas(size.width, size.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur.base, 0, 0, size.width, size.height);
  const input = depthInput(g.getImageData(0, 0, size.width, size.height));
  const r = await client.run(
    { modelUrl: modelUrl(), input, width: size.width, height: size.height, threads: threadCount() },
    (m) => !!m.result,
    [input.buffer],
  );
  if (session !== s) return false;
  s.map = { data: depthNormalize(r.result), width: r.width, height: r.height };
  // Image réduite pour l'aperçu, et profondeur à sa taille.
  const k = Math.min(1, PREVIEW_SIDE / Math.max(bw, bh));
  const sw = Math.max(1, Math.round(bw * k)),
    sh = Math.max(1, Math.round(bh * k));
  const sc = makeCanvas(sw, sh);
  const sg = sc.getContext('2d', { willReadFrequently: true })!;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(cur.base, 0, 0, sw, sh);
  s.small = {
    image: sg.getImageData(0, 0, sw, sh),
    depth: depthResample(s.map.data, s.map.width, s.map.height, sw, sh),
  };
  return true;
}

const sigmaFor = (amount: number, longSide: number) => (amount / 100) * longSide * 0.02;

/** Aperçu réduit du résultat (ou de la carte de profondeur, en gris). */
export function depthPreview(set: DepthBlurSettings, showDepth: boolean): ImageData | null {
  const sm = session?.small;
  if (!sm) return null;
  const { width: w, height: h } = sm.image;
  const out = new ImageData(w, h);
  if (showDepth) {
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(sm.depth[i] * 255);
      out.data.set([v, v, v, 255], i * 4);
    }
    return out;
  }
  const full = currentPixels();
  const longFull = full ? Math.max(full.base.width, full.base.height) : Math.max(w, h);
  // Le flou de l'aperçu est le même, vu en plus petit.
  const sigma = sigmaFor(set.amount, longFull) * (Math.max(w, h) / longFull);
  out.data.set(depthBlur(sm.image, sm.depth, { focus: set.focus, range: set.range, sigma }));
  return out;
}

/** Profondeur au point (x, y) de l'aperçu, en fractions de 0 à 1 de sa largeur et de sa hauteur. */
export function depthAtPreview(fx: number, fy: number): number | null {
  const sm = session?.small;
  if (!sm) return null;
  const { width: w, height: h } = sm.image;
  return depthAt(sm.depth, w, h, fx * (w - 1), fy * (h - 1));
}

/** Applique le flou à l'image entière ; renvoie false si c'est impossible. */
export function applyDepthBlur(set: DepthBlurSettings): boolean {
  const s = session;
  const cur = currentPixels();
  if (!s || !s.map || !cur) return false;
  const bw = cur.base.width,
    bh = cur.base.height;
  const src = cur.base.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, bw, bh);
  const depth = depthResample(s.map.data, s.map.width, s.map.height, bw, bh);
  const data = depthBlur(src, depth, {
    focus: set.focus,
    range: set.range,
    sigma: sigmaFor(set.amount, Math.max(bw, bh)),
  });
  const out = makeCanvas(bw, bh);
  const og = out.getContext('2d')!;
  const img = og.createImageData(bw, bh);
  img.data.set(data);
  og.putImageData(img, 0, 0);
  const key = registerBitmap(out);
  const nodeId = s.nodeId;
  editor.apply('history.depthBlur', (d) => {
    const n = findNode(d, nodeId)?.node;
    if (!n || n.type !== 'image') return;
    const assetId = newId('img');
    d.assets[assetId] = { id: assetId, mime: 'image/png', width: bw, height: bh, data: key };
    n.assetId = assetId;
    pruneAssets(d);
  });
  return true;
}

export function toastDepthFailed(missing: boolean): void {
  toast(t(missing ? 'depthblur.modelMissing' : 'depthblur.failed'));
}
