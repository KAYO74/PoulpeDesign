import type { ToolId } from '../store';
import { ICON_PATHS, type IconName } from '../components/Icon';

/*
 * Curseurs des outils sur le document, dessinés à partir des icônes de Poulpe : une flèche pleine
 * pour Déplacer, une flèche creuse pour Nœud, et pour les autres outils une petite croix de visée
 * accompagnée de l'icône de l'outil. Un liseré clair les garde lisibles sur tous les fonds.
 */

const DARK = '#1a1a1d';
const LIGHT = '#ffffff';

function svgCursor(body: string, size: number, x: number, y: number, fallback: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
}

/** Trait d'une icône avec un liseré clair dessous. */
function outlined(d: string, transform: string, scale = 1): string {
  const common = `d="${d}" transform="${transform}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  return (
    `<path ${common} stroke="${LIGHT}" stroke-width="${3 / scale}"/>` +
    `<path ${common} stroke="${DARK}" stroke-width="${1.3 / scale}"/>`
  );
}

/** Flèche de sélection : pleine (Déplacer) ou creuse (Nœud). */
function arrow(hollow: boolean): string {
  const fill = hollow ? LIGHT : DARK;
  const stroke = hollow ? DARK : LIGHT;
  return svgCursor(
    `<path d="${ICON_PATHS.select}" transform="scale(1.5)" fill="${fill}" stroke="${stroke}" stroke-width="0.7" stroke-linejoin="round"/>`,
    24,
    6,
    4,
    'default',
  );
}

/** Croix de visée au point chaud (8, 8), et l'icône de l'outil en bas à droite. */
function crosshairWith(icon: IconName): string {
  const cross = 'M8 1.5v4.5 M8 10v4.5 M1.5 8h4.5 M10 8h4.5';
  return svgCursor(
    outlined(cross, '') +
      `<circle cx="8" cy="8" r="0.9" fill="${DARK}" stroke="${LIGHT}" stroke-width="0.6"/>` +
      outlined(ICON_PATHS[icon], 'translate(15 15)'),
    32,
    8,
    8,
    'crosshair',
  );
}

/** Pipette : la pointe de l'icône est le point chaud. */
function eyedropper(): string {
  return svgCursor(outlined(ICON_PATHS.eyedropper, 'translate(1 1) scale(1.4)', 1.4), 24, 4, 20, 'crosshair');
}

const cache = new Map<ToolId, string>();

/** Curseur CSS d'un outil sur le canevas. */
export function cursorFor(tool: ToolId): string {
  let c = cache.get(tool);
  if (c) return c;
  switch (tool) {
    case 'select':
      c = arrow(false);
      break;
    case 'direct':
      c = arrow(true);
      break;
    case 'hand':
      c = 'grab';
      break;
    case 'zoom':
      c = 'zoom-in';
      break;
    case 'text':
      c = 'text';
      break;
    case 'eyedropper':
      c = eyedropper();
      break;
    default:
      c = tool in ICON_PATHS ? crosshairWith(tool as IconName) : 'crosshair';
  }
  cache.set(tool, c);
  return c;
}
