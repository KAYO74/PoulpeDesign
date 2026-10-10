import { parseColor, sampleStops } from './color';
import { applyLut, decodeLut, encodeLut, lutFromFunction } from './lut';
import type { Adjustment, AdjustmentKind } from './types';

/*
 * Réglages d'image et filtres dynamiques, calculés pixel par pixel sur des données RGBA.
 * Ce module ne dépend pas du navigateur : le rendu lui confie les pixels d'un calque, et les
 * tests le font tourner directement.
 */

/** Pixels RGBA non prémultipliés, ligne par ligne (comme `ImageData`). */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Réglages de couleur et de tons, dans l'ordre des menus. */
export const COLOR_ADJUSTMENTS = [
  'brightnessContrast',
  'levels',
  'curves',
  'exposure',
  'hsl',
  'vibrance',
  'whiteBalance',
  'colorBalance',
  'blackWhite',
  'photoFilter',
  'gradientMap',
  'invert',
  'threshold',
  'posterize',
] as const satisfies readonly AdjustmentKind[];

/** Filtres dynamiques : ils tiennent compte des pixels voisins. */
export const LIVE_FILTERS = [
  'gaussianBlur',
  'unsharpMask',
  'clarity',
  'noise',
  'vignette',
  'pixelate',
] as const satisfies readonly AdjustmentKind[];

export function isLiveFilter(kind: AdjustmentKind): boolean {
  return (LIVE_FILTERS as readonly string[]).includes(kind);
}

export function defaultAdjustment(kind: AdjustmentKind): Adjustment {
  const line: [number, number][] = [
    [0, 0],
    [1, 1],
  ];
  switch (kind) {
    case 'brightnessContrast':
      return { kind, brightness: 0, contrast: 0 };
    case 'levels':
      return { kind, black: 0, white: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    case 'curves':
      return { kind, rgb: line, r: line, g: line, b: line };
    case 'hsl':
      return { kind, hue: 0, saturation: 0, lightness: 0 };
    case 'vibrance':
      return { kind, vibrance: 30, saturation: 0 };
    case 'exposure':
      return { kind, exposure: 0, offset: 0, gamma: 1 };
    case 'whiteBalance':
      return { kind, temperature: 0, tint: 0 };
    case 'colorBalance':
      return { kind, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] };
    case 'blackWhite':
      return { kind, red: 30, green: 59, blue: 11 };
    case 'photoFilter':
      return { kind, color: '#ec8a00', density: 25 };
    case 'gradientMap':
      return {
        kind,
        stops: [
          { offset: 0, color: '#1b1340' },
          { offset: 0.5, color: '#c2457a' },
          { offset: 1, color: '#ffe3a3' },
        ],
      };
    case 'invert':
      return { kind };
    case 'threshold':
      return { kind, level: 128 };
    case 'posterize':
      return { kind, levels: 6 };
    case 'gaussianBlur':
      return { kind, radius: 8 };
    case 'unsharpMask':
      return { kind, amount: 80, radius: 2, threshold: 0 };
    case 'clarity':
      return { kind, amount: 40 };
    case 'noise':
      return { kind, amount: 12, monochrome: true };
    case 'vignette':
      return { kind, amount: 50, size: 50, softness: 50 };
    case 'pixelate':
      return { kind, size: 16 };
    case 'lut':
      return { kind, name: '', size: 2, data: encodeLut(lutFromFunction(2, (r, g, b) => [r, g, b])) };
  }
}

// ————— Outils —————

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(v: number): number {
  v = clamp01(v);
  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
}

