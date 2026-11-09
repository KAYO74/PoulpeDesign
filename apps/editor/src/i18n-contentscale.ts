/*
 * Textes de la mise à l'échelle selon le contenu.
 */

export const frContentScale = {
  'edit.contentAwareScale': "Mise à l'échelle d'après le contenu…",
  'history.contentScale': "Mise à l'échelle d'après le contenu",
  'contentscale.title': "Mise à l'échelle d'après le contenu",
  'contentscale.hint':
    "Change la taille du calque en gardant intacts les détails (visages, objets) : le ciel et les fonds unis absorbent le changement. Les très grandes images sont d'abord réduites à 2 millions de pixels.",
  'contentscale.width': 'Largeur',
  'contentscale.height': 'Hauteur',
  'contentscale.amount': 'Quantité',
  'contentscale.protect': 'Protéger la sélection',
  'contentscale.failed': "La mise à l'échelle n'a pas pu se faire.",
};

export type MessageKeyContentScale = keyof typeof frContentScale;

export const enContentScale: Record<MessageKeyContentScale, string> = {
  'edit.contentAwareScale': 'Content-aware scale…',
  'history.contentScale': 'Content-aware scale',
  'contentscale.title': 'Content-aware scale',
  'contentscale.hint':
    'Resizes the layer while keeping details (faces, objects) intact: skies and plain backgrounds absorb the change. Very large images are first reduced to 2 million pixels.',
  'contentscale.width': 'Width',
  'contentscale.height': 'Height',
  'contentscale.amount': 'Amount',
  'contentscale.protect': 'Protect selection',
  'contentscale.failed': 'The content-aware scale could not be done.',
};
