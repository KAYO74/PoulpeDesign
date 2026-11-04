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
  if (warp.kind === 'circle') {
    // Cercle : courbure maximale, le texte fait presque le tour (un petit blanc en bas) ; moins de
    // courbure, un plus grand cercle. Positif : le texte tourne autour, lu en haut ; négatif : à
    // l'intérieur, lu en bas.
    const R = (w * 1.1) / Math.max(0.1, Math.abs(bend)) / (2 * Math.PI);
    const cx = w / 2;
    return bend >= 0
      ? {
          d: `M${r(cx)} ${r(2 * R)} A${r(R)} ${r(R)} 0 1 1 ${r(cx)} 0 A${r(R)} ${r(R)} 0 1 1 ${r(cx)} ${r(2 * R)}`,
          height: Math.max(1, 2 * R),
        }
      : {
          d: `M${r(cx)} 0 A${r(R)} ${r(R)} 0 1 0 ${r(cx)} ${r(2 * R)} A${r(R)} ${r(R)} 0 1 0 ${r(cx)} 0`,
          height: Math.max(1, 2 * R),
        };
  }
  if (warp.kind === 'rise') {
    // Montée : le texte suit une droite qui monte (positif) ou descend (négatif).
    const h = Math.max(1, Math.abs(bend) * w * 0.5);
    return bend >= 0 ? { d: `M0 ${r(h)} L${r(w)} 0`, height: h } : { d: `M0 0 L${r(w)} ${r(h)}`, height: h };
  }
  if (warp.kind === 'flag') {
    // Drapeau : deux ondulations complètes, plus serrées que la vague, comme un drapeau au vent.
    const a = Math.abs(bend) * w * 0.07;
    const h = Math.max(1, 2 * a);
    const mid = h / 2;
    const up = bend >= 0 ? -1 : 1;
    let d = `M0 ${r(mid)}`;
    for (let i = 0; i < 4; i++) {
      const sign = i % 2 === 0 ? up : -up;
      d += ` Q${r(((2 * i + 1) * w) / 8)} ${r(mid + sign * 2 * a)} ${r(((i + 1) * w) / 4)} ${r(mid)}`;
    }
    return { d, height: h };
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
