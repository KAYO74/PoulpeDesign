import {
  hasFields,
  masterOf,
  pageFields,
  type Artboard,
  type Box,
  type PoulpeDocument,
  type SceneNode,
} from '@poulpe/core';
import { drawChildren, type RenderOptions } from './draw';
import { getAssetRevision, getRenderRevision, getSharedRevision } from './images';
import { getLayoutRevision } from './layout';
import { canvasPaint } from './paints';

/*
 * Cache d'images du canevas.
 *
 * Redessiner 1 000 objets à chaque mouvement de souris est ce qui rendait l'éditeur lent. Ici, le
 * contenu de chaque plan de travail est gardé en image (en pixels de l'écran) et recopié tant
 * qu'il ne change pas. Les objets sélectionnés, ceux qu'on est en train de modifier, sont
 * dessinés en direct entre deux images : ce qui est dessous et ce qui est dessus ne bougent pas.
 *
 * Les documents sont immuables : un objet inchangé garde son identité. Une image reste bonne
 * tant que les objets qu'elle contient sont les mêmes (comparés par référence) et que rien
 * d'autre dont dépend le dessin n'a changé (images, symboles, numéros de page, révision du rendu).
 */

/** Qualité d'aperçu : pendant un zoom ou un défilement, réutiliser l'image étirée puis redessiner net. */
export type PreviewQuality = 'fast' | 'balanced' | 'full';

