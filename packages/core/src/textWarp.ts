/*
 * Déformation du texte (arc, vague) : le texte suit une courbe calculée d'après sa largeur, avec le
 * moteur du texte sur tracé.
 */

import type { TextWarp } from './types';

/** Courbe de la déformation pour un texte de largeur `width` : tracé SVG et hauteur de sa boîte. */
export function warpPath(warp: TextWarp, width: number): { d: string; height: number } {
  const w = Math.max(1, width);
  const bend = Math.max(-1, Math.min(1, warp.bend));
  const r = (n: number) => Math.round(n * 100) / 100;
  if (warp.kind === 'arc') {
    // Flèche de l'arc : positif = vers le haut (le texte forme un dôme), négatif = vers le bas.
    const s = Math.abs(bend) * w * 0.5;
    const h = Math.max(1, s);
    return bend >= 0
      ? { d: `M0 ${r(h)} Q${r(w / 2)} ${r(h - 2 * s)} ${r(w)} ${r(h)}`, height: h }
      : { d: `M0 0 Q${r(w / 2)} ${r(2 * s)} ${r(w)} 0`, height: h };
  }
  // Vague : une crête puis un creux (ou l'inverse), d'amplitude proportionnelle à la largeur.
  const a = Math.abs(bend) * w * 0.12;
  const h = Math.max(1, 2 * a);
  const mid = h / 2;
  const up = bend >= 0 ? -1 : 1;
  return {
    d:
      `M0 ${r(mid)} Q${r(w / 4)} ${r(mid + up * 2 * a)} ${r(w / 2)} ${r(mid)}` +
      ` Q${r((3 * w) / 4)} ${r(mid - up * 2 * a)} ${r(w)} ${r(mid)}`,
    height: h,
  };
}
