import {
  findArtboard,
  findNode,
  floodMask,
  gaussianBlurred,
  maskOutline,
  refineMask,
  type Box,
  type ImageNode,
  type RefineOptions,
  type Vec,
} from '@poulpe/core';
import { drawArtboard, type ImageCache } from '@poulpe/render';
import { editor, ui, type SelectionMode } from '../store';
import { recordStep } from '../macros/recorder';

/*
 * Sélection de pixels de la Persona Photo (rectangle, ellipse, lasso, baguette magique).
 *
 * C'est un masque : une toile dont seule l'opacité compte, posée sur le plan de travail actif.
 * Sa résolution suit celle de la photo (`scale` pixels du masque par pixel du document), pour que
 * les bords restent nets sur une grande image. La sélection ne fait pas partie du document, mais
 * elle suit l'historique (Ctrl+Z revient à la sélection précédente) : chaque étape garde une copie
 * compacte du masque (opacité compressée par plages). Une sélection n'est jamais modifiée sur
 * place : chaque opération en crée une nouvelle.
 */

export interface SelectionMask {
  canvas: HTMLCanvasElement;
  /** Coin haut gauche, en coordonnées du document. */
  x: number;
  y: number;
  /** Pixels du masque par pixel du document. */
  scale: number;
}

const MAX_SIDE = 4096;
let current: SelectionMask | null = null;
let version = 0;
let outlineCache: { version: number; lines: number[][]; k: number } | null = null;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function changed(): void {
  version++;
  outlineCache = null;
  ui.set({ hasPixelSelection: current !== null });
}

/** Copie compacte d'une sélection pour l'historique. */
interface Snapshot {
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
  /** Opacité par plages : valeur, puis longueur de la plage. */
  values: Uint8Array;
  counts: Uint32Array;
}

let snapCache: { version: number; snap: Snapshot | null } | null = null;

function encode(m: SelectionMask): Snapshot {
  const { width: w, height: h } = m.canvas;
  const d = m.canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const values: number[] = [];
  const counts: number[] = [];
  let v = d[3],
    n = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] === v) n++;
    else {
      values.push(v);
      counts.push(n);
      v = d[i];
      n = 1;
    }
  }
  values.push(v);
  counts.push(n);
  return {
    x: m.x,
    y: m.y,
    scale: m.scale,
    width: w,
    height: h,
    values: Uint8Array.from(values),
    counts: Uint32Array.from(counts),
  };
}

function decode(s: Snapshot): SelectionMask {
  const canvas = makeCanvas(s.width, s.height);
  const img = new ImageData(s.width, s.height);
  const d = img.data;
  let p = 0;
  for (let r = 0; r < s.values.length; r++) {
    const v = s.values[r];
    for (let k = 0; k < s.counts[r]; k++, p += 4) {
      d[p] = d[p + 1] = d[p + 2] = 255;
      d[p + 3] = v;
    }
  }
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return { canvas, x: s.x, y: s.y, scale: s.scale };
}

/** État de la sélection pour l'historique (calculé une fois par version). */
function snapshot(): Snapshot | null {
  if (!snapCache || snapCache.version !== version)
    snapCache = { version, snap: current ? encode(current) : null };
  return snapCache.snap;
}

function restore(value: unknown): void {
  const s = (value ?? null) as Snapshot | null;
  if (snapCache && snapCache.version === version && snapCache.snap === s) return;
  current = s ? decode(s) : null;
  changed();
  snapCache = { version, snap: s };
}

editor.setExtraState({ get: snapshot, set: restore });

/** Remplace la sélection et enregistre l'étape dans l'historique. */
function commit(next: SelectionMask | null, label = 'history.selection'): void {
  const before = snapshot();
  current = next;
  changed();
  editor.mark(label, before);
}

function cloneMask(m: SelectionMask): SelectionMask {
  const canvas = makeCanvas(m.canvas.width, m.canvas.height);
  canvas.getContext('2d')!.drawImage(m.canvas, 0, 0);
  return { ...m, canvas };
}

export function getSelection(): SelectionMask | null {
  return current;
}