/** Luminance perçue (Rec. 709) d'une couleur 0..255. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Courbe monotone (Fritsch–Carlson) passant par les points, échantillonnée sur 256 valeurs 0..1. */
export function curveTable(points: [number, number][]): Float32Array {
  const pts = [...points].sort((a, b) => a[0] - b[0]).filter((p, i, a) => i === 0 || p[0] > a[i - 1][0]);
  const out = new Float32Array(256);
  if (pts.length === 0) {
    for (let i = 0; i < 256; i++) out[i] = i / 255;
    return out;
  }
  if (pts.length === 1) return out.fill(clamp01(pts[0][1]));
  const n = pts.length;
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let k = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    if (x <= xs[0]) out[i] = clamp01(ys[0]);
    else if (x >= xs[n - 1]) out[i] = clamp01(ys[n - 1]);
    else {
      while (x > xs[k + 1]) k++;
      const h = xs[k + 1] - xs[k];
      const t = (x - xs[k]) / h;
      const t2 = t * t,
        t3 = t2 * t;
      out[i] = clamp01(
        (2 * t3 - 3 * t2 + 1) * ys[k] +
          (t3 - 2 * t2 + t) * h * m[k] +
          (-2 * t3 + 3 * t2) * ys[k + 1] +
          (t3 - t2) * h * m[k + 1],
      );
    }
  }
  return out;
}

/** Tables de correspondance par canal (0..255 → 0..255), ou null si le réglage n'en est pas une. */
function channelTables(adj: Adjustment): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] | null {
  const make = (f: (v: number, c: number) => number) =>
    [0, 1, 2].map((c) => {
      const t = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) t[i] = Math.round(f(i, c));
      return t;
    }) as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
  switch (adj.kind) {
    case 'brightnessContrast': {
      const c = adj.contrast / 100;
      const f = c >= 0 ? 1 / Math.max(0.01, 1 - c * 0.99) : 1 + c;
      return make((v) => 255 * ((v / 255 + adj.brightness / 200 - 0.5) * f + 0.5));
    }
    case 'levels': {
      const range = Math.max(1, adj.white - adj.black);
      const g = 1 / Math.max(0.01, adj.gamma);
      return make((v) => {
        const t = clamp01((v - adj.black) / range) ** g;
        return adj.outBlack + t * (adj.outWhite - adj.outBlack);
      });
    }
    case 'curves': {
      const all = curveTable(adj.rgb);
      const per = [curveTable(adj.r), curveTable(adj.g), curveTable(adj.b)];
      return make((v, c) => 255 * per[c][Math.round(all[v] * 255)]);
    }
    case 'exposure': {
      const k = 2 ** adj.exposure;
      const g = 1 / Math.max(0.01, adj.gamma);
      return make((v) => linearToSrgb(Math.max(0, SRGB_TO_LINEAR[v] * k + adj.offset) ** g));
    }
    case 'whiteBalance': {
      const t = adj.temperature / 100,
        tint = adj.tint / 100;
      const gains = [1 + t * 0.35, 1 - tint * 0.3, 1 - t * 0.35];
      return make((v, c) => linearToSrgb(SRGB_TO_LINEAR[v] * gains[c]));
    }
    case 'invert':
      return make((v) => 255 - v);
    case 'posterize': {
      const n = Math.max(2, Math.round(adj.levels));
      return make((v) => (Math.round((v / 255) * (n - 1)) / (n - 1)) * 255);
    }
    default:
      return null;
  }
}

// ————— Flou —————

/** Tailles de trois flous en boîte qui approchent un flou gaussien d'écart type `sigma`. */
function boxSizes(sigma: number): number[] {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  return [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      // Bords : on prolonge le premier et le dernier pixel.
      const first = src[row + c],
        last = src[row + (w - 1) * 4 + c];
      acc = first * (r + 1);
      for (let x = 0; x < r; x++) acc += src[row + Math.min(x, w - 1) * 4 + c];
      for (let x = 0; x < w; x++) {
        const add = x + r < w ? src[row + (x + r) * 4 + c] : last;
        const sub = x - r - 1 >= 0 ? src[row + (x - r - 1) * 4 + c] : first;
        acc += add - sub;
        dst[row + x * 4 + c] = acc * k;
      }
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  const stride = w * 4;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      const col = x * 4 + c;
      const first = src[col],
        last = src[(h - 1) * stride + col];
      let acc = first * (r + 1);
      for (let y = 0; y < r; y++) acc += src[Math.min(y, h - 1) * stride + col];
      for (let y = 0; y < h; y++) {
        const add = y + r < h ? src[(y + r) * stride + col] : last;
        const sub = y - r - 1 >= 0 ? src[(y - r - 1) * stride + col] : first;
        acc += add - sub;
        dst[y * stride + col] = acc * k;
      }
    }
  }
}

