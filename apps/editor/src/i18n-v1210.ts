/*
 * Textes ajoutés en version 1.2.10 : enregistrer le projet en PSD (Photoshop et Affinity).
 */

export const frV1210 = {
  'file.saveAsPsd': 'Enregistrer en PSD (Photoshop, Affinity)…',
  'psdSave.savedActive':
    'Enregistré : le PSD montre le plan de travail actif, Poulpe Design garde tout le document',
} as const;

export type MessageKeyV1210 = keyof typeof frV1210;

export const enV1210: Record<MessageKeyV1210, string> = {
  'file.saveAsPsd': 'Save as PSD (Photoshop, Affinity)…',
  'psdSave.savedActive': 'Saved: the PSD shows the active artboard, Poulpe Design keeps the whole document',
};
