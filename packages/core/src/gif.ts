/*
 * Encodeur GIF animé (GIF89a), sans dépendance : une palette commune à toutes les images
 * (coupe médiane sur un histogramme 15 bits), compression LZW, boucle infinie. Sert à l'export
 * des animations.
 */

export interface GifFrame {
  /** Pixels RGBA (non prémultipliés), largeur × hauteur × 4. */
  data: Uint8ClampedArray;
  /** Durée d'affichage en centièmes de seconde. */
  delay: number;
}

/** Clé 15 bits (5 bits par composante) d'une couleur. */
const key15 = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

interface Box {
  keys: number[];
  count: number;
}

/** Palette d'au plus `max` couleurs par coupe médiane sur l'histogramme des couleurs. */
function medianCut(hist: Uint32Array, max: number): number[][] {
  const keys: number[] = [];
  for (let k = 0; k < hist.length; k++) if (hist[k]) keys.push(k);
  if (!keys.length) return [[0, 0, 0]];
  const comp = (k: number, c: number) => (k >> (10 - c * 5)) & 31;
  const boxes: Box[] = [{ keys, count: keys.reduce((n, k) => n + hist[k], 0) }];
  while (boxes.length < max) {
    // On coupe la boîte la plus peuplée qui a encore plus d'une couleur.
    let bi = -1;
    for (let i = 0; i < boxes.length; i++)
      if (boxes[i].keys.length > 1 && (bi < 0 || boxes[i].count > boxes[bi].count)) bi = i;
    if (bi < 0) break;
    const box = boxes[bi];
    let axis = 0,
      span = -1;
    for (let c = 0; c < 3; c++) {
      let lo = 31,
        hi = 0;
      for (const k of box.keys) {
        const v = comp(k, c);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > span) {
        span = hi - lo;
        axis = c;
      }
    }
    box.keys.sort((a, b) => comp(a, axis) - comp(b, axis));
    let acc = 0,
      cut = 1;
    for (let i = 0; i < box.keys.length - 1; i++) {
      acc += hist[box.keys[i]];
      cut = i + 1;
      if (acc >= box.count / 2) break;
    }
    const a = box.keys.slice(0, cut),
      b = box.keys.slice(cut);
    const sum = (ks: number[]) => ks.reduce((n, k) => n + hist[k], 0);
    boxes.splice(bi, 1, { keys: a, count: sum(a) }, { keys: b, count: sum(b) });
  }
  return boxes.map((box) => {
    let r = 0,
      g = 0,
      b = 0;
    for (const k of box.keys) {
      const n = hist[k];
      r += (comp(k, 0) * 8 + 4) * n;
      g += (comp(k, 1) * 8 + 4) * n;
      b += (comp(k, 2) * 8 + 4) * n;
    }
    const n = box.count || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

/** Compression LZW des indices de couleur, en sous-blocs GIF. */
function lzw(indices: Uint8Array, minCode: number, out: number[]): void {
  const clear = 1 << minCode,
    eoi = clear + 1;
  let size = minCode + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();
  const bytes: number[] = [];
  let bit = 0,
    cur = 0;
  const emit = (code: number) => {
    cur |= code << bit;
    bit += size;
    while (bit >= 8) {
      bytes.push(cur & 0xff);
      cur >>>= 8;
      bit -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const k = (prefix << 8) | c;
    const hit = dict.get(k);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(k, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      size = minCode + 1;
      next = eoi + 1;
    }
    prefix = c;
  }
  emit(prefix);
  emit(eoi);
  if (bit > 0) bytes.push(cur & 0xff);
  out.push(minCode);
  for (let i = 0; i < bytes.length; i += 255) {
    const part = bytes.slice(i, i + 255);
    out.push(part.length, ...part);
  }
  out.push(0);
}

/** Couleur d'un pixel posée sur du blanc, en clé 15 bits. */
function keyAt(d: Uint8ClampedArray, i: number): number {
  const a = d[i + 3] / 255,
    b = 255 * (1 - a);
  return key15(d[i] * a + b, d[i + 1] * a + b, d[i + 2] * a + b);
}

/**
 * Écriture d'un GIF animé image par image, pour ne garder en mémoire que les images déjà
 * compressées. La palette est commune à toutes les images : on la calcule d'abord avec
 * `addToHistogram` sur chaque image (premier passage), puis on écrit les images (second passage).
 */
export class GifWriter {
  private readonly hist = new Uint32Array(32768);
  private palette: number[][] | null = null;
  private lookup = new Uint8Array(32768);
  private bits = 1;
  private transIndex = -1;
  private readonly chunks: Uint8Array[] = [];
  private readonly idx: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    /** Les pixels presque transparents restent transparents ; sinon ils sont posés sur du blanc. */
    readonly transparent = false,
  ) {
    this.idx = new Uint8Array(width * height);
  }

  /** Premier passage : compte les couleurs d'une image. */
  addToHistogram(d: Uint8ClampedArray): void {
    for (let i = 0; i < d.length; i += 4) {
      if (this.transparent && d[i + 3] < 128) continue;
      this.hist[keyAt(d, i)]++;
    }
  }

  /** Fixe la palette (une fois toutes les images comptées) et écrit l'en-tête. */
  private start(): void {
    const palette = medianCut(this.hist, this.transparent ? 255 : 256);
    this.palette = palette;
    this.transIndex = this.transparent ? palette.length : -1;
    const colors = this.transparent ? [...palette, [0, 0, 0]] : palette;
    while (1 << this.bits < colors.length) this.bits++;
    // Couleur la plus proche de chaque case de l'histogramme, calculée une fois.
    for (let k = 0; k < 32768; k++) {
      const r = ((k >> 10) & 31) * 8 + 4,
        g = ((k >> 5) & 31) * 8 + 4,
        b = (k & 31) * 8 + 4;
      let best = 0,
        bd = Infinity;
      for (let i = 0; i < palette.length; i++) {
        const p = palette[i];
        const dd = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      this.lookup[k] = best;
    }
    const out: number[] = [];
    const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
    out.push(...[...'GIF89a'].map((c) => c.charCodeAt(0)));
    u16(this.width);
    u16(this.height);
    out.push(0x80 | 0x70 | (this.bits - 1), 0, 0);
    for (let i = 0; i < 1 << this.bits; i++) {
      const c = colors[i] ?? [0, 0, 0];
      out.push(c[0], c[1], c[2]);
    }
    // Boucle infinie (extension NETSCAPE2.0).
    out.push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
    this.chunks.push(Uint8Array.from(out));
  }

  /** Second passage : écrit une image (durée en centièmes de seconde). */
  addFrame(d: Uint8ClampedArray, delay: number): void {
    if (!this.palette) this.start();
    const idx = this.idx;
    for (let p = 0, i = 0; p < idx.length; p++, i += 4)
      idx[p] = this.transparent && d[i + 3] < 128 ? this.transIndex : this.lookup[keyAt(d, i)];
    const out: number[] = [];
    const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
    // Contrôle graphique : durée, effacement de l'image précédente, transparence.
    out.push(0x21, 0xf9, 4, (2 << 2) | (this.transparent ? 1 : 0));
    u16(Math.max(2, Math.round(delay)));
    out.push(this.transparent ? this.transIndex : 0, 0);
    out.push(0x2c);
    u16(0);
    u16(0);
    u16(this.width);
    u16(this.height);
    out.push(0);
    lzw(idx, Math.max(2, this.bits), out);
    this.chunks.push(Uint8Array.from(out));
  }

  /** Le GIF complet. */
  finish(): Uint8Array {
    if (!this.palette) this.start();
    const total = this.chunks.reduce((n, c) => n + c.length, 0) + 1;
    const gif = new Uint8Array(total);
    let at = 0;
    for (const c of this.chunks) {
      gif.set(c, at);
      at += c.length;
    }
    gif[at] = 0x3b;
    return gif;
  }
}

/** GIF animé de toutes les images (même taille), en une fois. */
export function encodeGif(frames: GifFrame[], w: number, h: number, transparent = false): Uint8Array {
  const gif = new GifWriter(w, h, transparent);
  for (const f of frames) gif.addToHistogram(f.data);
  for (const f of frames) gif.addFrame(f.data, f.delay);
  return gif.finish();
}
