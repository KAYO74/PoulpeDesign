/*
 * Textes ajoutés en version 1.2.10 : enregistrer le projet en PSD (Photoshop et Affinity).
 */

export const frV1210 = {
  'file.openPath': 'Ouvrir un chemin…',
  'file.saveAsPath': 'Enregistrer sous un chemin…',
  'path.title.open': 'Ouvrir un fichier par son chemin',
  'path.title.save': 'Enregistrer sous un chemin',
  'path.hint':
    'Collez le chemin complet du fichier, par exemple /home/moi/affiche.poulpe ou C:\\Images\\affiche.psd.',
  'path.error': 'Impossible : {e}',
  'file.saveAsPsd': 'Enregistrer en PSD (Photoshop, Affinity)…',
  'psdSave.savedActive':
    'Enregistré : le PSD montre le plan de travail actif, Poulpe Design garde tout le document',
} as const;

export type MessageKeyV1210 = keyof typeof frV1210;

export const enV1210: Record<MessageKeyV1210, string> = {
  'file.openPath': 'Open a path…',
  'file.saveAsPath': 'Save to a path…',
  'path.title.open': 'Open a file by its path',
  'path.title.save': 'Save to a path',
  'path.hint':
    'Paste the full path of the file, for example /home/me/poster.poulpe or C:\\Images\\poster.psd.',
  'path.error': 'Not possible: {e}',
  'file.saveAsPsd': 'Save as PSD (Photoshop, Affinity)…',
  'psdSave.savedActive': 'Saved: the PSD shows the active artboard, Poulpe Design keeps the whole document',
};