export function selectionVersion(): number {
  return version;
}

/**
 * Retire la sélection. `record` faux : sans étape d'historique (après une commande qui utilise la
 * sélection, comme Copier sur un calque : l'annuler fait revenir la sélection).
 */
export function clearSelection(record = true): void {
  if (!current) return;
  if (record) commit(null, 'history.deselect');
  else {
    current = null;
    changed();
  }
}

/** Densité de la photo sélectionnée (pixels de l'image par pixel du document). */
function density(): number {
  const sel = editor.selection;
  let d = 1;
  for (const id of sel) {
    const n = findNode(editor.doc, id)?.node;
    if (n?.type === 'image') {
      const a = editor.doc.assets[n.assetId];
      if (a) d = Math.max(d, (a.width * (n.crop?.width ?? 1)) / Math.max(1, n.width));
    }
  }
  return d;
}

/** Cadre d'une nouvelle sélection : le plan de travail actif, à la résolution de la photo. */
function frame(): { box: Box; scale: number } | null {
  const ab = findArtboard(editor.doc, editor.getState().activeArtboardId) ?? editor.doc.artboards[0];
  if (!ab) return null;
  if (current)
    return {
      box: {
        x: current.x,
        y: current.y,
        width: current.canvas.width / current.scale,
        height: current.canvas.height / current.scale,
      },
      scale: current.scale,
    };
  const scale = Math.min(density(), MAX_SIDE / Math.max(ab.width, ab.height));
  return { box: { x: ab.x, y: ab.y, width: ab.width, height: ab.height }, scale: Math.max(0.25, scale) };
}

/** Nouvelle toile de masque vide, dans le cadre de la sélection. */
function blank(): SelectionMask | null {
  const f = frame();
  if (!f) return null;
  return {
    canvas: makeCanvas(f.box.width * f.scale, f.box.height * f.scale),
    x: f.box.x,
    y: f.box.y,
    scale: f.scale,
  };
}

/** Ctx dessinant en coordonnées du document dans un masque. */
function docCtx(m: SelectionMask): CanvasRenderingContext2D {
  const ctx = m.canvas.getContext('2d')!;
  ctx.setTransform(m.scale, 0, 0, m.scale, -m.x * m.scale, -m.y * m.scale);
  return ctx;
}

/** Floute l'opacité d'un masque (adoucissement), `radius` en pixels du document. */
function blurMask(m: SelectionMask, radius: number): void {
  if (radius <= 0) return;
  const ctx = m.canvas.getContext('2d')!;
  const { width: w, height: h } = m.canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const out = gaussianBlurred({ data: img.data, width: w, height: h }, (radius * m.scale) / 2);
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}

/** Combine une forme (masque dans le même cadre) avec la sélection courante. */
function combine(shape: SelectionMask, mode: SelectionMode): void {
  if (mode === 'replace' || !current) {
    if (mode === 'subtract' || mode === 'intersect') {
      if (current) commit(null);
      return;
    }
    commit(shape);
    return;
  }
  const next = cloneMask(current);
  const ctx = next.canvas.getContext('2d')!;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation =
    mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
  ctx.drawImage(shape.canvas, 0, 0);
  ctx.restore();
  commit(isEmpty(next) ? null : next);
}

