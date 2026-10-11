import type { Persona, ToolId } from './store';

/* Outils de chaque Persona et catalogue complet, pour la colonne d'outils et les espaces de travail. */

/** Formes prêtes à l'emploi, toutes sous le bouton du Rectangle (comme dans Affinity). */
export const SHAPE_FAMILY: ToolId[] = [
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'polygon',
  'star',
  'arrow',
  'callout',
  'donut',
  'pie',
  'cog',
  'cloud',
  'heart',
  'spiral',
  'line',
];

export const DRAW_GROUPS: ToolId[][] = [
  ['select', 'direct', 'artboard'],
  ['pen', 'pencil', 'vectorBrush'],
  SHAPE_FAMILY,
  ['knife', 'scissors', 'corner', 'shapeBuilder', 'vectorCrop'],
  ['vectorFill', 'gradient', 'transparency', 'contour', 'strokeWidth'],
  ['text', 'frameText', 'image'],
  ['eyedropper', 'stylePicker', 'hand', 'zoom'],
];

export const PHOTO_GROUPS: ToolId[][] = [
  ['select', 'crop', 'straighten', 'perspective'],
  ['marqueeRect', 'marqueeEllipse', 'lasso', 'polyLasso', 'magicWand', 'quickSelect'],
  ['brush', 'colorReplace', 'eraser', 'backgroundEraser', 'floodEraser', 'fill', 'pixelGradient'],
  ['magicEraser', 'heal', 'patch', 'blemish', 'redEye', 'clone'],
  ['dodge', 'burn', 'sponge', 'blurBrush', 'sharpenBrush', 'smudge', 'liquify'],
  ['text'],
  ['eyedropper', 'hand', 'zoom'],
];

/** Outils de la Persona Mise en page, ceux d'Affinity Publisher. */
export const LAYOUT_GROUPS: ToolId[][] = [
  ['select', 'direct'],
  ['frameText', 'text', 'table'],
  ['pictureFrameRect', 'pictureFrameEllipse', 'vectorCrop', 'image'],
  ['pen'],
  SHAPE_FAMILY,
  ['gradient', 'transparency'],
  ['eyedropper', 'stylePicker', 'hand', 'zoom'],
];

/**
 * Familles d'outils qui partagent un seul bouton (les autres s'ouvrent au petit triangle), comme
 * dans Affinity : les formes sous le Rectangle, les ciseaux sous le Couteau, les gommes ensemble…
 */
export const TOOL_FAMILIES: ToolId[][] = [
  SHAPE_FAMILY,
  ['knife', 'scissors'],
  ['frameText', 'text', 'table'],
  ['pictureFrameRect', 'pictureFrameEllipse'],
  ['eyedropper', 'stylePicker'],
  ['crop', 'straighten'],
  ['eraser', 'backgroundEraser', 'floodEraser'],
  ['dodge', 'burn', 'sponge'],
  ['magicEraser', 'heal', 'patch', 'blemish', 'redEye'],
];

/** Boutons d'une liste d'outils : un par outil, sauf les familles réunies sous un seul bouton. */
export function withFamilies(tools: ToolId[]): ToolId[][] {
  const slots: ToolId[][] = [];
  const done = new Set<ToolId>();
  for (const id of tools) {
    if (done.has(id)) continue;
    const family = TOOL_FAMILIES.find((f) => f.includes(id));
    const slot = family ? family.filter((m) => tools.includes(m)) : [id];
    slot.forEach((m) => done.add(m));
    slots.push(slot);
  }
  return slots;
}

/** Outils d'une Persona, par groupe (pour la colonne et la boîte « Espace de travail »). */
export function toolGroupsFor(persona: Persona): ToolId[][] {
  return persona === 'photo' ? PHOTO_GROUPS : persona === 'layout' ? LAYOUT_GROUPS : DRAW_GROUPS;
}

const DRAW_TOOLS = new Set([...DRAW_GROUPS.flat(), ...LAYOUT_GROUPS.flat()]);
const PHOTO_TOOLS = new Set(PHOTO_GROUPS.flat());

/**
 * Tous les outils, rangés par famille, pour composer sa propre colonne dans un espace de travail
 * (vectoriel, pixel et le reste mélangés).
 */
export const TOOL_CATALOG: { id: 'select' | 'vector' | 'pixel' | 'other'; tools: ToolId[] }[] = [
  {
    id: 'select',
    tools: [
      'select',
      'direct',
      'artboard',
      'marqueeRect',
      'marqueeEllipse',
      'lasso',
      'polyLasso',
      'magicWand',
      'quickSelect',
    ],
  },
  {
    id: 'vector',
    tools: [
      'pen',
      'pencil',
      'vectorBrush',
      ...SHAPE_FAMILY,
      'scissors',
      'knife',
      'corner',
      'shapeBuilder',
      'vectorCrop',
      'vectorFill',
      'contour',
      'strokeWidth',
      'gradient',
      'transparency',
      'pictureFrameRect',
      'pictureFrameEllipse',
    ],
  },
  {
    id: 'pixel',
    tools: [
      'crop',
      'brush',
      'colorReplace',
      'eraser',
      'backgroundEraser',
      'floodEraser',
      'fill',
      'pixelGradient',
      'magicEraser',
      'heal',
      'patch',
      'blemish',
      'redEye',
      'clone',
      'dodge',
      'burn',
      'sponge',
      'blurBrush',
      'sharpenBrush',
      'smudge',
      'liquify',
      'straighten',
      'perspective',
    ],
  },
  {
    id: 'other',
    tools: ['text', 'frameText', 'table', 'image', 'eyedropper', 'stylePicker', 'hand', 'zoom'],
  },
];

/**
 * Petits groupes d'outils voisins (ceux des Personas, sans doublon), pour ranger une colonne
 * personnalisée en groupes comme dans Photoshop et Affinity.
 */
export function smallGroups(tools: ToolId[]): ToolId[][] {
  const seen = new Set<ToolId>();
  const groups: ToolId[][] = [];
  for (const g of [...DRAW_GROUPS, ...LAYOUT_GROUPS, ...PHOTO_GROUPS]) {
    const kept = g.filter((id) => tools.includes(id) && !seen.has(id));
    kept.forEach((id) => seen.add(id));
    if (kept.length) groups.push(kept);
  }
  const rest = tools.filter((id) => !seen.has(id));
  if (rest.length) groups.push(rest);
  return groups;
}

/** Persona dont un outil a besoin pour fonctionner (null : utilisable partout). */
export function toolPersona(id: ToolId): 'draw' | 'photo' | null {
  if (PHOTO_TOOLS.has(id) && !DRAW_TOOLS.has(id)) return 'photo';
  if (DRAW_TOOLS.has(id) && !PHOTO_TOOLS.has(id)) return 'draw';
  return null;
}
