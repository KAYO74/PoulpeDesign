import { formatColor, opaque, parseColor } from './color';
import type { Color, PoulpeDocument } from './types';

/*
 * Couleurs d'impression CMJN.
 *
 * Poulpe dessine en RVB ; pour l'impression, il convertit avec un modèle d'encres proche de
 * l'offset couché européen (ISO 12647-2, « FOGRA39 ») : les 8 primaires de Neugebauer (papier,
 * cyan, magenta, jaune et leurs superpositions) mesurées en sRVB, l'engraissement du point et
 * l'effet Yule-Nielsen, puis le noir par-dessus. Ce n'est pas un moteur ICC complet, mais il
 * donne des conversions et un épreuvage à l'écran crédibles, et le même modèle sert à fabriquer
 * le profil ICC incorporé dans les PDF/X.
 *
 * Les gris (R = V = B) passent en noir seul : un texte noir sort en 100 % K, pas en noir
 * quadri. Une couleur choisie directement en CMJN garde ses valeurs exactes (`layout.cmyk`).
 */

/** Pourcentages d'encre, de 0 à 100 : cyan, magenta, jaune, noir. */
export type Cmyk = [number, number, number, number];

/** Taux d'encrage maximal (somme des quatre encres), en %. */
export const INK_LIMIT = 320;

/** Nom de la condition d'impression simulée. */
export const PRINT_CONDITION = {
  identifier: 'FOGRA39',
  info: 'Coated FOGRA39 (ISO 12647-2:2004)',
  registry: 'http://www.color.org',
};

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Yule-Nielsen : les mélanges se calculent sur la réflectance à la puissance 1/n. */
const YN = 1.6;

type Rgb3 = [number, number, number];
const prim = (r: number, g: number, b: number): Rgb3 =>
  [r, g, b].map((v) => toLinear(v / 255) ** (1 / YN)) as Rgb3;

// Primaires de Neugebauer (sRVB) : papier, C, M, J, CM, CJ, MJ, CMJ.
const P_W = prim(255, 255, 255);
const P_C = prim(0, 158, 224);
const P_M = prim(229, 0, 126);
const P_Y = prim(255, 237, 0);
const P_CM = prim(46, 49, 146);
const P_CY = prim(0, 150, 64);
const P_MY = prim(226, 35, 26);
const P_CMY = prim(60, 56, 56);
const P_K = prim(35, 31, 32);

/** Engraissement du point (TVI) : un aplat à 50 % imprime environ 64 %. */
const gain = (v: number) => {
  const x = clamp01(v);
  return x + 0.14 * 4 * x * (1 - x);
};

/** Réflectance linéaire (0 à 1 par canal) d'un mélange d'encres en fractions de 0 à 1. */
function inkToLinear(c: number, m: number, y: number, k: number): Rgb3 {
  const C = gain(c),
    M = gain(m),
    Y = gain(y),
    K = gain(k);
  const w = [
    (1 - C) * (1 - M) * (1 - Y),
    C * (1 - M) * (1 - Y),
    (1 - C) * M * (1 - Y),
    (1 - C) * (1 - M) * Y,
    C * M * (1 - Y),
    C * (1 - M) * Y,
    (1 - C) * M * Y,
    C * M * Y,
  ];
  const P = [P_W, P_C, P_M, P_Y, P_CM, P_CY, P_MY, P_CMY];
  const out: Rgb3 = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let i = 0; i < 8; i++) s += w[i] * P[i][ch];
    // Le noir se superpose : il filtre ce que laissent passer les autres encres.
    const kt = 1 - K + K * P_K[ch];
    out[ch] = (s * kt) ** YN;
  }
  return out;
}

/** Couleur sRVB (0 à 255) que donne un mélange d'encres sur le papier. */
export function cmykToRgb(cmyk: Cmyk): { r: number; g: number; b: number } {
  const [r, g, b] = inkToLinear(cmyk[0] / 100, cmyk[1] / 100, cmyk[2] / 100, cmyk[3] / 100);
  return { r: toGamma(r) * 255, g: toGamma(g) * 255, b: toGamma(b) * 255 };
}

export function cmykToColor(cmyk: Cmyk): Color {
  return formatColor({ ...cmykToRgb(cmyk), a: 1 });
}

function solve3(a: number[][], v: number[]): number[] | null {
  const det =
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  if (Math.abs(det) < 1e-12) return null;
  const col = (i: number) => a.map((row, r) => row.map((x, c) => (c === i ? v[r] : x)));
  const d = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  return [d(col(0)) / det, d(col(1)) / det, d(col(2)) / det];
}

