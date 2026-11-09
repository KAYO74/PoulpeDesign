import type { Adjustment } from './types';

/*
 * Réglage « Développer » (comme le module Développement de Lightroom) : balance des blancs,
 * exposition, tons, présence et couleur par plage de teintes, en un seul calque de réglage.
 */

export type Develop = Extract<Adjustment, { kind: 'develop' }>;

/** Les huit plages de couleur, dans l'ordre des tableaux `hue`, `sat` et `lum`. */
export const DEVELOP_BANDS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const;
/** Teinte centrale de chaque plage, en degrés. */
const CENTERS = [0, 30, 60, 120, 180, 240, 275, 320];

export function defaultDevelop(): Develop {
  const z = () => DEVELOP_BANDS.map(() => 0);
  return {
    kind: 'develop',
    temperature: 0,
    tint: 0,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    vibrance: 0,
    saturation: 0,
    hue: z(),
    sat: z(),
    lum: z(),
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (l: number) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);

const tonesNeutral = (a: Develop) =>
  a.contrast === 0 && a.highlights === 0 && a.shadows === 0 && a.whites === 0 && a.blacks === 0;
const bandsNeutral = (a: Develop) => [...a.hue, ...a.sat, ...a.lum].every((v) => v === 0);

/** Complète les tableaux de plages d'un fichier incomplet ou trafiqué (8 valeurs chacun). */
function withBands(a: Develop): Develop {
  const fix = (v: unknown) =>
    DEVELOP_BANDS.map((_, i) => (Array.isArray(v) && Number.isFinite(v[i]) ? (v[i] as number) : 0));
  return { ...a, hue: fix(a.hue), sat: fix(a.sat), lum: fix(a.lum) };
}

export function developIsNeutral(a: Develop): boolean {
  a = withBands(a);
  return (
    a.temperature === 0 &&
    a.tint === 0 &&
    a.exposure === 0 &&
    a.vibrance === 0 &&
    a.saturation === 0 &&
    tonesNeutral(a) &&
    bandsNeutral(a)
  );
}

/** Courbe de tons appliquée à la luminance (0..1 → 0..1). */
function toneCurve(a: Develop): Float32Array {
  const c = a.contrast / 100;
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let o = v + c * (v * v * (3 - 2 * v) - v);
    o +=
      0.3 *
      ((a.shadows / 100) * (1 - smooth(0, 0.65, v)) +
        (a.highlights / 100) * smooth(0.35, 1, v) +
        (a.blacks / 100) * (1 - smooth(0, 0.3, v)) +
        (a.whites / 100) * smooth(0.7, 1, v));
    t[i] = clamp01(o);
  }
  return t;
}

/** Valeur d'une plage pour une teinte (0..1), interpolée entre les deux centres voisins. */
function bandValue(vals: readonly number[], hueDeg: number): number {
  const n = CENTERS.length;
  let a = n - 1;
  for (let i = 0; i < n; i++) if (CENTERS[i] <= hueDeg) a = i;
  const b = (a + 1) % n;
  const ca = CENTERS[a];
  const cb = CENTERS[b] + (b === 0 ? 360 : 0);
  const h = hueDeg < ca ? hueDeg + 360 : hueDeg;
  const t = (h - ca) / (cb - ca);
  return vals[a] + (vals[b] - vals[a]) * t;
}

/** Applique le réglage Développer aux pixels, sur place. */
export function applyDevelop(
  px: { data: Uint8ClampedArray; width: number; height: number },
  adj: Develop,
): void {
  const a = withBands(adj);
  const d = px.data;
  const n = d.length;
  const t = a.temperature / 100;
  const tint = a.tint / 100;

  // 1. Balance des blancs et exposition, canal par canal, en lumière linéaire.
  if (a.temperature !== 0 || a.tint !== 0 || a.exposure !== 0) {
    const k = 2 ** a.exposure;
    const gains = [1 + t * 0.35, 1 - tint * 0.3, 1 - t * 0.35];
    const tabs = gains.map((g) => {
      const tab = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) tab[i] = Math.round(toSrgb(toLinear(i) * g * k));
      return tab;
    });
    for (let i = 0; i < n; i += 4) {
      d[i] = tabs[0][d[i]];
      d[i + 1] = tabs[1][d[i + 1]];
      d[i + 2] = tabs[2][d[i + 2]];
    }
  }

  // 2. Tons : contraste, hautes lumières, ombres, blancs, noirs (sur la luminance).
  if (!tonesNeutral(a)) {
    const curve = toneCurve(a);
    for (let i = 0; i < n; i += 4) {
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const y2 = curve[Math.round(y)] * 255;
      const delta = y2 - y;
      // Au noir, seul le décalage fait remonter la couleur ; ailleurs, on garde les proportions.
      const k = clamp01(y / 64);
      const ratio = y > 0 ? y2 / y : 1;
      d[i] = k * r * ratio + (1 - k) * (r + delta);
      d[i + 1] = k * g * ratio + (1 - k) * (g + delta);
      d[i + 2] = k * b * ratio + (1 - k) * (b + delta);
    }
  }

  // 3. Couleur par plage de teintes.
  if (!bandsNeutral(a)) {
    for (let i = 0; i < n; i += 4) {
      const r = d[i] / 255,
        g = d[i + 1] / 255,
        b = d[i + 2] / 255;
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      const c = mx - mn;
      if (c < 1e-4) continue;
      let l = (mx + mn) / 2;
      let s = l > 0.5 ? c / (2 - mx - mn) : c / (mx + mn);
      let h = mx === r ? (g - b) / c + (g < b ? 6 : 0) : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
      h *= 60;
      // Les couleurs ternes bougent peu, pour ne pas teinter les gris.
      const w = clamp01(s * 2);
      const dh = (bandValue(a.hue, h) / 100) * 30 * w;
      const ds = (bandValue(a.sat, h) / 100) * w;
      const dl = (bandValue(a.lum, h) / 100) * 0.5 * w;
      h = (h + dh + 360) % 360;
      s = clamp01(ds >= 0 ? s + (1 - s) * ds : s * (1 + ds));
      l = clamp01(dl >= 0 ? l + (1 - l) * dl : l * (1 + dl));
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const hk = h / 360;
      const conv = (u: number) => {
        u = (u + 1) % 1;
        if (u < 1 / 6) return p + (q - p) * 6 * u;
        if (u < 1 / 2) return q;
        if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
        return p;
      };
      d[i] = conv(hk + 1 / 3) * 255;
      d[i + 1] = conv(hk) * 255;
      d[i + 2] = conv(hk - 1 / 3) * 255;
    }
  }

  // 4. Présence : vibrance (couleurs ternes d'abord) et saturation.
  if (a.vibrance !== 0 || a.saturation !== 0) {
    const vib = a.vibrance / 100,
      sat = 1 + a.saturation / 100;
    for (let i = 0; i < n; i += 4) {
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      const s = mx > 0 ? (mx - mn) / mx : 0;
      const f = Math.max(0, (1 + vib * (1 - s)) * sat);
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      d[i] = y + (r - y) * f;
      d[i + 1] = y + (g - y) * f;
      d[i + 2] = y + (b - y) * f;
    }
  }
}
