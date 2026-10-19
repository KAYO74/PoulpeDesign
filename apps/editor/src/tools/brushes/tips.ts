import { Store } from '../../store';

/*
 * Formes de pinceau (version 1.2.8) : une image en niveaux de gris qui remplace la touche ronde.
 * On les crée depuis une image (le sombre peint, ou l'opacité d'un PNG transparent) ou on les
 * importe depuis des pinceaux Photoshop (.abr). Elles sont gardées d'une session à l'autre.
 */

export interface BrushTip {
  id: string;
  name: string;
  /** Image PNG (data URL) : l'opacité dit où le pinceau peint. */
  data: string;
  w: number;
  h: number;
}

const KEY = 'poulpe.brushTips';
/** Plus grand côté d'une forme : assez pour de gros pinceaux, sans alourdir le stockage. */
export const TIP_MAX = 256;

function load(): BrushTip[] {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) ?? '[]') as BrushTip[];
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

export const brushTips = new Store<{ list: BrushTip[] }>({ list: load() });
brushTips.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(brushTips.get().list));
  } catch {
    /* stockage plein ou indisponible : les formes restent pour la session */
  }
});

const decoded = new Map<string, HTMLCanvasElement>();

/** Forme prête à peindre (masque dans le canal alpha), ou null tant qu'elle n'est pas décodée. */
export function tipCanvas(id: string | undefined): HTMLCanvasElement | null {
  if (!id) return null;
  const hit = decoded.get(id);
  if (hit) return hit;
  const tip = brushTips.get().list.find((t) => t.id === id);
  if (!tip) return null;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.drawImage(img, 0, 0);
    decoded.set(id, c);
    brushTips.set((s) => ({ ...s }));
  };
  img.src = tip.data;
  return null;
}

/** Décode d'avance les formes enregistrées : la première touche les trouve prêtes. */
export function preloadTips(): void {
  for (const t of brushTips.get().list) tipCanvas(t.id);
}