function isEmpty(m: SelectionMask): boolean {
  // Échantillonnage rapide sur une petite copie.
  const s = makeCanvas(Math.min(256, m.canvas.width), Math.min(256, m.canvas.height));
  const ctx = s.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(m.canvas, 0, 0, s.width, s.height);
  const d = ctx.getImageData(0, 0, s.width, s.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
  return true;
}

/**
 * Sélection rectangulaire, elliptique ou à main levée (points du document). Sans `antialias`, le
 * bord est net (chaque pixel est dedans ou dehors).
 */
export function selectShape(
  kind: 'rect' | 'ellipse' | 'polygon',
  points: Vec[],
  mode: SelectionMode,
  antialias = true,
): void {
  const shape = blank();
  if (!shape || points.length < 2) return;
  const ctx = docCtx(shape);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  if (kind === 'polygon') {
    ctx.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  } else {
    const [a, b] = points;
    const x = Math.min(a.x, b.x),
      y = Math.min(a.y, b.y),
      w = Math.abs(b.x - a.x),
      h = Math.abs(b.y - a.y);
    if (w < 0.5 || h < 0.5) {
      if (mode === 'replace') clearSelection();
      return;
    }
    if (kind === 'rect') ctx.rect(x, y, w, h);
    else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  if (!antialias) {
    const { width: w, height: h } = shape.canvas;
    const raw = shape.canvas.getContext('2d')!;
    const img = raw.getImageData(0, 0, w, h);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= 128 ? 255 : 0;
    raw.putImageData(img, 0, 0);
  }
  blurMask(shape, ui.get().feather);
  combine(shape, mode);
}

/** Baguette magique : pixels semblables, d'après l'image visible du plan de travail. */
export function selectSimilar(p: Vec, images: ImageCache, mode: SelectionMode): void {
  const shape = blank();
  if (!shape) return;
  const ab = editor.doc.artboards.find(
    (a) => p.x >= a.x && p.y >= a.y && p.x <= a.x + a.width && p.y <= a.y + a.height,
  );
  if (!ab) return;
  const { width: w, height: h } = shape.canvas;
  const src = makeCanvas(w, h);
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  sctx.setTransform(shape.scale, 0, 0, shape.scale, -shape.x * shape.scale, -shape.y * shape.scale);
  drawArtboard(sctx, editor.doc, ab, { images });
  const px = sctx.getImageData(0, 0, w, h);
  const mask = floodMask(
    { data: px.data, width: w, height: h },
    (p.x - shape.x) * shape.scale,
    (p.y - shape.y) * shape.scale,
    ui.get().tolerance,
    ui.get().contiguous,
  );
  const out = new ImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
    out.data[i * 4 + 3] = mask[i];
  }
  shape.canvas.getContext('2d')!.putImageData(out, 0, 0);
  combine(shape, mode);
}

export function selectAll(): void {
  const keep = current;
  current = null;
  const m = blank();
  current = keep;
  if (!m) return;
  const ctx = m.canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, m.canvas.width, m.canvas.height);
  commit(m);
}

export function invertSelection(): void {
  const m = blank();
  if (!m) return;
  const ctx = m.canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, m.canvas.width, m.canvas.height);
  if (current) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(current.canvas, 0, 0);
  }
  commit(isEmpty(m) ? null : m);
}

/** Adoucir, agrandir ou réduire la sélection, de `radius` pixels du document. */
export function modifySelection(kind: 'feather' | 'grow' | 'shrink', radius: number): void {
  if (!current || radius <= 0) return;
  recordStep({ kind: 'selectionModify', mode: kind, radius });
  const m = cloneMask(current);
  if (kind === 'feather') {
    blurMask(m, radius * 2);
  } else {
    // Agrandir ou réduire : flou puis seuil bas (agrandir) ou haut (réduire).
    blurMask(m, radius * 2);
    const ctx = m.canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, m.canvas.width, m.canvas.height);
    const d = img.data;
    const [lo, hi] = kind === 'grow' ? [4, 40] : [215, 251];
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i];
      d[i] = a <= lo ? 0 : a >= hi ? 255 : Math.round(((a - lo) / (hi - lo)) * 255);
      d[i - 3] = d[i - 2] = d[i - 1] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  commit(isEmpty(m) ? null : m);
}

