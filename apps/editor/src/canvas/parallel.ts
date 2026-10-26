import { masterOf, type PoulpeDocument, type SceneNode } from '@poulpe/core';
import { getAssetRevision, type Drawable, type ParallelPainter, type SegmentJob } from '@poulpe/render';
import { documentFonts } from '../normalize';
import type { RenderRequest, RenderResponse } from './render.worker';

/*
 * Dessin sur plusieurs cœurs. Un gros redessin (ouverture d'un document de centaines d'objets,
 * zoom qui se termine) prenait plus de 100 ms dans le fil de l'interface, qui se figeait. Ici,
 * l'image est découpée en bandes horizontales dessinées en même temps par plusieurs fils de
 * dessin, avec le même code de dessin ; la page assemble les bandes et l'interface reste fluide.
 *
 * Chaque fil reçoit une fois le document (sans les données des images), les images décodées et
 * les polices de l'appli, puis seulement la description de sa bande.
 */

type Assets = PoulpeDocument['assets'];

interface Worker_ {
  worker: Worker;
  doc: number;
  images: Map<string, string>;
}

/** Nombre de fils de dessin : un par cœur, sans prendre celui de l'interface, au plus 8. */
export function renderWorkerCount(cores: number): number {
  return cores >= 4 ? Math.min(8, cores - 1) : 0;
}

export class WorkerPainter implements ParallelPainter {
  minNodes = 200;
  private workers: Worker_[] = [];
  private docIds = new WeakMap<PoulpeDocument, { id: number; json: string }>();
  private nextDoc = 1;
  private nextJob = 1;
  private waiting = new Map<number, (r: RenderResponse) => void>();
  /** Images prêtes pour les fils : clé = source et révision (les retouches en cours la changent). */
  private bitmaps = new Map<string, { key: string; src: Drawable; bitmap: ImageBitmap | null }>();
  private broken = false;

