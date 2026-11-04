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

/**
 * GIF animé de toutes les images (même taille). Les pixels presque transparents deviennent
 * transparents (`transparent`), sinon ils sont posés sur du blanc.
 */
export function encodeGif(frames: GifFrame[], w: number, h: number, transparent = false): Uint8Array {
  const hist = new Uint32Array(32768);
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (transparent && d[i + 3] < 128) continue;
      const a = d[i + 3] / 255;
      hist[key15(d[i] * a + 255 * (1 - a), d[i + 1] * a + 255 * (1 - a), d[i + 2] * a + 255 * (1 - a))]++;
    }
  }
  const palette = medianCut(hist, transparent ? 255 : 256);
  const transIndex = transparent ? palette.length : -1;
  const colors = transparent ? [...palette, [0, 0, 0]] : palette;
  let bits = 1;
  while (1 << bits < colors.length) bits++;
  // Couleur la plus proche de chaque case de l'histogramme, calculée une fois.
  const lookup = new Uint8Array(32768);
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
    lookup[k] = best;
  }
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  out.push(...[...'GIF89a'].map((c) => c.charCodeAt(0)));
  u16(w);
  u16(h);
  out.push(0x80 | 0x70 | (bits - 1), 0, 0);
  for (let i = 0; i < 1 << bits; i++) {
    const c = colors[i] ?? [0, 0, 0];
    out.push(c[0], c[1], c[2]);
  }
  // Boucle infinie (extension NETSCAPE2.0).
  out.push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  const idx = new Uint8Array(w * h);
  for (const f of frames) {
    const d = f.data;
    for (let p = 0, i = 0; p < idx.length; p++, i += 4) {
      if (transparent && d[i + 3] < 128) idx[p] = transIndex;
      else {
        const a = d[i + 3] / 255;
        idx[p] =
          lookup[key15(d[i] * a + 255 * (1 - a), d[i + 1] * a + 255 * (1 - a), d[i + 2] * a + 255 * (1 - a))];
      }
    }
    // Contrôle graphique : durée, effacement de l'image précédente, transparence.
    out.push(0x21, 0xf9, 4, (2 << 2) | (transparent ? 1 : 0));
    u16(Math.max(2, Math.round(f.delay)));
    out.push(transparent ? transIndex : 0, 0);
    out.push(0x2c);
    u16(0);
    u16(0);
    u16(w);
    u16(h);
    out.push(0);
    lzw(idx, Math.max(2, bits), out);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
