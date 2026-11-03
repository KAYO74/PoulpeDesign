import {
  commandsBounds,
  createGroup,
  createPath,
  findNode,
  mapCommands,
  pathToSvg,
  type ImageNode,
  type TraceOptions,
  type TraceResult,
} from '@poulpe/core';
import { t } from '../i18n';
import { images, localToDoc, makeCanvas, selectedImage } from '../photo/pixels';
import { editor } from '../store';
import { WorkerClient } from './workers';

/*
 * Vectorisation d'image (Calque > Vectoriser l'image…) : la photo ou le dessin sélectionné devient
 * un groupe de tracés, une couleur par tracé, posé au-dessus de l'image.
 */

type TraceRequest = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  options: TraceOptions;
  /** Forcer la version TypeScript (tests de comparaison). */
  ts?: boolean;
};

const client = new WorkerClient<TraceRequest, { result: TraceResult }>(
  () => new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module' }),
);

export function canVectorize(): boolean {
  return selectedImage() !== null;
}

/** Pixels de la partie visible (recadrée) d'une image, réduits à `maxSide` pixels au plus. */
export function traceSource(node: ImageNode, maxSide: number): ImageData | null {
  const img = images().get(editor.doc, node.assetId);
  const asset = editor.doc.assets[node.assetId];
  if (!img || !asset) return null;
  const c = node.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const sw = asset.width * c.width,
    sh = asset.height * c.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh, 1));
  const canvas = makeCanvas(sw * k, sh * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, c.x * asset.width, c.y * asset.height, sw, sh, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Vectorise des pixels dans le worker. */
export async function traceAsync(
  px: ImageData,
  options: TraceOptions,
  onProgress?: (f: number) => void,
  ts = false,
): Promise<TraceResult> {
  const data = new Uint8ClampedArray(px.data);
  const { result } = await client.run(
    { data, width: px.width, height: px.height, options, ts },
    (r) => !!r.result,
    [data.buffer],
    onProgress,
  );
  return result;
}

/** Aperçu SVG d'un résultat (pour la boîte de dialogue). */
export function traceToSvg(r: TraceResult): string {
  const paths = r.layers
    .map((l) => `<path fill="${l.color}" fill-rule="evenodd" d="${pathToSvg(l.commands, 1)}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.width} ${r.height}">${paths}</svg>`;
}

/** Nombre de nœuds d'un résultat (affiché sous l'aperçu). */
export function traceNodeCount(r: TraceResult): number {
  return r.layers.reduce((n, l) => n + l.commands.filter((c) => c.op !== 'Z').length, 0);
}

/**
 * Pose le résultat au-dessus de l'image : un groupe de tracés aux coordonnées du document (la
 * rotation de l'image est appliquée aux tracés). L'image est masquée, ou supprimée si demandé.
 */
export function insertTrace(
  nodeId: string,
  r: TraceResult,
  original: 'keep' | 'hide' | 'delete',
): string | null {
  const node = findNode(editor.doc, nodeId)?.node;
  if (!node || node.type !== 'image' || !r.layers.length) return null;
  const m = localToDoc(node);
  const kx = node.width / r.width,
    ky = node.height / r.height;
  const toDoc = (p: { x: number; y: number }) => {
    const q = m.transformPoint(new DOMPoint(p.x * kx, p.y * ky));
    return { x: q.x, y: q.y };
  };
  const children = r.layers.flatMap((layer, i) => {
    const cmds = mapCommands(layer.commands, toDoc);
    const b = commandsBounds(cmds);
    if (!b || b.width <= 0 || b.height <= 0) return [];
    const path = createPath({
      ...b,
      name: t('name.traceColor', { n: i + 1 }),
      d: pathToSvg(cmds, 2),
      viewBox: b,
      fillRule: 'evenodd',
    });
    path.fill = { type: 'solid', color: layer.color };
    path.stroke = { paint: { type: 'none' }, width: 1 };
    return [path];
  });
  if (!children.length) return null;
  const group = createGroup(children, t('name.trace', { name: node.name }));
  editor.apply('history.vectorize', (d) => {
    const loc = findNode(d, nodeId);
    if (!loc) return;
    loc.parent.children.splice(loc.index + 1, 0, group);
    if (original === 'delete') loc.parent.children.splice(loc.index, 1);
    else if (original === 'hide') loc.node.visible = false;
    return [group.id];
  });
  return group.id;
}
