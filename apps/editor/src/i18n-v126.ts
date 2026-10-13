/*
 * Textes ajoutés en version 1.2.6 : fusionner et grouper depuis le panneau Calques.
 */

export const frV126 = {
  'layers.merge': 'Fusionner',
  'layer.mergeSelected': 'Fusionner en une image',
  'history.mergeSelected': 'Fusionner les calques',
  'name.mergedLayers': 'Calques fusionnés',
} as const;

export type MessageKeyV126 = keyof typeof frV126;

export const enV126: Record<MessageKeyV126, string> = {
  'layers.merge': 'Merge',
  'layer.mergeSelected': 'Merge into one image',
  'history.mergeSelected': 'Merge layers',
  'name.mergedLayers': 'Merged layers',
};