/** Copie floutée (gaussienne approchée) des pixels, alpha prémultiplié pour éviter les halos. */
export function gaussianBlurred(px: Pixels, sigma: number): Uint8ClampedArray {
  const { data, width: w, height: h } = px;
  const out = new Uint8ClampedArray(data.length);
  if (sigma < 0.3 || w === 0 || h === 0) {
    out.set(data);
    return out;
  }
  if (engine) {
    out.set(data);
    if (engine.blur({ data: out, width: w, height: h }, sigma)) return out;
  }
  let a = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const al = data[i + 3] / 255;
    a[i] = data[i] * al;
    a[i + 1] = data[i + 1] * al;
    a[i + 2] = data[i + 2] * al;
    a[i + 3] = data[i + 3];
  }
  let b = new Float32Array(data.length);
  for (const r of boxSizes(sigma)) {
    if (r < 1) continue;
    boxBlurH(a, b, w, h, Math.min(r, w));
    boxBlurV(b, a, w, h, Math.min(r, h));
  }
  void b;
  b = a;
  for (let i = 0; i < data.length; i += 4) {
    const al = b[i + 3];
    out[i + 3] = al;
    if (al > 0.001) {
      const k = 255 / al;
      out[i] = b[i] * k;
      out[i + 1] = b[i + 1] * k;
      out[i + 2] = b[i + 2] * k;
    }
  }
  return out;
}

