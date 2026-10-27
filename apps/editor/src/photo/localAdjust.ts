/*
 * Retouches locales du développement RAW (comme les dégradés linéaire et radial de Lightroom) :
 * un réglage (exposition, contraste, saturation, température) qui ne s'applique qu'à une zone,
 * progressivement, selon un masque en dégradé. Calculé sur la photo développée, en aperçu comme
 * en taille réelle : les positions sont en fraction de la photo (0 à 1).
 */

export interface LocalAdjust {
  id: string;
  kind: 'linear' | 'radial';
  /** Linéaire : début (plein effet) et fin (aucun effet) du dégradé. Radial : centre et un point du bord (le masque est un cercle). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Radial : adoucissement du bord, de 0 à 100. */
  feather: number;
  /** Radial : l'effet agit à l'extérieur du cercle plutôt qu'à l'intérieur. */
  invert: boolean;
  /** Exposition en IL (-5 à 5), les autres de -100 à 100. */
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export const LOCAL_PARAMS = ['exposure', 'contrast', 'saturation', 'temperature'] as const;
export type LocalParam = (typeof LOCAL_PARAMS)[number];

let counter = 0;

/** Nouveau réglage local, avec un masque au milieu de la photo. */
export function newLocalAdjust(kind: LocalAdjust['kind']): LocalAdjust {
  return {
    id: `local${++counter}`,
    kind,
    ...(kind === 'linear' ? { x1: 0.5, y1: 0.1, x2: 0.5, y2: 0.6 } : { x1: 0.5, y1: 0.5, x2: 0.8, y2: 0.5 }),
    feather: 50,
    invert: false,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
  };
}

/** Part de l'effet (0 à 1) au point (x, y) d'une photo de rapport w / h. */
export function maskAt(a: LocalAdjust, x: number, y: number, w: number, h: number): number {
  if (a.kind === 'linear') {
    const dx = (a.x2 - a.x1) * w;
    const dy = (a.y2 - a.y1) * h;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return 0;
    const t = ((x - a.x1) * w * dx + (y - a.y1) * h * dy) / len2;
    const v = 1 - Math.min(1, Math.max(0, t));
    return v * v * (3 - 2 * v);
  }
  // Radial : un cercle (en pixels) centré sur le premier point, dont le bord passe par le second.
  const radius = Math.max(1e-3, Math.hypot((a.x2 - a.x1) * w, (a.y2 - a.y1) * h));
  const d = Math.hypot((x - a.x1) * w, (y - a.y1) * h) / radius;
  const soft = Math.max(0.01, a.feather / 100);
  const inner = 1 - soft;
  const t = Math.min(1, Math.max(0, (d - inner) / (1 - inner || 1)));
  const v = 1 - t * t * (3 - 2 * t);
  return a.invert ? 1 - v : v;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Applique les réglages locaux à une photo développée (sur place). */
export function applyLocals(img: ImageData, list: LocalAdjust[]): ImageData {
  const { width: w, height: h, data } = img;
  for (const a of list) {
    if (!a.exposure && !a.contrast && !a.saturation && !a.temperature) continue;
    const gain = 2 ** a.exposure;
    const con = 1 + a.contrast / 100;
    const sat = 1 + a.saturation / 100;
    const warm = a.temperature / 100;
    for (let py = 0; py < h; py++) {
      const y = (py + 0.5) / h;
      for (let px = 0; px < w; px++) {
        const m = maskAt(a, (px + 0.5) / w, y, w, h);
        if (m <= 0.001) continue;
        const i = (py * w + px) * 4;
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];
        // Exposition dans l'espace linéaire approché (gamma 2,2), contraste autour du gris moyen.
        const e = (c: number) => 255 * Math.pow(Math.min(1, Math.pow(c / 255, 2.2) * gain), 1 / 2.2);
        if (a.exposure) [r, g, b] = [e(r), e(g), e(b)];
        if (a.contrast) [r, g, b] = [(r - 128) * con + 128, (g - 128) * con + 128, (b - 128) * con + 128];
        if (a.saturation) {
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          [r, g, b] = [l + (r - l) * sat, l + (g - l) * sat, l + (b - l) * sat];
        }
        if (a.temperature) [r, b] = [r * (1 + 0.3 * warm), b * (1 - 0.3 * warm)];
        data[i] = clamp(data[i] + (r - data[i]) * m);
        data[i + 1] = clamp(data[i + 1] + (g - data[i + 1]) * m);
        data[i + 2] = clamp(data[i + 2] + (b - data[i + 2]) * m);
      }
    }
  }
  return img;
}
