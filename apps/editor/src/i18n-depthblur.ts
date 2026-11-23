/*
 * Textes du flou d'objectif par profondeur.
 */

export const frDepthBlur = {
  'edit.depthBlur': "Flou d'objectif (profondeur)…",
  'history.depthBlur': "Flou d'objectif",
  'depthblur.title': "Flou d'objectif (profondeur)",
  'depthblur.hint':
    "Cliquez sur l'aperçu pour choisir ce qui reste net : ce qui est plus près ou plus loin devient flou. Calcul sur votre ordinateur.",
  'depthblur.loading': 'Analyse de la profondeur…',
  'depthblur.range': 'Zone nette',
  'depthblur.amount': 'Flou',
  'depthblur.showDepth': 'Voir la carte de profondeur',
  'depthblur.preview': 'Aperçu : cliquez pour choisir le plan net',
  'depthblur.failed': "Le flou d'objectif n'a pas pu se faire.",
  'depthblur.modelMissing': 'Le modèle de profondeur est absent de cette installation.',
};

export type MessageKeyDepthBlur = keyof typeof frDepthBlur;

export const enDepthBlur: Record<MessageKeyDepthBlur, string> = {
  'edit.depthBlur': 'Lens blur (depth)…',
  'history.depthBlur': 'Lens blur',
  'depthblur.title': 'Lens blur (depth)',
  'depthblur.hint':
    'Click the preview to choose what stays sharp: anything nearer or farther is blurred. Runs on your computer.',
  'depthblur.loading': 'Analysing depth…',
  'depthblur.range': 'Sharp zone',
  'depthblur.amount': 'Blur',
  'depthblur.showDepth': 'Show depth map',
  'depthblur.preview': 'Preview: click to choose the sharp plane',
  'depthblur.failed': 'The lens blur could not be done.',
  'depthblur.modelMissing': 'The depth model is missing from this installation.',
};