const newId = () => `tip-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Masque (0 à 255, 255 = peint) vers une forme : recadré sur ce qui peint, ramené à TIP_MAX.
 * Rend null si rien ne peint.
 */
export function tipFromMask(
  mask: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  name: string,
): BrushTip | null {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1,
    ch = y1 - y0 + 1;
  const src = document.createElement('canvas');
  src.width = cw;
  src.height = ch;
  const sctx = src.getContext('2d')!;
  const img = sctx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = mask[(y + y0) * w + x + x0];
    }
  sctx.putImageData(img, 0, 0);
  const k = Math.min(1, TIP_MAX / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * k));
  out.height = Math.max(1, Math.round(ch * k));
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(src, 0, 0, out.width, out.height);
  const tip = { id: newId(), name, data: out.toDataURL('image/png'), w: out.width, h: out.height };
  decoded.set(tip.id, out);
  return tip;
}

/**
 * Masque d'une image, comme « Définir une forme de pinceau » de Photoshop : le sombre peint. Une
 * image transparente (PNG détouré) peint là où elle est opaque.
 */
export function maskFromImage(data: ImageData): Uint8ClampedArray {
  const n = data.width * data.height;
  const px = data.data;
  let transparent = false;
  for (let i = 0; i < n; i++)
    if (px[i * 4 + 3] < 250) {
      transparent = true;
      break;
    }
  const mask = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3];
    if (transparent) mask[i] = a;
    else {
      const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      mask[i] = 255 - lum;
    }
  }
  return mask;
}

export function addTips(tips: BrushTip[]): void {
  if (tips.length) brushTips.set((s) => ({ list: [...s.list, ...tips] }));
}

export function deleteTip(id: string): void {
  decoded.delete(id);
  brushTips.set((s) => ({ list: s.list.filter((t) => t.id !== id) }));
}

/** Crée une forme depuis un fichier image (PNG, JPEG, WebP…). */
export async function tipFromImageFile(file: Blob, name: string): Promise<BrushTip | null> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)),
    h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return tipFromMask(maskFromImage(ctx.getImageData(0, 0, w, h)), w, h, name);
}

// ————— Pinceaux Photoshop (.abr) —————

/** Forme lue dans un fichier de pinceaux : masque en niveaux de gris (255 = peint). */
export interface RawTip {
  name: string;
  w: number;
  h: number;
  mask: Uint8Array;
}

class Reader {
  pos = 0;
  constructor(readonly v: DataView) {}
  get left() {
    return this.v.byteLength - this.pos;
  }
  u8() {
    return this.v.getUint8(this.pos++);
  }
  i16() {
    const n = this.v.getInt16(this.pos);
    this.pos += 2;
    return n;
  }
  u16() {
    const n = this.v.getUint16(this.pos);
    this.pos += 2;
    return n;
  }
  i32() {
    const n = this.v.getInt32(this.pos);
    this.pos += 4;
    return n;
  }
  u32() {
    const n = this.v.getUint32(this.pos);
    this.pos += 4;
    return n;
  }
  str(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  bytes(n: number) {
    if (n < 0 || n > this.left) throw new Error('abr: truncated');
    const b = new Uint8Array(this.v.buffer, this.v.byteOffset + this.pos, n);
    this.pos += n;
    return b;
  }
}

/** Pixels d'une forme : bruts, ou compressés ligne par ligne (PackBits, comme les PSD). */
function readSampled(r: Reader, w: number, h: number, depth: number, compressed: boolean): Uint8Array {
  const bpp = depth === 16 ? 2 : 1;
  const rowBytes = w * bpp;
  let raw: Uint8Array;
  if (!compressed) raw = r.bytes(rowBytes * h);
  else {
    const counts: number[] = [];
    for (let y = 0; y < h; y++) counts.push(r.u16());
    raw = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y++) {
      const row = r.bytes(counts[y]);
      unpackBits(row, raw, y * rowBytes, rowBytes);
    }
  }
  if (bpp === 1) return raw;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = raw[i * 2];
  return out;
}

/** Décompression PackBits d'une ligne. */
export function unpackBits(src: Uint8Array, dst: Uint8Array, at: number, len: number): void {
  let i = 0,
    o = at;
  const end = at + len;
  while (i < src.length && o < end) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) {
      for (let k = 0; k <= n && o < end; k++) dst[o++] = src[i++];
    } else if (n !== -128) {
      const v = src[i++];
      for (let k = 0; k < 1 - n && o < end; k++) dst[o++] = v;
    }
  }
}

/** Anciens fichiers (Photoshop 5 à 7) : formes « échantillonnées » seulement. */
function abrV12(r: Reader, version: number): RawTip[] {
  const count = r.u16();
  const out: RawTip[] = [];
  for (let n = 0; n < count && r.left > 6; n++) {
    const type = r.u16();
    const size = r.u32();
    const next = r.pos + size;
    if (type === 2) {
      r.u32(); // inconnu
      r.u16(); // espacement
      let name = '';
      if (version === 2) {
        const len = r.u32();
        for (let i = 0; i < len; i++) {
          const c = r.u16();
          if (c) name += String.fromCharCode(c);
        }
      }
      r.u8(); // lissage
      r.bytes(8); // limites courtes
      const top = r.i32(),
        left = r.i32(),
        bottom = r.i32(),
        right = r.i32();
      const depth = r.u16();
      const compressed = r.u8() === 1;
      const w = right - left,
        h = bottom - top;
      if (w > 0 && h > 0 && w * h < 25e6)
        out.push({ name: name || `ABR ${n + 1}`, w, h, mask: readSampled(r, w, h, depth, compressed) });
    }
    r.pos = next;
  }
  return out;
}

/** Fichiers récents (Photoshop CS et suivants) : bloc « samp » des formes. */
function abrV6(r: Reader, subversion: number): RawTip[] {
  // Recherche du bloc 8BIM « samp ».
  let end = -1;
  while (r.left >= 12) {
    const sig = r.str(4);
    const key = r.str(4);
    const len = r.u32();
    if (sig !== '8BIM') return [];
    if (key === 'samp') {
      end = r.pos + len;
      break;
    }
    r.pos += len;
  }
  if (end < 0) return [];
  const out: RawTip[] = [];
  while (r.pos + 4 < end) {
    let size = r.u32();
    while (size % 4) size++;
    const next = r.pos + size;
    try {
      r.pos += subversion === 1 ? 47 : 301;
      const top = r.i32(),
        left = r.i32(),
        bottom = r.i32(),
        right = r.i32();
      const depth = r.u16();
      const compressed = r.u8() === 1;
      const w = right - left,
        h = bottom - top;
      if (w > 0 && h > 0 && w * h < 25e6)
        out.push({ name: `ABR ${out.length + 1}`, w, h, mask: readSampled(r, w, h, depth, compressed) });
    } catch {
      /* forme abîmée : on passe à la suivante */
    }
    r.pos = next;
  }
  return out;
}

/** Lit les formes d'un fichier de pinceaux Photoshop (.abr). */
export function parseAbr(buf: ArrayBuffer): RawTip[] {
  const r = new Reader(new DataView(buf));
  if (r.left < 4) return [];
  const version = r.u16();
  try {
    if (version === 1 || version === 2) return abrV12(r, version);
    if (version === 6 || version === 7 || version === 10) return abrV6(r, r.u16());
  } catch {
    /* fichier abîmé : on garde ce qui a été lu */
  }
  return [];
}

/** Importe les formes d'un fichier .abr ; rend le nombre de formes ajoutées. */
export function importAbr(buf: ArrayBuffer, fileName: string): BrushTip[] {
  const base = fileName.replace(/\.abr$/i, '');
  const tips = parseAbr(buf)
    .map((t, i) => tipFromMask(t.mask, t.w, t.h, `${base} ${i + 1}`))
    .filter((t): t is BrushTip => !!t);
  addTips(tips);
  return tips;
}