/** Vue de l'écran, en pixels de l'appareil : point écran = point du monde × `scale` + (`ox`, `oy`). */
export interface CacheView {
  scale: number;
  ox: number;
  oy: number;
  /** Taille du canevas, en pixels de l'appareil. */
  width: number;
  height: number;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Une tranche de calques à dessiner dans une image, en pixels de l'appareil. */
export interface SegmentJob {
  doc: PoulpeDocument;
  ab: Artboard;
  nodes: readonly SceneNode[];
  /** Avec le fond et la page maître. */
  base: boolean;
  opts: RenderOptions;
  /** Repère : point de l'image = point du monde × `scale` + (`ox`, `oy`) − (`x`, `y`). */
  scale: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Dessin des grosses tranches de calques sur plusieurs cœurs du processeur (fils de dessin de
 * l'éditeur). Le cache s'en sert là où un dessin direct figerait l'écran.
 */
export interface ParallelPainter {
  /** Nombre d'objets à partir duquel les fils valent leur coût de mise en route. */
  minNodes: number;
  /** Les fils savent-ils dessiner cette tranche (images prêtes, pas de réglages) ? */
  accepts(job: SegmentJob): boolean;
  /** L'image de la tranche, ou null en cas d'échec. */
  paint(job: SegmentJob): Promise<HTMLCanvasElement | OffscreenCanvas | null>;
}

interface Entry {
  nodes: readonly SceneNode[];
  deps: readonly unknown[];
  revision: string | number;
  base: boolean;
  scale: number;
  ox: number;
  oy: number;
  /** Zone gardée, en pixels de l'appareil au moment du dessin. */
  rx: number;
  ry: number;
  rw: number;
  rh: number;
  canvas: AnyCanvas;
  bytes: number;
  used: number;
}

export interface RenderCacheStats {
  /** Mémoire occupée par les images gardées, en Mo. */
  usedMb: number;
  budgetMb: number;
  entries: number;
  hits: number;
  misses: number;
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isPrefix(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Un objet (ou un de ses enfants) se compose avec ce qui est dessous : il ne peut pas être dessiné à part. */
function blendsWithBackdrop(n: SceneNode): boolean {
  if (n.type === 'adjustment') return n.visible;
  if (n.visible && n.blendMode && n.blendMode !== 'normal') return true;
  // Plages de fusion : le calque lit ce qui est dessous.
  if (n.visible && n.blendRanges) return true;
  return n.type === 'group' && n.children.some(blendsWithBackdrop);
}

const flowCache = new WeakMap<PoulpeDocument, boolean>();

/**
 * Le document contient-il des textes qui dépendent du reste du document (cadres liés, champs de
 * numéro de page) ? Leur dessin peut alors changer sans que leur objet change.
 */
function dependsOnDocument(doc: PoulpeDocument): boolean {
  const hit = flowCache.get(doc);
  if (hit !== undefined) return hit;
  const visit = (nodes: readonly SceneNode[]): boolean =>
    nodes.some(
      (n) =>
        (n.type === 'text' && (!!n.frame || !!n.next || hasFields(n.text))) ||
        (n.type === 'group' && visit(n.children)),
    );
  const flows = doc.artboards.some((a) => visit(a.children));
  if (Object.isFrozen(doc)) flowCache.set(doc, flows);
  return flows;
}

/** Images dont dépend le dessin d'un objet ; null : dépend de tout (symbole, réglage). */
const assetCache = new WeakMap<SceneNode, readonly string[] | null>();

/**
 * Images affichées par un objet : leurs pixels peuvent changer sans que l'objet change (image en
 * cours de décodage ou de retouche). Les symboles et les réglages dépendent de tout.
 */
function assetsOf(n: SceneNode): readonly string[] | null {
  const hit = assetCache.get(n);
  if (hit !== undefined) return hit;
  let v: string[] | null = [];
  const pattern = (p: unknown) => {
    const q = p as { type?: string; assetId?: string } | undefined;
    if (q?.type === 'pattern' && q.assetId) v!.push(q.assetId);
  };
  if (n.type === 'symbol' || n.type === 'adjustment') v = null;
  else {
    if (n.type === 'image') v.push(n.assetId);
    if (n.mask) v.push(n.mask.assetId);
    pattern((n as { fill?: unknown }).fill);
    pattern((n as { stroke?: { paint?: unknown } }).stroke?.paint);
    for (const st of (n as { strokes?: { paint?: unknown }[] }).strokes ?? []) pattern(st.paint);
    // Cadre de texte en forme : son fond et son contour.
    if (n.type === 'text' && n.frameShape) {
      pattern(n.frameShape.fill);
      pattern(n.frameShape.stroke?.paint);
    }
    if (n.type === 'group')
      for (const c of n.children) {
        const a = assetsOf(c);
        if (a === null) {
          v = null;
          break;
        }
        v.push(...a);
      }
  }
  if (Object.isFrozen(n)) assetCache.set(n, v);
  return v;
}

/** Révision des pixels affichés par une tranche de calques (-1 : aucun pixel d'image). */
function bitmapRevision(nodes: readonly SceneNode[], extra: string[]): string | number {
  const ids = [...extra];
  for (const n of nodes) {
    const a = assetsOf(n);
    if (a === null) return `*${getRenderRevision()}`;
    ids.push(...a);
  }
  if (!ids.length) return -1;
  return `${getSharedRevision()}|${ids.map(getAssetRevision).join(',')}`;
}

function makeCanvas(
  w: number,
  h: number,
  accelerated: boolean,
): { canvas: AnyCanvas; ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D } {
  if (accelerated && typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d')! };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  // Sans accélération : toile gardée en mémoire centrale.
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: !accelerated })! };
}

export class RenderCache {
  /** Mémoire maximale des images gardées, en octets (0 : pas de cache). */
  budget = 256 * 1024 * 1024;
  quality: PreviewQuality = 'balanced';
  accelerated = true;
  private entries = new Map<string, Entry>();
  private used = 0;
  private clock = 0;
  private hits = 0;
  private misses = 0;
  /** Dessins de grosses tranches confiés aux fils de dessin (null : tout se dessine ici). */
  parallel: ParallelPainter | null = null;
  /** Appelé quand une image dessinée par les fils est prête : il faut redessiner l'écran. */
  onReady: () => void = () => {};
  private pending = new Map<string, { signature: Signature; failed: boolean }>();
  private generation = 0;

  /** Oublie toutes les images (par ex. quand les réglages changent). */
  invalidate(): void {
    this.entries.clear();
    this.used = 0;
    this.pending.clear();
    this.generation++;
  }

  /** Attend la fin des dessins confiés aux fils (mesures, tests). */
  /** Attend la fin des dessins en cours ailleurs ; vrai s'il y en avait. */
  async idle(): Promise<boolean> {
    const busy = () => [...this.pending.values()].some((p) => !p.failed);
    const was = busy();
    for (let i = 0; i < 1000 && busy(); i++) await new Promise((r) => setTimeout(r, 1));
    return was;
  }

  stats(): RenderCacheStats {
    let bytes = 0;
    for (const e of this.entries.values()) bytes += e.bytes;
    return {
      usedMb: Math.round((bytes / 1048576) * 10) / 10,
      budgetMb: Math.round(this.budget / 1048576),
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /** Oublie les images des plans de travail qui n'existent plus. */
  prune(doc: PoulpeDocument): void {
    const ids = new Set(doc.artboards.map((a) => a.id));
    for (const [key, e] of this.entries)
      if (!ids.has(key.slice(0, key.lastIndexOf(':')))) {
        this.used -= e.bytes;
        this.entries.delete(key);
      }
  }

  /**
   * Dessine le contenu d'un plan de travail (fond, page maître, objets). Le contexte est dans le
   * repère du monde (`view`). `hot` : objets susceptibles de changer à chaque image (la sélection).
   * `allowStale` : la vue est en train de changer (zoom, défilement) ; une image étirée ou décalée
   * d'une fraction de pixel peut servir d'aperçu, selon la qualité d'aperçu choisie.
   * Renvoie vrai si l'image affichée est un aperçu à redessiner net plus tard.
   */
  drawArtboard(
    ctx: CanvasRenderingContext2D,
    doc: PoulpeDocument,
    ab: Artboard,
    opts: RenderOptions,
    view: CacheView,
    hot: ReadonlySet<string>,
    allowStale: boolean,
  ): boolean {
    const fields = pageFields(doc, ab);
    const pageOpts: RenderOptions = { ...opts, fields };
    const kids = ab.children;
    // Zone visible du plan de travail, en pixels de l'appareil.
    const ax0 = Math.max(0, Math.floor(ab.x * view.scale + view.ox));
    const ay0 = Math.max(0, Math.floor(ab.y * view.scale + view.oy));
    const ax1 = Math.min(view.width, Math.ceil((ab.x + ab.width) * view.scale + view.ox));
    const ay1 = Math.min(view.height, Math.ceil((ab.y + ab.height) * view.scale + view.oy));
    if (ax1 <= ax0 || ay1 <= ay0) return false;
    const need = { x0: ax0, y0: ay0, x1: ax1, y1: ay1 };
    const worldVisible = this.toWorld(need, view);

    let first = -1,
      last = -1;
    for (let i = 0; i < kids.length; i++)
      if (hot.has(kids[i].id)) {
        if (first < 0) first = i;
        last = i;
      }

    const deps = [
      doc.assets,
      doc.symbols,
      dependsOnDocument(doc) ? doc : null,
      ab.background,
      ab.x,
      ab.y,
      ab.width,
      ab.height,
      masterOf(doc, ab),
      fields.page,
      fields.pages,
      getLayoutRevision(),
      opts.editingId ?? null,
      opts.hidden ? [...opts.hidden].join() : '',
    ];

    const clip = () => {
      ctx.beginPath();
      ctx.rect(ab.x, ab.y, ab.width, ab.height);
      ctx.clip();
    };
    const live = (nodes: readonly SceneNode[], base: boolean) => {
      ctx.save();
      clip();
      this.paint(ctx, doc, ab, nodes as SceneNode[], { ...pageOpts, cull: worldVisible }, base);
      ctx.restore();
    };

    if (this.budget <= 0) {
      live(kids, true);
      return false;
    }

    let stale = false;
    const use = (seg: string, nodes: readonly SceneNode[], base: boolean): boolean => {
      const r = this.blit(ctx, ab, seg, doc, nodes, deps, base, pageOpts, view, need, allowStale);
      if (r === null) return false;
      stale ||= r;
      return true;
    };

    if (first < 0) {
      // Rien de sélectionné : tout le plan de travail en une image. Des objets ajoutés au-dessus
      // (en cours de création) sont dessinés en direct par-dessus l'image existante.
      const key = `${ab.id}:all`;
      const prev = this.entries.get(key);
      if (
        prev &&
        prev.nodes.length < kids.length &&
        kids.length - prev.nodes.length <= 20 &&
        isPrefix(prev.nodes, kids) &&
        sameList(prev.deps, deps)
      ) {
        const tail = kids.slice(prev.nodes.length);
        if (!tail.some(blendsWithBackdrop) && use('all', prev.nodes, true)) {
          live(tail, false);
          return stale;
        }
      }
      if (!use('all', kids, true)) live(kids, true);
      return stale;
    }

    // Réglages (calques d'ajustement) : ils transforment ce qui est dessous, on ne découpe pas.
    if (kids.some((n) => n.type === 'adjustment' && n.visible)) {
      live(kids, true);
      return false;
    }
    const below = kids.slice(0, first);
    const middle = kids.slice(first, last + 1);
    const above = kids.slice(last + 1);
    if (!use('below', below, true)) live(below, true);
    live(middle, false);
    if (above.length) {
      if (above.some(blendsWithBackdrop) || !use('above', above, false)) live(above, false);
    }
    return stale;
  }

  private toWorld(r: { x0: number; y0: number; x1: number; y1: number }, view: CacheView): Box {
    return {
      x: (r.x0 - view.ox) / view.scale,
      y: (r.y0 - view.oy) / view.scale,
      width: (r.x1 - r.x0) / view.scale,
      height: (r.y1 - r.y0) / view.scale,
    };
  }

  /** Fond, page maître et objets, dans le repère du monde. */
  private paint(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    doc: PoulpeDocument,
    ab: Artboard,
    nodes: SceneNode[],
    opts: RenderOptions,
    base: boolean,
  ) {
    paintSegment(ctx, doc, ab, nodes, opts, base);
  }

  /**
   * Recopie l'image d'une tranche de calques, en la redessinant si elle n'est plus bonne.
   * Renvoie null si l'image ne peut pas être gardée (trop grande), sinon vrai si c'est un aperçu.
   */
  private blit(
    ctx: CanvasRenderingContext2D,
    ab: Artboard,
    seg: string,
    doc: PoulpeDocument,
    nodes: readonly SceneNode[],
    deps: readonly unknown[],
    base: boolean,
    opts: RenderOptions,
    view: CacheView,
    need: { x0: number; y0: number; x1: number; y1: number },
    allowStale: boolean,
  ): boolean | null {
    const key = `${ab.id}:${seg}`;
    // Les pixels d'une image peuvent changer sans que son objet change : la révision du rendu
    // compte alors, sinon on l'ignore (peindre sur un calque ne redessine pas les autres).
    const master = base ? masterOf(doc, ab) : null;
    const bg = ab.background as { type: string; assetId?: string };
    const revision = bitmapRevision(
      master ? [...master.children, ...nodes] : nodes,
      base && bg.type === 'pattern' && bg.assetId ? [bg.assetId] : [],
    );
    let e = this.entries.get(key);
    let stale = false;
    let draw: { x: number; y: number; w: number; h: number } | null = null;
    if (
      e &&
      e.base === base &&
      e.revision === revision &&
      sameList(e.nodes, nodes) &&
      sameList(e.deps, deps)
    ) {
      const k = view.scale / e.scale;
      const dx = view.ox - e.ox * k,
        dy = view.oy - e.oy * k;
      const x = e.rx * k + dx,
        y = e.ry * k + dy;
      const w = e.rw * k,
        h = e.rh * k;
      const covers =
        x <= need.x0 + 0.5 && y <= need.y0 + 0.5 && x + w >= need.x1 - 0.5 && y + h >= need.y1 - 0.5;
      const exact = k === 1 && Number.isInteger(x) && Number.isInteger(y);
      if (covers && exact) draw = { x, y, w, h };
      else if ((covers || this.quality === 'fast') && allowStale && this.quality !== 'full') {
        // Aperçu : l'image est étirée (zoom) ou décalée d'une fraction de pixel (défilement).
        stale = true;
        draw = k === 1 ? { x: Math.round(x), y: Math.round(y), w, h } : { x, y, w, h };
      }
    }
    if (!draw) {
      this.misses++;
      // Qualité complète pendant un zoom : l'image changerait à chaque image, autant dessiner en direct.
      if (allowStale && this.quality === 'full') return null;
      // Zone gardée : la partie du plan de travail qui est à l'écran, plus une marge d'un écran
      // de chaque côté pour défiler et dézoomer sans redessiner.
      const rx0 = Math.max(Math.floor(ab.x * view.scale + view.ox), -view.width);
      const ry0 = Math.max(Math.floor(ab.y * view.scale + view.oy), -view.height);
      const rx1 = Math.min(Math.ceil((ab.x + ab.width) * view.scale + view.ox), 2 * view.width);
      const ry1 = Math.min(Math.ceil((ab.y + ab.height) * view.scale + view.oy), 2 * view.height);
      const rw = rx1 - rx0,
        rh = ry1 - ry0;
      if (rw <= 0 || rh <= 0) return false;
      const signature: Signature = {
        nodes,
        deps,
        revision,
        base,
        scale: view.scale,
        ox: view.ox,
        oy: view.oy,
        rx: rx0,
        ry: ry0,
        rw,
        rh,
      };
      // Grosse tranche : dessinée par les fils de dessin, sans figer l'écran. En attendant,
      // l'ancienne image sert d'aperçu ; s'il n'y en a pas (ouverture du document), le plan de
      // travail reste vide un instant. Si une autre image du même plan de travail existe
      // (changement de sélection), on dessine ici, pour ne rien faire disparaître.
      const otherShown = !e && [...this.entries.keys()].some((k) => k.startsWith(`${ab.id}:`));
      if (
        !otherShown &&
        rw * rh * 4 <= this.budget &&
        this.paintInParallel(
          key,
          {
            doc,
            ab,
            nodes,
            base,
            opts: { ...opts, cull: this.toWorld({ x0: rx0, y0: ry0, x1: rx1, y1: ry1 }, view) },
            scale: view.scale,
            ox: view.ox,
            oy: view.oy,
            x: rx0,
            y: ry0,
            width: rw,
            height: rh,
          },
          signature,
        )
      ) {
        if (!e) return false;
        e.used = ++this.clock;
        const k = view.scale / e.scale;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(
          e.canvas,
          e.rx * k + view.ox - e.ox * k,
          e.ry * k + view.oy - e.oy * k,
          e.rw * k,
          e.rh * k,
        );
        ctx.restore();
        return true;
      }
      const bytes = rw * rh * 4;
      // Une image de même taille est réutilisée : allouer une toile coûte cher.
      let reuse: AnyCanvas | null = null;
      if (e) {
        if (e.rw === rw && e.rh === rh) reuse = e.canvas;
        this.used -= e.bytes;
        this.entries.delete(key);
      }
      if (bytes > this.budget) return null;
      this.evict(bytes);
      const buf = reuse
        ? { canvas: reuse, ctx: reuse.getContext('2d') as CanvasRenderingContext2D }
        : makeCanvas(rw, rh, this.accelerated);
      buf.ctx.setTransform(1, 0, 0, 1, 0, 0);
      buf.ctx.clearRect(0, 0, rw, rh);
      buf.ctx.save();
      buf.ctx.setTransform(view.scale, 0, 0, view.scale, view.ox - rx0, view.oy - ry0);
      buf.ctx.beginPath();
      buf.ctx.rect(ab.x, ab.y, ab.width, ab.height);
      buf.ctx.clip();
      const cull = this.toWorld({ x0: rx0, y0: ry0, x1: rx1, y1: ry1 }, view);
      this.paint(buf.ctx, doc, ab, nodes as SceneNode[], { ...opts, cull }, base);
      buf.ctx.restore();
      e = {
        nodes,
        deps,
        revision,
        base,
        scale: view.scale,
        ox: view.ox,
        oy: view.oy,
        rx: rx0,
        ry: ry0,
        rw,
        rh,
        canvas: buf.canvas,
        bytes,
        used: 0,
      };
      this.entries.set(key, e);
      this.used += bytes;
      draw = { x: rx0, y: ry0, w: rw, h: rh };
    } else this.hits++;
    e!.used = ++this.clock;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (draw.w === e!.rw && draw.h === e!.rh) ctx.drawImage(e!.canvas, draw.x, draw.y);
    else ctx.drawImage(e!.canvas, draw.x, draw.y, draw.w, draw.h);
    ctx.restore();
    return stale;
  }

  /**
   * Confie une tranche aux fils de dessin. Vrai si elle est (ou sera) dessinée par eux ; faux
   * s'il faut la dessiner ici (petite tranche, contenu qu'ils ne savent pas dessiner, échec).
   */
  private paintInParallel(key: string, job: SegmentJob, signature: Signature): boolean {
    const painter = this.parallel;
    if (!painter) return false;
    const master = job.base ? masterOf(job.doc, job.ab) : null;
    if (countNodes(job.nodes) + countNodes(master?.children ?? []) < painter.minNodes) return false;
    const pending = this.pending.get(key);
    if (pending && sameSignature(pending.signature, signature)) return !pending.failed;
    if (!painter.accepts(job)) return false;
    const generation = this.generation;
    const p = { signature, failed: false };
    this.pending.set(key, p);
    void painter
      .paint(job)
      .catch(() => null)
      .then((canvas) => {
        if (generation !== this.generation || this.pending.get(key) !== p) return;
        if (!canvas) {
          // Échec : la même tranche sera dessinée ici à la prochaine image.
          p.failed = true;
          this.onReady();
          return;
        }
        this.pending.delete(key);
        const bytes = signature.rw * signature.rh * 4;
        const old = this.entries.get(key);
        if (old) {
          this.used -= old.bytes;
          this.entries.delete(key);
        }
        if (bytes > this.budget) return;
        this.evict(bytes);
        this.entries.set(key, { ...signature, canvas, bytes, used: ++this.clock });
        this.used += bytes;
        this.onReady();
      });
    return true;
  }

  /** Libère les images les moins récemment utilisées pour faire de la place. */
  private evict(bytes: number) {
    if (this.used + bytes <= this.budget) return;
    const list = [...this.entries].sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of list) {
      if (this.used + bytes <= this.budget) break;
      this.entries.delete(key);
      this.used -= e.bytes;
    }
  }
}

type Signature = Omit<Entry, 'canvas' | 'bytes' | 'used'>;

function sameSignature(a: Signature, b: Signature): boolean {
  return (
    a.base === b.base &&
    a.revision === b.revision &&
    a.scale === b.scale &&
    a.ox === b.ox &&
    a.oy === b.oy &&
    a.rx === b.rx &&
    a.ry === b.ry &&
    a.rw === b.rw &&
    a.rh === b.rh &&
    sameList(a.nodes, b.nodes) &&
    sameList(a.deps, b.deps)
  );
}

/** Nombre d'objets, enfants des groupes compris : estime le coût d'un dessin. */
function countNodes(nodes: readonly SceneNode[]): number {
  let n = 0;
  for (const c of nodes) n += c.type === 'group' ? 1 + countNodes(c.children) : 1;
  return n;
}

/** Fond, page maître et objets d'une tranche de calques, dans le repère du monde. */
export function paintSegment(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  doc: PoulpeDocument,
  ab: Artboard,
  nodes: SceneNode[],
  opts: RenderOptions,
  base: boolean,
): void {
  const frame = { x: ab.x, y: ab.y, width: ab.width, height: ab.height };
  if (base) {
    ctx.save();
    ctx.translate(ab.x, ab.y);
    const bg = canvasPaint(ctx, ab.background, ab.width, ab.height, doc, opts.images);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, ab.width, ab.height);
    }
    ctx.restore();
    const master = masterOf(doc, ab);
    if (master) {
      const dx = ab.x - master.x,
        dy = ab.y - master.y;
      ctx.save();
      ctx.translate(dx, dy);
      const cull = opts.cull && { ...opts.cull, x: opts.cull.x - dx, y: opts.cull.y - dy };
      drawChildren(
        ctx,
        doc,
        master.children,
        { ...opts, cull },
        {
          x: master.x,
          y: master.y,
          width: master.width,
          height: master.height,
        },
      );
      ctx.restore();
    }
  }
  drawChildren(ctx, doc, nodes, opts, frame);
}
