/*
 * Textes de l'agrandissement par IA.
 */

export const frAiUpscale = {
  'edit.aiUpscale': 'Agrandir par IA…',
  'history.aiUpscale': 'Agrandir par IA',
  'aiupscale.title': 'Agrandir par IA',
  'aiupscale.hint':
    'Ajoute des pixels et des détails au calque (ses dimensions dans le document ne changent pas). Calcul sur votre ordinateur : plusieurs minutes pour une grande image.',
  'aiupscale.factor': 'Facteur',
  'aiupscale.tooBig': 'Image trop grande pour cet agrandissement (plus de 6 millions de pixels).',
  'aiupscale.failed': "L'agrandissement n'a pas pu se faire.",
  'aiupscale.modelMissing': "Le modèle d'agrandissement est absent de cette installation.",
};

export type MessageKeyAiUpscale = keyof typeof frAiUpscale;

export const enAiUpscale: Record<MessageKeyAiUpscale, string> = {
  'edit.aiUpscale': 'AI upscale…',
  'history.aiUpscale': 'AI upscale',
  'aiupscale.title': 'AI upscale',
  'aiupscale.hint':
    'Adds pixels and detail to the layer (its size in the document does not change). Runs on your computer: several minutes for a large image.',
  'aiupscale.factor': 'Factor',
  'aiupscale.tooBig': 'Image too large for this upscale (over 6 million pixels).',
  'aiupscale.failed': 'The upscale could not be done.',
  'aiupscale.modelMissing': 'The upscale model is missing from this installation.',
};
