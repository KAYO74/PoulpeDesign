/*
 * Textes ajoutés en version 1.2.8 : création de pinceau (formes depuis une image ou un fichier .abr).
 */

export const frV128 = {
  'brushEditor.title': 'Création de pinceau',
  'brushEditor.open': 'Créer un pinceau…',
  'view.brushEditor': 'Création de pinceau',
  'brushEditor.shape': 'Forme',
  'brushEditor.round': 'Ronde',
  'brushEditor.fromImage': 'Depuis une image…',
  'brushEditor.importAbr': 'Importer .abr…',
  'brushEditor.deleteShape': 'Supprimer cette forme',
  'brushEditor.spacing': 'Espacement',
  'brushEditor.angle': 'Angle',
  'brushEditor.roundness': 'Rondeur',
  'brushEditor.dynamics': 'Variations',
  'brushEditor.sizeJitter': 'Taille au hasard',
  'brushEditor.angleJitter': 'Angle au hasard',
  'brushEditor.scatter': 'Dispersion',
  'brushEditor.tryHint': 'Peignez sur le document pour essayer : la fenêtre reste ouverte.',
  'brushEditor.saved': 'Pinceau enregistré dans le panneau Pinceau',
  'brushEditor.emptyImage': 'Cette image ne contient rien à peindre',
  'brushEditor.abrNone': 'Aucune forme lisible dans ce fichier',
  'brushEditor.abrDone': '{n} formes importées',
} as const;

export type MessageKeyV128 = keyof typeof frV128;

export const enV128: Record<MessageKeyV128, string> = {
  'brushEditor.title': 'Brush creation',
  'brushEditor.open': 'Create a brush…',
  'view.brushEditor': 'Brush creation',
  'brushEditor.shape': 'Shape',
  'brushEditor.round': 'Round',
  'brushEditor.fromImage': 'From an image…',
  'brushEditor.importAbr': 'Import .abr…',
  'brushEditor.deleteShape': 'Delete this shape',
  'brushEditor.spacing': 'Spacing',
  'brushEditor.angle': 'Angle',
  'brushEditor.roundness': 'Roundness',
  'brushEditor.dynamics': 'Dynamics',
  'brushEditor.sizeJitter': 'Size jitter',
  'brushEditor.angleJitter': 'Angle jitter',
  'brushEditor.scatter': 'Scatter',
  'brushEditor.tryHint': 'Paint on the document to try it: the window stays open.',
  'brushEditor.saved': 'Brush saved in the Brush panel',
  'brushEditor.emptyImage': 'This image has nothing to paint',
  'brushEditor.abrNone': 'No readable shape in this file',
  'brushEditor.abrDone': '{n} shapes imported',
};
