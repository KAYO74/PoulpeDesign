/**
 * Couleur du thème choisie dans Préférences › Affichage. Elle remplace la couleur d'accent rose
 * (boutons, onglets actifs, sélections de l'interface) sans toucher au reste du thème sombre ou clair.
 */

/** Couleurs proposées en un clic. La première est la couleur d'origine de Poulpe Design. */
export const ACCENT_PRESETS = [
  '#ff5f86',
  '#ff8a3d',
  '#f2c230',
  '#3ccf7a',
  '#20c4d8',
  '#4da3ff',
  '#8a6cff',
  '#d45cff',
];

const VARS = ['--accent', '--accent-hi', '--accent-fg', '--accent-soft'];

function parse(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number[]) =>
  '#' +
  c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

/** Mélange vers le blanc (t > 0) ou vers le noir (t < 0). */
const mix = (c: number[], t: number) => c.map((v) => (t > 0 ? v + (255 - v) * t : v * (1 + t)));

function luminance(c: number[]): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Applique la couleur (ou remet celle du thème si `hex` est vide). */
export function applyAccent(hex: string | null, theme: 'dark' | 'light') {
  const style = document.documentElement.style;
  const rgb = hex ? parse(hex) : null;
  if (!rgb) {
    VARS.forEach((v) => style.removeProperty(v));
    return;
  }
  let c: number[] = rgb;
  // En thème clair, une couleur trop pâle est foncée pour rester lisible sur les panneaux clairs.
  if (theme === 'light') while (luminance(c) > 0.3) c = mix(c, -0.1);
  const fgDark = luminance(c) > 0.35;
  style.setProperty('--accent', toHex(c));
  style.setProperty('--accent-hi', toHex(mix(c, 0.18)));
  style.setProperty('--accent-fg', fgDark ? '#16121a' : '#ffffff');
  style.setProperty(
    '--accent-soft',
    `rgba(${c.map(Math.round).join(', ')}, ${theme === 'light' ? 0.12 : 0.16})`,
  );
}