/** Bruit pseudo-aléatoire stable : le même pixel du document a toujours le même grain. */
function hash(x: number, y: number, c: number): number {
  let h = (x * 374761393 + y * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface AdjustOptions {
  /** Pixels de l'image par pixel du document : les rayons des filtres sont en pixels du document. */
  scale?: number;
  /** Position (en pixels de l'image) de l'origine du document. Le grain et la pixellisation s'y calent. */
  origin?: { x: number; y: number };
  /** Cadre de référence de la vignette (le plan de travail), en pixels de l'image. */
  frame?: { x: number; y: number; width: number; height: number };
}

/**
 * Moteur de calcul plus rapide (le moteur Rust, compilé en WebAssembly : packages/engine). Il
 * donne exactement les mêmes pixels ; s'il n'est pas chargé ou refuse un calcul (`false`), le
 * calcul se fait ici en TypeScript.
 */
export interface AdjustmentEngine {
  apply(px: Pixels, adj: Adjustment, opts: AdjustOptions): boolean;
  blur(px: Pixels, sigma: number): boolean;
}

let engine: AdjustmentEngine | null = null;

/** Branche (ou débranche, avec null) le moteur de calcul des réglages. */
export function setAdjustmentEngine(e: AdjustmentEngine | null): void {
  engine = e;
}

/** Applique un réglage aux pixels, sur place. L'opacité de chaque pixel ne change pas. */
export function applyAdjustment(px: Pixels, adj: Adjustment, opts: AdjustOptions = {}): void {
  if (engine && px.width * px.height > 0 && engine.apply(px, adj, opts)) return;
  applyAdjustmentTs(px, adj, opts);
}

/** Calcul TypeScript d'origine (référence du moteur Rust, et solution de repli). */
export function applyAdjustmentTs(px: Pixels, adj: Adjustment, opts: AdjustOptions = {}): void {
  const { data, width: w, height: h } = px;
  const n = data.length;
  const scale = opts.scale ?? 1;
  const tables = channelTables(adj);
  if (tables) {
    const [tr, tg, tb] = tables;
    for (let i = 0; i < n; i += 4) {
      data[i] = tr[data[i]];
      data[i + 1] = tg[data[i + 1]];
      data[i + 2] = tb[data[i + 2]];
    }
    return;
  }
  switch (adj.kind) {
    case 'lut':
      applyLut(px, decodeLut(adj.size, adj.data));
      return;
    case 'hsl': {
      const dh = adj.hue / 360,
        ds = adj.saturation / 100,
        dl = adj.lightness / 100;
      for (let i = 0; i < n; i += 4) {
        const r = data[i] / 255,
          g = data[i + 1] / 255,
          b = data[i + 2] / 255;
        const mx = Math.max(r, g, b),
          mn = Math.min(r, g, b);
        let l = (mx + mn) / 2;
        let s = 0,
          hh = 0;
        const d = mx - mn;
        if (d > 1e-6) {
          s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
          hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
          hh /= 6;
        }
        hh = (hh + dh + 1) % 1;
        s = clamp01(ds >= 0 ? s + (1 - s) * ds * (d > 1e-6 ? 1 : 0) : s * (1 + ds));
        l = clamp01(dl >= 0 ? l + (1 - l) * dl : l * (1 + dl));
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const conv = (t: number) => {
          t = (t + 1) % 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        data[i] = conv(hh + 1 / 3) * 255;
        data[i + 1] = conv(hh) * 255;
        data[i + 2] = conv(hh - 1 / 3) * 255;
      }
      return;
    }
    case 'vibrance': {
      const vib = adj.vibrance / 100,
        sat = 1 + adj.saturation / 100;
      for (let i = 0; i < n; i += 4) {
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        const mx = Math.max(r, g, b),
          mn = Math.min(r, g, b);
        const s = mx > 0 ? (mx - mn) / mx : 0;
        // Les couleurs déjà vives bougent peu, les couleurs ternes beaucoup.
        const f = Math.max(0, (1 + vib * (1 - s)) * sat);
        const y = luma(r, g, b);
        data[i] = y + (r - y) * f;
        data[i + 1] = y + (g - y) * f;
        data[i + 2] = y + (b - y) * f;
      }
      return;
    }
    case 'colorBalance': {
      for (let i = 0; i < n; i += 4) {
        const l = luma(data[i], data[i + 1], data[i + 2]) / 255;
        const ws = clamp01((0.333 - l) / 0.25 + 0.5);
        const wh = clamp01((l - 0.667) / 0.25 + 0.5);
        const wm = clamp01((l - 0.333) / 0.25 + 0.5) * clamp01((0.667 - l) / 0.25 + 0.5) * 0.7;
        for (let c = 0; c < 3; c++) {
          const shift = adj.shadows[c] * ws + adj.midtones[c] * wm + adj.highlights[c] * wh;
          data[i + c] = data[i + c] + shift * 0.64;
        }
      }
      return;
    }
    case 'blackWhite': {
      const kr = adj.red / 100,
        kg = adj.green / 100,
        kb = adj.blue / 100;
      for (let i = 0; i < n; i += 4) {
        const v = data[i] * kr + data[i + 1] * kg + data[i + 2] * kb;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
      return;
    }
    case 'photoFilter': {
      const c = parseColor(adj.color);
      const d = clamp01(adj.density / 100);
      const fr = c.r / 255,
        fg = c.g / 255,
        fb = c.b / 255;
      for (let i = 0; i < n; i += 4) {
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        const y = luma(r, g, b);
        let mr = r * fr,
          mg = g * fg,
          mb = b * fb;
        // On garde la luminosité d'origine : le filtre teinte sans assombrir.
        const my = luma(mr, mg, mb);
        if (my > 0.01) {
          const k = y / my;
          mr *= k;
          mg *= k;
          mb *= k;
        }
        data[i] = r + (mr - r) * d;
        data[i + 1] = g + (mg - g) * d;
        data[i + 2] = b + (mb - b) * d;
      }
      return;
    }
    case 'gradientMap': {
      const lut = new Uint8ClampedArray(256 * 3);
      for (let i = 0; i < 256; i++) {
        const col = parseColor(sampleStops(adj.stops, i / 255));
        lut[i * 3] = col.r;
        lut[i * 3 + 1] = col.g;
        lut[i * 3 + 2] = col.b;
      }
      for (let i = 0; i < n; i += 4) {
        const v = Math.round(luma(data[i], data[i + 1], data[i + 2])) * 3;
        data[i] = lut[v];
        data[i + 1] = lut[v + 1];
        data[i + 2] = lut[v + 2];
      }
      return;
    }
    case 'threshold': {
      for (let i = 0; i < n; i += 4) {
        const v = luma(data[i], data[i + 1], data[i + 2]) >= adj.level ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
      return;
    }
    case 'gaussianBlur': {
      data.set(gaussianBlurred(px, (adj.radius * scale) / 2));
      return;
    }
    case 'unsharpMask':
    case 'clarity': {
      const radius = adj.kind === 'clarity' ? 24 : adj.radius;
      const amount = adj.amount / 100;
      const threshold = adj.kind === 'unsharpMask' ? adj.threshold : 0;
      const blurred = gaussianBlurred(px, Math.max(0.5, radius * scale));
      for (let i = 0; i < n; i += 4) {
        // La clarté agit surtout sur les tons moyens, pour ne pas brûler les extrêmes.
        let k = amount;
        if (adj.kind === 'clarity') {
          const l = luma(data[i], data[i + 1], data[i + 2]) / 255;
          k *= 1 - (2 * l - 1) ** 2;
        }
        for (let c = 0; c < 3; c++) {
          const diff = data[i + c] - blurred[i + c];
          if (Math.abs(diff) >= threshold) data[i + c] = data[i + c] + diff * k;
        }
      }
      return;
    }
    case 'noise': {
      const amt = adj.amount * 2.55;
      const ox = opts.origin?.x ?? 0,
        oy = opts.origin?.y ?? 0;
      for (let y = 0; y < h; y++) {
        const dy = Math.floor((y - oy) / scale);
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const dx = Math.floor((x - ox) / scale);
          if (adj.monochrome) {
            const v = (hash(dx, dy, 0) * 2 - 1) * amt;
            data[i] = data[i] + v;
            data[i + 1] = data[i + 1] + v;
            data[i + 2] = data[i + 2] + v;
          } else {
            for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + (hash(dx, dy, c + 1) * 2 - 1) * amt;
          }
        }
      }
      return;
    }
    case 'vignette': {
      const f = opts.frame ?? { x: 0, y: 0, width: w, height: h };
      const cx = f.x + f.width / 2,
        cy = f.y + f.height / 2;
      const rx = f.width / 2,
        ry = f.height / 2;
      const inner = clamp01(adj.size / 100) * 1.2;
      const soft = Math.max(0.05, (adj.softness / 100) * 1.2);
      const amt = adj.amount / 100;
      for (let y = 0; y < h; y++) {
        const ny = (y + 0.5 - cy) / ry;
        for (let x = 0; x < w; x++) {
          const nx = (x + 0.5 - cx) / rx;
          const d = Math.sqrt(nx * nx + ny * ny);
          let t = clamp01((d - inner) / soft);
          t = t * t * (3 - 2 * t);
          if (t <= 0) continue;
          const i = (y * w + x) * 4;
          // Vers le noir si la quantité est positive, vers le blanc sinon.
          const target = amt >= 0 ? 0 : 255;
          const k = t * Math.abs(amt);
          data[i] = data[i] + (target - data[i]) * k;
          data[i + 1] = data[i + 1] + (target - data[i + 1]) * k;
          data[i + 2] = data[i + 2] + (target - data[i + 2]) * k;
        }
      }
      return;
    }
    case 'pixelate': {
      const s = Math.max(1, adj.size * scale);
      const ox = opts.origin?.x ?? 0,
        oy = opts.origin?.y ?? 0;
      const startX = ox - Math.ceil(ox / s) * s,
        startY = oy - Math.ceil(oy / s) * s;
      for (let by = startY; by < h; by += s) {
        const y0 = Math.max(0, Math.floor(by)),
          y1 = Math.min(h, Math.floor(by + s));
        if (y1 <= y0) continue;
        for (let bx = startX; bx < w; bx += s) {
          const x0 = Math.max(0, Math.floor(bx)),
            x1 = Math.min(w, Math.floor(bx + s));
          if (x1 <= x0) continue;
          let r = 0,
            g = 0,
            b = 0,
            a = 0;
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const i = (y * w + x) * 4;
              const al = data[i + 3];
              r += data[i] * al;
              g += data[i + 1] * al;
              b += data[i + 2] * al;
              a += al;
            }
          if (a === 0) continue;
          r /= a;
          g /= a;
          b /= a;
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const i = (y * w + x) * 4;
              data[i] = r;
              data[i + 1] = g;
              data[i + 2] = b;
            }
        }
      }
      return;
    }
  }
}

/** Le réglage laisse-t-il l'image telle quelle (valeurs neutres) ? */
export function isNeutral(adj: Adjustment): boolean {
  switch (adj.kind) {
    case 'brightnessContrast':
      return adj.brightness === 0 && adj.contrast === 0;
    case 'levels':
      return (
        adj.black === 0 && adj.white === 255 && adj.gamma === 1 && adj.outBlack === 0 && adj.outWhite === 255
      );
    case 'hsl':
      return adj.hue === 0 && adj.saturation === 0 && adj.lightness === 0;
    case 'exposure':
      return adj.exposure === 0 && adj.offset === 0 && adj.gamma === 1;
    case 'whiteBalance':
      return adj.temperature === 0 && adj.tint === 0;
    case 'gaussianBlur':
      return adj.radius <= 0;
    case 'noise':
    case 'unsharpMask':
    case 'clarity':
    case 'vignette':
      return adj.amount === 0;
    default:
      return false;
  }
}

/** Marge (en pixels du document) qu'un filtre lit autour de chaque pixel. */
export function adjustmentReach(adj: Adjustment): number {
  switch (adj.kind) {
    case 'gaussianBlur':
      return adj.radius * 1.5;
    case 'unsharpMask':
      return adj.radius * 3;
    case 'clarity':
      return 72;
    case 'pixelate':
      return adj.size;
    default:
      return 0;
  }
}

/** Histogrammes des canaux rouge, vert, bleu et de la luminance (pixels visibles seulement). */
export function histogram(px: Pixels): { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array } {
  const r = new Uint32Array(256),
    g = new Uint32Array(256),
    b = new Uint32Array(256),
    l = new Uint32Array(256);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    r[d[i]]++;
    g[d[i + 1]]++;
    b[d[i + 2]]++;
    l[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++;
  }
  return { r, g, b, l };
}

/** Niveaux automatiques : étire les tons pour que les 0,5 % les plus sombres et les plus clairs touchent le noir et le blanc. */
export function autoLevels(px: Pixels): Extract<Adjustment, { kind: 'levels' }> {
  const { l } = histogram(px);
  let total = 0;
  for (const v of l) total += v;
  const clip = total * 0.005;
  let black = 0,
    white = 255,
    acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += l[i];
    if (acc > clip) {
      black = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += l[i];
    if (acc > clip) {
      white = i;
      break;
    }
  }
  if (white - black < 8) return defaultAdjustment('levels') as Extract<Adjustment, { kind: 'levels' }>;
  return { kind: 'levels', black, white, gamma: 1, outBlack: 0, outWhite: 255 };
}

export { clamp255 as clampByte };
