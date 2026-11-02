/*
 * Textes ajoutés en version 1.2.10 : enregistrer le projet en PSD (Photoshop et Affinity).
 */

export const frV1210 = {
  'layer.newPixelMany': 'Plusieurs calques de pixels…',
  'layer.manyTitle': 'Créer plusieurs calques',
  'layer.manyCount': 'Nombre de calques',
  'layer.manyGo': 'Créer',
  'file.saveAsPsd': 'Enregistrer en PSD (Photoshop, Affinity)…',
  'psdSave.savedActive':
    'Enregistré : le PSD montre le plan de travail actif, Poulpe Design garde tout le document',
} as const;

export type MessageKeyV1210 = keyof typeof frV1210;

export const enV1210: Record<MessageKeyV1210, string> = {
  'layer.newPixelMany': 'Several pixel layers…',
  'layer.manyTitle': 'Create several layers',
  'layer.manyCount': 'Number of layers',
  'layer.manyGo': 'Create',
  'file.saveAsPsd': 'Save as PSD (Photoshop, Affinity)…',
  'psdSave.savedActive': 'Saved: the PSD shows the active artboard, Poulpe Design keeps the whole document',
};
