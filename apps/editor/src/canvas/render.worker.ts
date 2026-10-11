/// <reference lib="webworker" />
import { pageFields, type PoulpeDocument, type SceneNode } from '@poulpe/core';
import { paintSegment, type Drawable } from '@poulpe/render';

/*
 * Fil de dessin : dessine une bande d'une tranche de calques pendant que les autres fils
 * dessinent les autres bandes (voir parallel.ts). Le code de dessin est celui de la page.
 */

export type RenderRequest =
  | { type: 'fonts'; faces: { family: string; source: string; descriptors: FontFaceDescriptors }[] }
  | { type: 'doc'; id: number; json: string }
  | { type: 'image'; id: string; bitmap: ImageBitmap }
  | {
      type: 'paint';
      job: number;
      doc: number;
      artboard: string;
      from: number;
      to: number;
      base: boolean;
      fonts: string[];
      editingId: string | null;
      hidden: string[];
      cull: { x: number; y: number; width: number; height: number };
      scale: number;
      ox: number;
      oy: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

export type RenderResponse = { job: number; bitmap: ImageBitmap | null; error?: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let doc: PoulpeDocument | null = null;
let docId = -1;
const images = new Map<string, ImageBitmap>();
const source = { get: (_d: PoulpeDocument, id: string): Drawable | null => images.get(id) ?? null };

/** Gèle le document reçu : les mises en page de texte et les tracés sont alors mémorisés. */
function freeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) freeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

type Paint = Extract<RenderRequest, { type: 'paint' }>;

/** Zone visible limitée à la bande : chaque fil ne dessine que les objets qui la touchent. */
function bandCull(m: Paint) {
  const px = 1 / m.scale;
  const x0 = Math.max(m.cull.x, (m.x - m.ox) / m.scale - px);
  const y0 = Math.max(m.cull.y, (m.y - m.oy) / m.scale - px);
  const x1 = Math.min(m.cull.x + m.cull.width, (m.x + m.width - m.ox) / m.scale + px);
  const y1 = Math.min(m.cull.y + m.cull.height, (m.y + m.height - m.oy) / m.scale + px);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

scope.onmessage = async (e: MessageEvent<RenderRequest>) => {
  const m = e.data;
  if (m.type === 'fonts') {
    for (const f of m.faces) scope.fonts.add(new FontFace(f.family, f.source, f.descriptors));
    return;
  }
  if (m.type === 'doc') {
    doc = freeze(JSON.parse(m.json) as PoulpeDocument);
    docId = m.id;
    return;
  }
  if (m.type === 'image') {
    images.get(m.id)?.close();
    images.set(m.id, m.bitmap);
    return;
  }
  const reply = (r: RenderResponse, transfer: Transferable[] = []) => scope.postMessage(r, transfer);
  try {
    if (!doc || docId !== m.doc) throw new Error('document absent');
    const ab = doc.artboards.find((a) => a.id === m.artboard);
    if (!ab) throw new Error('plan de travail absent');
    // Les polices du document : celles de l'appli se chargent ici, celles du système sont prêtes.
    await Promise.all(m.fonts.map((f) => scope.fonts.load(f).catch(() => [])));
    if ([...scope.fonts].some((f) => f.status === 'error')) throw new Error('police indisponible');
    const canvas = new OffscreenCanvas(m.width, m.height);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(m.scale, 0, 0, m.scale, m.ox - m.x, m.oy - m.y);
    ctx.beginPath();
    ctx.rect(ab.x, ab.y, ab.width, ab.height);
    ctx.clip();
    paintSegment(
      ctx,
      doc,
      ab,
      ab.children.slice(m.from, m.to) as SceneNode[],
      {
        images: source,
        fields: pageFields(doc, ab),
        editingId: m.editingId,
        hidden: m.hidden.length ? new Set(m.hidden) : undefined,
        cull: bandCull(m),
      },
      m.base,
    );
    const bitmap = canvas.transferToImageBitmap();
    reply({ job: m.job, bitmap }, [bitmap]);
  } catch (err) {
    reply({ job: m.job, bitmap: null, error: String(err) });
  }
};