  constructor(
    count: number,
    private makeCanvas: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas,
  ) {
    const faces = fontFaces();
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<RenderResponse>) => {
        const done = this.waiting.get(e.data.job);
        this.waiting.delete(e.data.job);
        done?.(e.data);
      };
      worker.onerror = () => {
        this.broken = true;
        for (const done of this.waiting.values()) done({ job: 0, bitmap: null });
        this.waiting.clear();
      };
      this.post({ worker, doc: 0, images: new Map() }, { type: 'fonts', faces });
      this.workers.push({ worker, doc: 0, images: new Map() });
    }
  }

  get size(): number {
    return this.workers.length;
  }

  dispose(): void {
    for (const w of this.workers) w.worker.terminate();
    this.workers = [];
    for (const done of this.waiting.values()) done({ job: 0, bitmap: null });
    this.waiting.clear();
  }

  private post(w: Worker_, m: RenderRequest, transfer: Transferable[] = []) {
    w.worker.postMessage(m, transfer);
  }

  accepts(job: SegmentJob): boolean {
    if (this.broken || !this.workers.length) return false;
    const ids: string[] = [];
    const ok = (nodes: readonly SceneNode[]): boolean =>
      nodes.every((n) => {
        // Réglages et symboles dépendent de tout le reste : dessinés dans la page.
        if (n.type === 'adjustment' || n.type === 'symbol') return false;
        // Plages de fusion : elles lisent ce qui est dessous, dessiné dans la page.
        if (n.blendRanges) return false;
        if (n.type === 'image') ids.push(n.assetId);
        if (n.mask) ids.push(n.mask.assetId);
        for (const p of paintsOf(n)) if (p?.type === 'pattern' && p.assetId) ids.push(p.assetId);
        return n.type !== 'group' || ok(n.children);
      });
    const master = job.base ? masterOf(job.doc, job.ab) : null;
    if (!ok(job.nodes) || (master && !ok(master.children))) return false;
    const bg = job.ab.background as { type: string; assetId?: string };
    if (job.base && bg.type === 'pattern' && bg.assetId) ids.push(bg.assetId);
    if (this.childIndex(job) === null) return false;
    // Toutes les images doivent être prêtes pour les fils ; sinon on les prépare pour la suite.
    let ready = true;
    for (const id of new Set(ids)) if (!this.bitmapFor(job, id)) ready = false;
    return ready;
  }

  /** Position de la tranche dans les calques du plan de travail (début, fin). */
  private childIndex(job: SegmentJob): [number, number] | null {
    const kids = job.ab.children;
    if (!job.nodes.length) return [0, 0];
    const from = kids.indexOf(job.nodes[0] as SceneNode);
    if (from < 0) return null;
    for (let i = 0; i < job.nodes.length; i++) if (kids[from + i] !== job.nodes[i]) return null;
    return [from, from + job.nodes.length];
  }

  private bitmapFor(job: SegmentJob, id: string): boolean {
    const src = job.opts.images.get(job.doc, id);
    if (!src) return false;
    const key = `${getAssetRevision(id)}`;
    const have = this.bitmaps.get(id);
    if (have && have.src === src && have.key === key) return !!have.bitmap;
    const entry = { key, src, bitmap: null as ImageBitmap | null };
    this.bitmaps.set(id, entry);
    void createImageBitmap(src as ImageBitmapSource)
      .then((bitmap) => {
        if (this.bitmaps.get(id) !== entry) return bitmap.close();
        entry.bitmap = bitmap;
      })
      .catch(() => this.bitmaps.delete(id));
    return false;
  }

  private docMessage(doc: PoulpeDocument): { id: number; json: string } {
    let d = this.docIds.get(doc);
    if (!d) {
      // Le document sans les données des images : elles partent à part, déjà décodées.
      const assets: Assets = {};
      for (const [k, a] of Object.entries(doc.assets)) assets[k] = { ...a, data: '' };
      d = { id: this.nextDoc++, json: JSON.stringify({ ...doc, assets }) };
      this.docIds.set(doc, d);
    }
    return d;
  }

  async paint(job: SegmentJob): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
    const range = this.childIndex(job);
    if (!range || !this.workers.length) return null;
    const doc = this.docMessage(job.doc);
    const fonts = documentFonts(job.doc);
    const n = Math.max(1, Math.min(this.workers.length, Math.floor(job.height / 64)));
    const band = Math.ceil(job.height / n);
    const parts = this.workers.slice(0, n).map((w, i) => {
      if (w.doc !== doc.id) {
        this.post(w, { type: 'doc', id: doc.id, json: doc.json });
        w.doc = doc.id;
      }
      for (const [id, b] of this.bitmaps)
        if (b.bitmap && w.images.get(id) !== b.key) {
          // Copie de l'image pour ce fil (l'original reste ici pour les autres).
          void createImageBitmap(b.bitmap).then((copy) =>
            this.post(w, { type: 'image', id, bitmap: copy }, [copy]),
          );
          w.images.set(id, b.key);
        }
      const y = job.y + i * band;
      const height = Math.min(band, job.y + job.height - y);
      const id = this.nextJob++;
      return new Promise<RenderResponse>((resolve) => {
        this.waiting.set(id, resolve);
        // Les copies d'images partent avant la demande de dessin : on attend qu'elles soient faites.
        void Promise.resolve().then(() =>
          this.post(w, {
            type: 'paint',
            job: id,
            doc: doc.id,
            artboard: job.ab.id,
            from: range[0],
            to: range[1],
            base: job.base,
            fonts,
            editingId: job.opts.editingId ?? null,
            hidden: job.opts.hidden ? [...job.opts.hidden] : [],
            cull: job.opts.cull ?? { x: -1e9, y: -1e9, width: 2e9, height: 2e9 },
            scale: job.scale,
            ox: job.ox,
            oy: job.oy,
            x: job.x,
            y,
            width: job.width,
            height,
          }),
        );
      }).then((r) => ({ r, y: y - job.y }));
    });
    const done = await Promise.all(parts);
    if (done.some((d) => !d.r.bitmap)) {
      for (const d of done) d.r.bitmap?.close();
      if (done.some((d) => d.r.error?.includes('police'))) this.broken = true;
      return null;
    }
    const canvas = this.makeCanvas(job.width, job.height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    for (const d of done) {
      ctx.drawImage(d.r.bitmap!, 0, d.y);
      d.r.bitmap!.close();
    }
    return canvas;
  }
}

function paintsOf(n: SceneNode): ({ type?: string; assetId?: string } | undefined)[] {
  const any = n as { fill?: unknown; stroke?: { paint?: unknown }; strokes?: { paint?: unknown }[] };
  // Cadre de texte en forme : son fond et son contour aussi.
  const shape = n.type === 'text' ? n.frameShape : undefined;
  return [
    any.fill,
    any.stroke?.paint,
    ...(any.strokes ?? []).map((s) => s.paint),
    shape?.fill,
    shape?.stroke?.paint,
  ] as {
    type?: string;
    assetId?: string;
  }[];
}

/** Polices de l'appli déclarées en CSS, avec leurs adresses complètes, pour les fils de dessin. */
function fontFaces(): { family: string; source: string; descriptors: FontFaceDescriptors }[] {
  const out: { family: string; source: string; descriptors: FontFaceDescriptors }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const st = rule.style;
      const base = sheet.href ?? location.href;
      const source = st
        .getPropertyValue('src')
        .replace(
          /url\(\s*(["']?)([^"')]+)\1\s*\)/g,
          (_m, _q, u: string) => `url("${new URL(u, base).href}")`,
        );
      const family = st.getPropertyValue('font-family').replace(/^["']|["']$/g, '');
      if (!family || !source) continue;
      out.push({
        family,
        source,
        descriptors: {
          style: st.getPropertyValue('font-style') || 'normal',
          weight: st.getPropertyValue('font-weight') || '400',
          unicodeRange: st.getPropertyValue('unicode-range') || undefined,
        },
      });
    }
  }
  return out;
}
