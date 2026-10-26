import { alphaOf, isGradient, opaque, parseColor, withAlpha } from './color';
import type { Artboard, Color, Paint, SceneNode } from './types';
import { isStyled } from './tree';

/*
 * Application d'une palette à un design (comme les palettes de Canva).
 *
 * Chaque couleur du design est placée entre la plus sombre et la plus claire du design, et prend
 * la couleur de la palette placée au même endroit : le texte sombre sur fond clair reste sombre
 * sur fond clair, et le design garde ses contrastes. `variant` décale l'attribution des couleurs
 * intermédiaires, pour proposer d'autres combinaisons de la même palette.
 */

/** Luminance relative (WCAG) d'une couleur. */
export function luminance(c: Color): number {
  const { r, g, b } = parseColor(c);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Rapport de contraste WCAG entre deux couleurs (1 à 21). */
export function contrastRatio(a: Color, b: Color): number {
  const la = luminance(a),
    lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Visitor = (c: Color) => Color;

function mapPaint(p: Paint, f: Visitor): Paint {
  switch (p.type) {
    case 'none':
      return p;
    case 'solid':
      return { ...p, color: f(p.color) };
    case 'pattern':
      return p;
    case 'hatch':
      return {
        ...p,
        color: f(p.color),
        ...(p.background ? { background: f(p.background) } : {}),
      };
    default:
      return { ...p, stops: p.stops.map((s) => ({ ...s, color: f(s.color) })) };
  }
}

function mapNode(n: SceneNode, f: Visitor): void {
  if (n.type === 'group') return n.children.forEach((c) => mapNode(c, f));
  if (!isStyled(n)) return;
  n.fill = mapPaint(n.fill, f);
  n.stroke = { ...n.stroke, paint: mapPaint(n.stroke.paint, f) };
  if (n.type === 'text' && n.runs)
    n.runs = n.runs.map((r) =>
      r.style.color ? { ...r, style: { ...r.style, color: f(r.style.color) } } : r,
    );
}

export interface RecolorTarget {
  /** Plan de travail dont le fond est aussi recoloré. */
  artboard?: Artboard;
  nodes: SceneNode[];
}

/** Couleurs opaques distinctes du design, de la plus sombre à la plus claire. */
export function designColors(target: RecolorTarget): Color[] {
  const set = new Set<string>();
  const collect: Visitor = (c) => {
    set.add(opaque(c).toLowerCase());
    return c;
  };
  const paint = (p: Paint) => {
    if (p.type === 'solid') collect(p.color);
    else if (isGradient(p)) p.stops.forEach((s) => collect(s.color));
    else if (p.type === 'hatch') {
      collect(p.color);
      if (p.background) collect(p.background);
    }
  };
  const visit = (n: SceneNode) => {
    if (n.type === 'group') return n.children.forEach(visit);
    if (!isStyled(n)) return;
    paint(n.fill);
    paint(n.stroke.paint);
    if (n.type === 'text') n.runs?.forEach((r) => r.style.color && collect(r.style.color));
  };
  if (target.artboard) paint(target.artboard.background);
  target.nodes.forEach(visit);
  return [...set].sort((a, b) => luminance(a) - luminance(b));
}

/** Clarté perçue (L* de CIELAB, 0 à 100). */
export function lightness(c: Color): number {
  const y = luminance(c);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** Position de chaque couleur entre la plus sombre (0) et la plus claire (1) de sa liste. */
function positions(colors: Color[]): number[] {
  const l = colors.map(lightness);
  const min = Math.min(...l),
    max = Math.max(...l);
  return l.map((v) => (max - min < 1 ? 0.5 : (v - min) / (max - min)));
}

/**
 * Correspondance couleur du design → couleur de la palette : chaque couleur prend la couleur de
 * la palette qui occupe la même place entre le plus sombre et le plus clair.
 */
export function paletteMapping(colors: Color[], palette: Color[], variant = 0): Map<string, Color> {
  const sorted = [...palette].sort((a, b) => luminance(a) - luminance(b));
  const slots = positions(sorted);
  // Les couleurs extrêmes (la plus sombre, la plus claire) restent en place ; les autres tournent.
  if (variant && sorted.length > 3) {
    const mid = sorted.slice(1, -1);
    const r = variant % mid.length;
    sorted.splice(1, mid.length, ...mid.slice(r), ...mid.slice(0, r));
  }
  const map = new Map<string, Color>();
  const pos = positions(colors);
  colors.forEach((c, i) => {
    let best = 0;
    for (let j = 1; j < slots.length; j++)
      if (Math.abs(slots[j] - pos[i]) < Math.abs(slots[best] - pos[i])) best = j;
    map.set(c, sorted[best]);
  });
  return map;
}

/** Applique une palette au design (modifie en place, à appeler sur un brouillon). */
export function applyPalette(target: RecolorTarget, palette: Color[], variant = 0): void {
  if (!palette.length) return;
  const map = paletteMapping(designColors(target), palette, variant);
  const f: Visitor = (c) => {
    const to = map.get(opaque(c).toLowerCase());
    if (!to) return c;
    const a = alphaOf(c);
    return a < 1 ? withAlpha(to, a) : opaque(to);
  };
  if (target.artboard) target.artboard.background = mapPaint(target.artboard.background, f);
  target.nodes.forEach((n) => mapNode(n, f));
}