/** Aperçu d'une forme combinée à une sélection de départ, dans la toile `into` (réutilisée). */
function mixInto(
  into: SelectionMask,
  base: SelectionMask | null,
  shape: SelectionMask,
  mode: SelectionMode,
): void {
  const ctx = into.canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'copy';
  if (base && mode !== 'replace') {
    ctx.drawImage(base.canvas, 0, 0);
    ctx.globalCompositeOperation =
      mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
  } else if (mode === 'subtract' || mode === 'intersect') {
    // Retirer ou garder l'intersection sans sélection de départ : rien n'est sélectionné.
    ctx.clearRect(0, 0, into.canvas.width, into.canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  ctx.drawImage(shape.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Sélection par remplissage (baguette magique, comme dans Affinity) : le clic sélectionne les
 * pixels de couleur proche, puis glisser règle la tolérance en direct. `paint` dessine les pixels
 * comparés (tous les calques, ou le calque choisi) en coordonnées du document. Tout le geste
 * compte pour une seule étape d'historique.
 */
export class FloodSelect {
  private before: unknown;
  private preview: SelectionMask;
  /** Opacité du masque, réutilisée d'une mise à jour à l'autre (le blanc ne change pas). */
  private out: ImageData;

  private constructor(
    private base: SelectionMask | null,
    private shape: SelectionMask,
    private px: ImageData,
    private at: Vec,
    private mode: SelectionMode,
  ) {
    this.before = snapshot();
    this.preview = { ...shape, canvas: makeCanvas(shape.canvas.width, shape.canvas.height) };
    this.out = new ImageData(px.width, px.height);
    this.out.data.fill(255);
  }

  static start(
    p: Vec,
    mode: SelectionMode,
    paint: (ctx: CanvasRenderingContext2D) => void,
  ): FloodSelect | null {
    const shape = blank();
    if (!shape) return null;
    const { width: w, height: h } = shape.canvas;
    const src = makeCanvas(w, h);
    const sctx = src.getContext('2d', { willReadFrequently: true })!;
    sctx.setTransform(shape.scale, 0, 0, shape.scale, -shape.x * shape.scale, -shape.y * shape.scale);
    paint(sctx);
    const at = { x: (p.x - shape.x) * shape.scale, y: (p.y - shape.y) * shape.scale };
    if (at.x < 0 || at.y < 0 || at.x >= w || at.y >= h) return null;
    return new FloodSelect(current, shape, sctx.getImageData(0, 0, w, h), at, mode);
  }

  /** Recalcule la sélection avec cette tolérance (0 à 255) et l'affiche, sans étape d'historique. */
  update(tolerance: number, contiguous: boolean): void {
    const mask = floodMask(this.px, this.at.x, this.at.y, tolerance, contiguous);
    const d = this.out.data;
    for (let i = 0; i < mask.length; i++) d[i * 4 + 3] = mask[i];
    this.shape.canvas.getContext('2d')!.putImageData(this.out, 0, 0);
    mixInto(this.preview, this.base, this.shape, this.mode);
    current = this.preview;
    changed();
  }

  /** Fin du geste : une étape d'historique. */
  end(): void {
    if (current && isEmpty(current)) current = null;
    changed();
    editor.mark('history.selection', this.before);
  }
}

/**
 * Affiner la sélection : aperçu en direct depuis la sélection de départ (sans historique), puis
 * une seule étape quand on valide. Les rayons sont en pixels du document.
 */
export class SelectionRefine {
  private before: unknown;
  private constructor(private base: SelectionMask) {
    this.before = snapshot();
  }

  static start(): SelectionRefine | null {
    return current ? new SelectionRefine(current) : null;
  }

  preview(o: RefineOptions): void {
    const m = cloneMask(this.base);
    const k = m.scale;
    if (o.adjust || o.smooth > 0 || o.feather > 0) {
      const ctx = m.canvas.getContext('2d', { willReadFrequently: true })!;
      const img = ctx.getImageData(0, 0, m.canvas.width, m.canvas.height);
      refineMask(img, { adjust: o.adjust * k, smooth: o.smooth * k, feather: o.feather * k });
      ctx.putImageData(img, 0, 0);
    }
    current = m;
    changed();
  }

  apply(): void {
    if (current && isEmpty(current)) current = null;
    changed();
    editor.mark('history.selectionRefine', this.before);
  }

  cancel(): void {
    current = this.base;
    changed();
  }
}

/** Sélection d'après l'opacité d'un calque de pixels. */
export function selectFromLayer(node: ImageNode, images: ImageCache): void {
  const keep = current;
  current = null;
  const m = blank();
  current = keep;
  if (!m) return;
  const img = images.get(editor.doc, node.assetId);
  if (!img) return;
  const ctx = docCtx(m);
  ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
  ctx.rotate((node.rotation * Math.PI) / 180);
  ctx.translate(-node.width / 2, -node.height / 2);
  const c = node.crop;
  const iw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const ih = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  if (c) ctx.drawImage(img, c.x * iw, c.y * ih, c.width * iw, c.height * ih, 0, 0, node.width, node.height);
  else ctx.drawImage(img, 0, 0, node.width, node.height);
  commit(isEmpty(m) ? null : m);
}

/**
 * Contour de la sélection pour les fourmis, en lignes brisées du document. Calculé sur une
 * copie réduite du masque, et mémorisé tant que la sélection ne change pas.
 */
export function selectionOutline(): { lines: number[][]; toDoc: (x: number, y: number) => Vec } | null {
  const m = current;
  if (!m) return null;
  if (!outlineCache || outlineCache.version !== version) {
    const k = Math.min(1, 1200 / Math.max(m.canvas.width, m.canvas.height));
    const w = Math.max(1, Math.round(m.canvas.width * k)),
      h = Math.max(1, Math.round(m.canvas.height * k));
    const s = makeCanvas(w, h);
    const ctx = s.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(m.canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
    outlineCache = { version, lines: maskOutline(alpha, w, h), k: (m.canvas.width / w) * m.scale };
  }
  const { lines, k } = outlineCache;
  return { lines, toDoc: (x, y) => ({ x: m.x + x / k, y: m.y + y / k }) };
}

/**
 * La sélection dessinée dans un autre repère : `toTarget` passe des coordonnées du document à
 * celles de la toile cible (pixels d'un calque, de son masque…). Renvoie null sans sélection.
 */
export function selectionIn(width: number, height: number, toTarget: DOMMatrix): HTMLCanvasElement | null {
  const m = current;
  if (!m) return null;
  const c = makeCanvas(width, height);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(toTarget.multiply(new DOMMatrix().translate(m.x, m.y).scale(1 / m.scale)));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(m.canvas, 0, 0);
  return c;
}

/**
 * Sélection d'après un masque d'opacité posé sur un calque image (le sujet trouvé par le
 * détourage automatique). `matte` couvre la partie visible (recadrée) de l'image.
 */
export function selectFromMatte(node: ImageNode, matte: HTMLCanvasElement, mode: SelectionMode): void {
  const keep = mode === 'replace' ? null : current;
  current = null;
  const shape = blank();
  current = keep;
  if (!shape) return;
  const ctx = docCtx(shape);
  ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
  ctx.rotate((node.rotation * Math.PI) / 180);
  ctx.translate(-node.width / 2, -node.height / 2);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(matte, 0, 0, node.width, node.height);
  if (mode === 'replace' && isEmpty(shape)) {
    clearSelection();
    return;
  }
  combine(shape, mode);
}

/**
 * Sélection rapide : on peint sur une zone et la sélection s'étend aux pixels voisins de couleur
 * proche (dans un rayon de quelques tailles de pinceau autour de chaque touche), comme l'outil
 * Sélection rapide de Photoshop et le pinceau de sélection d'Affinity. Tout le geste compte pour
 * une seule étape d'historique.
 */
export class QuickSelect {
  private shape: SelectionMask;
  private px: ImageData;
  private base: SelectionMask | null;
  private before: unknown;
  private stamp: HTMLCanvasElement;

  private constructor(
    shape: SelectionMask,
    px: ImageData,
    private mode: SelectionMode,
  ) {
    this.shape = shape;
    this.px = px;
    this.base = current;
    this.before = snapshot();
    this.stamp = makeCanvas(1, 1);
  }

  static start(p: Vec, images: ImageCache, mode: SelectionMode): QuickSelect | null {
    const shape = blank();
    if (!shape) return null;
    const ab = editor.doc.artboards.find(
      (a) => p.x >= a.x && p.y >= a.y && p.x <= a.x + a.width && p.y <= a.y + a.height,
    );
    if (!ab) return null;
    const { width: w, height: h } = shape.canvas;
    const src = makeCanvas(w, h);
    const sctx = src.getContext('2d', { willReadFrequently: true })!;
    sctx.setTransform(shape.scale, 0, 0, shape.scale, -shape.x * shape.scale, -shape.y * shape.scale);
    drawArtboard(sctx, editor.doc, ab, { images });
    return new QuickSelect(
      shape,
      sctx.getImageData(0, 0, w, h),
      mode === 'replace' && current ? 'add' : mode,
    );
  }

  /** Une touche du pinceau en `p` (document), de rayon `radius` (document). */
  dab(p: Vec, radius: number): void {
    const { shape, px } = this;
    const k = shape.scale;
    const W = px.width,
      H = px.height;
    const cx = (p.x - shape.x) * k,
      cy = (p.y - shape.y) * k;
    const r = Math.max(1, radius * k);
    const R = Math.ceil(r * 3);
    const x0 = Math.max(0, Math.floor(cx - R)),
      y0 = Math.max(0, Math.floor(cy - R));
    const x1 = Math.min(W, Math.ceil(cx + R)),
      y1 = Math.min(H, Math.ceil(cy + R));
    const w = x1 - x0,
      h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const d = px.data;
    // Couleur moyenne sous le pinceau : plus stable qu'un seul pixel.
    let sr = 0,
      sg = 0,
      sb = 0,
      n = 0;
    const r2 = r * r;
    for (let y = Math.max(y0, Math.floor(cy - r)); y < Math.min(y1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(x0, Math.floor(cx - r)); x < Math.min(x1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
        const i = (y * W + x) * 4;
        sr += d[i];
        sg += d[i + 1];
        sb += d[i + 2];
        n++;
      }
    if (!n) return;
    sr /= n;
    sg /= n;
    sb /= n;
    const tol = Math.max(8, ui.get().tolerance);
    const close = (x: number, y: number) => {
      const i = (y * W + x) * 4;
      return Math.max(Math.abs(d[i] - sr), Math.abs(d[i + 1] - sg), Math.abs(d[i + 2] - sb)) <= tol;
    };
    // Croissance de région depuis le disque du pinceau, limitée à la fenêtre.
    const mask = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if ((x0 + x - cx) ** 2 + (y0 + y - cy) ** 2 <= r2) {
          mask[y * w + x] = 1;
          stack.push(y * w + x);
        }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w,
        y = (i / w) | 0;
      const visit = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const j = ny * w + nx;
        if (mask[j] || !close(x0 + nx, y0 + ny)) return;
        mask[j] = 1;
        stack.push(j);
      };
      visit(x - 1, y);
      visit(x + 1, y);
      visit(x, y - 1);
      visit(x, y + 1);
    }
    const img = new ImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = img.data[i * 4 + 3] = 255;
    }
    if (this.stamp.width < w || this.stamp.height < h) {
      this.stamp.width = Math.max(this.stamp.width, w);
      this.stamp.height = Math.max(this.stamp.height, h);
    }
    const sc = this.stamp.getContext('2d')!;
    sc.clearRect(0, 0, w, h);
    sc.putImageData(img, 0, 0);
    shape.canvas.getContext('2d')!.drawImage(this.stamp, 0, 0, w, h, x0, y0, w, h);
    this.preview();
  }

  private preview(): void {
    if (!this.base || this.mode === 'replace') {
      current = this.mode === 'subtract' || this.mode === 'intersect' ? this.base : this.shape;
    } else {
      const next = cloneMask(this.base);
      const ctx = next.canvas.getContext('2d')!;
      ctx.globalCompositeOperation =
        this.mode === 'add' ? 'source-over' : this.mode === 'subtract' ? 'destination-out' : 'destination-in';
      ctx.drawImage(this.shape.canvas, 0, 0);
      current = next;
    }
    changed();
  }

  /** Fin du geste : une étape d'historique. */
  end(): void {
    if (current && isEmpty(current)) {
      current = null;
      changed();
    }
    editor.mark('history.selection', this.before);
  }
}