/** Noir seul qui donne la même clarté qu'un gris sRVB (0 à 1). */
function grayToK(v: number): number {
  const target = toLinear(v);
  const lum = (k: number) => {
    const [r, g, b] = inkToLinear(0, 0, 0, k);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  let lo = 0,
    hi = 1;
  if (target <= lum(1)) return 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (lum(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Encres (fractions de 0 à 1) qui reproduisent au mieux une couleur sRVB (0 à 1) : on fixe le noir
 * (remplacement du gris moyen), puis on cherche cyan, magenta et jaune par la méthode de Newton.
 * Hors du gamut, le résultat est ramené dans les limites des encres.
 */
function rgbToInk(r: number, g: number, b: number): [number, number, number, number] {
  if (Math.abs(r - g) < 1e-6 && Math.abs(g - b) < 1e-6) {
    if (r >= 1 - 1e-6) return [0, 0, 0, 0];
    return [0, 0, 0, grayToK(r)];
  }
  const target = [toLinear(r), toLinear(g), toLinear(b)].map((v) => v ** (1 / YN));
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  // Remplacement du gris : le noir prend la part neutre des couleurs sombres.
  const dark = 1 - max;
  const neutral = 1 - (max - min) / Math.max(max, 1e-6);
  let k = clamp01((dark - 0.25) / 0.75) ** 1.3 * (0.55 + 0.45 * neutral);
  const solve = (k: number) => {
    let x = [clamp01(1 - r - k * 0.5), clamp01(1 - g - k * 0.5), clamp01(1 - b - k * 0.5)];
    const f = (p: number[]) => inkToLinear(p[0], p[1], p[2], k).map((v) => v ** (1 / YN));
    let err: number[];
    for (let it = 0; it < 24; it++) {
      const cur = f(x);
      err = cur.map((v, i) => v - target[i]);
      if (Math.abs(err[0]) + Math.abs(err[1]) + Math.abs(err[2]) < 1e-5) break;
      const h = 1e-4;
      const jac = [0, 1, 2].map(() => [0, 0, 0]);
      for (let j = 0; j < 3; j++) {
        const p = [...x];
        p[j] = x[j] + h;
        const d = f(p);
        for (let i = 0; i < 3; i++) jac[i][j] = (d[i] - cur[i]) / h;
      }
      const step = solve3(
        jac,
        err.map((e) => -e),
      );
      if (!step) break;
      x = x.map((v, i) => clamp01(v + Math.max(-0.5, Math.min(0.5, step[i]))));
    }
    err = f(x).map((v, i) => v - target[i]);
    return { x, err };
  };
  let { x, err } = solve(k);
  // Une couleur trop sombre pour cyan, magenta et jaune seuls reçoit plus de noir.
  while (k < 1 && err.every((e) => e > 0.01)) {
    k = clamp01(k + 0.1);
    ({ x, err } = solve(k));
  }
  let [c, m, y] = x;
  const total = (c + m + y + k) * 100;
  if (total > INK_LIMIT) {
    const s = Math.max(0, (INK_LIMIT / 100 - k) / Math.max(1e-6, c + m + y));
    c *= s;
    m *= s;
    y *= s;
  }
  return [c, m, y, k];
}

// ————— Tables de conversion (interpolation trilinéaire) —————

const GRID = 17;
let forwardLut: Float32Array | null = null;
let proofLut: Float32Array | null = null;

function buildForward(): Float32Array {
  const lut = new Float32Array(GRID * GRID * GRID * 4);
  let o = 0;
  for (let ri = 0; ri < GRID; ri++)
    for (let gi = 0; gi < GRID; gi++)
      for (let bi = 0; bi < GRID; bi++) {
        const ink = rgbToInk(ri / (GRID - 1), gi / (GRID - 1), bi / (GRID - 1));
        for (let i = 0; i < 4; i++) lut[o++] = ink[i];
      }
  return lut;
}

function interp(lut: Float32Array, n: number, r: number, g: number, b: number, out: Float32Array) {
  const s = GRID - 1;
  const fr = clamp01(r) * s,
    fg = clamp01(g) * s,
    fb = clamp01(b) * s;
  const r0 = Math.min(s - 1, Math.floor(fr)),
    g0 = Math.min(s - 1, Math.floor(fg)),
    b0 = Math.min(s - 1, Math.floor(fb));
  const dr = fr - r0,
    dg = fg - g0,
    db = fb - b0;
  for (let i = 0; i < n; i++) out[i] = 0;
  for (let c = 0; c < 8; c++) {
    const ir = c & 4 ? 1 : 0,
      ig = c & 2 ? 1 : 0,
      ib = c & 1 ? 1 : 0;
    const w = (ir ? dr : 1 - dr) * (ig ? dg : 1 - dg) * (ib ? db : 1 - db);
    if (!w) continue;
    const base = (((r0 + ir) * GRID + (g0 + ig)) * GRID + (b0 + ib)) * n;
    for (let i = 0; i < n; i++) out[i] += w * lut[base + i];
  }
}

const tmp = new Float32Array(4);

/** Encres (fractions de 0 à 1) d'une couleur sRVB (0 à 255), par la table de conversion. */
export function rgbToInkFast(r: number, g: number, b: number, out: Float32Array = tmp): Float32Array {
  if (r === g && g === b) {
    // Les gris restent exacts (noir seul), sans interpolation.
    const k = r >= 255 ? 0 : grayK(r);
    out[0] = out[1] = out[2] = 0;
    out[3] = k;
    return out;
  }
  forwardLut ??= buildForward();
  interp(forwardLut, 4, r / 255, g / 255, b / 255, out);
  return out;
}

const grayCache = new Float32Array(256).fill(-1);
function grayK(v: number): number {
  const i = Math.round(v);
  if (grayCache[i] < 0) grayCache[i] = grayToK(i / 255);
  return grayCache[i];
}

/** Valeurs CMJN (%) d'une couleur : exactes si la couleur a été choisie en CMJN, sinon converties. */
export function colorToCmyk(color: Color, doc?: Pick<PoulpeDocument, 'layout'>): Cmyk {
  const key = opaque(color).toLowerCase();
  const exact = doc?.layout?.cmyk?.[key];
  if (exact) return [...exact] as Cmyk;
  const { r, g, b } = parseColor(color);
  const ink = rgbToInkFast(r, g, b, new Float32Array(4));
  return [0, 1, 2, 3].map((i) => Math.round(ink[i] * 1000) / 10) as Cmyk;
}

/** Table d'épreuvage : sRVB → encres → sRVB, pour voir à l'écran l'effet de l'impression. */
function buildProof(): Float32Array {
  forwardLut ??= buildForward();
  const lut = new Float32Array(GRID * GRID * GRID * 3);
  for (let i = 0, o = 0; i < GRID * GRID * GRID; i++) {
    const [r, g, b] = inkToLinear(
      forwardLut[i * 4],
      forwardLut[i * 4 + 1],
      forwardLut[i * 4 + 2],
      forwardLut[i * 4 + 3],
    );
    lut[o++] = toGamma(r);
    lut[o++] = toGamma(g);
    lut[o++] = toGamma(b);
  }
  return lut;
}

/**
 * Épreuvage à l'écran : remplace chaque pixel (RVBA, 8 bits) par la couleur qu'il aurait une fois
 * imprimé. Une table de 256 entrées par canal accélère les grandes images.
 */
export function softProofPixels(data: Uint8ClampedArray): void {
  proofLut ??= buildProof();
  const lut = proofLut;
  const out = new Float32Array(3);
  const cache = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let v = cache.get(key);
    if (v === undefined) {
      interp(lut, 3, data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, out);
      v =
        (Math.round(clamp01(out[0]) * 255) << 16) |
        (Math.round(clamp01(out[1]) * 255) << 8) |
        Math.round(clamp01(out[2]) * 255);
      if (cache.size < 65536) cache.set(key, v);
    }
    data[i] = v >> 16;
    data[i + 1] = (v >> 8) & 255;
    data[i + 2] = v & 255;
  }
}

/** La couleur sort-elle nettement changée à l'impression (hors du gamut CMJN) ? */
export function outOfGamut(color: Color): boolean {
  const { r, g, b } = parseColor(color);
  // Les gris passent en noir seul : seuls les plus foncés que le noir du papier changent un peu.
  if (r === g && g === b) return false;
  const ink = rgbToInkFast(r, g, b, new Float32Array(4));
  const back = cmykToRgb([ink[0] * 100, ink[1] * 100, ink[2] * 100, ink[3] * 100]);
  return Math.abs(back.r - r) + Math.abs(back.g - g) + Math.abs(back.b - b) > 30;
}

// ————— Lab (D50), pour le profil ICC —————

const D50 = [0.9642, 1, 0.8249];
const M_RGB_XYZ = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];

function invert3(m: number[][]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
const M_XYZ_RGB = invert3(M_RGB_XYZ);

const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t) / 116 + 16 / 116);
const labFInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

/** Lab (D50) d'un mélange d'encres en fractions de 0 à 1. */
export function inkToLab(c: number, m: number, y: number, k: number): [number, number, number] {
  const lin = inkToLinear(c, m, y, k);
  const xyz = M_RGB_XYZ.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
  const [fx, fy, fz] = xyz.map((v, i) => labF(v / D50[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Encres (fractions) pour une couleur Lab (D50), ramenée dans le gamut. Renvoie aussi l'écart. */
export function labToInk(L: number, a: number, b: number): { ink: number[]; error: number } {
  const fy = (L + 16) / 116;
  const xyz = [labFInv(fy + a / 500) * D50[0], labFInv(fy) * D50[1], labFInv(fy - b / 200) * D50[2]];
  const lin = M_XYZ_RGB.map((row) => row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]);
  const rgb = lin.map((v) => clamp01(toGamma(clamp01(v))));
  const ink = rgbToInk(rgb[0], rgb[1], rgb[2]);
  const back = inkToLab(ink[0], ink[1], ink[2], ink[3]);
  const error = Math.hypot(back[0] - L, back[1] - a, back[2] - b);
  return { ink, error };
}
