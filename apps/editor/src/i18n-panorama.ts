/*
 * Textes de l'assemblage de panorama.
 */

export const frPanorama = {
  'image.panorama': 'Assembler un panorama…',
  'history.panorama': 'Panorama',
  'panorama.title': 'Assembler un panorama',
  'panorama.hint':
    'Choisissez des photos prises à la suite, qui se recouvrent en partie (au moins un tiers). Elles sont assemblées de gauche à droite, puis de haut en bas.',
  'panorama.exposure': 'Égaliser la luminosité entre les photos',
  'panorama.run': 'Assembler',
  'panorama.working': 'Assemblage…',
  'panorama.cancelled': 'Assemblage annulé.',
  'panorama.name': 'Panorama',
};

export type MessageKeyPanorama = keyof typeof frPanorama;

export const enPanorama: Record<MessageKeyPanorama, string> = {
  'image.panorama': 'Stitch Panorama…',
  'history.panorama': 'Panorama',
  'panorama.title': 'Stitch panorama',
  'panorama.hint':
    'Pick photos taken in a row that overlap in part (at least a third). They are stitched left to right, then top to bottom.',
  'panorama.exposure': 'Even out brightness between photos',
  'panorama.run': 'Stitch',
  'panorama.working': 'Stitching…',
  'panorama.cancelled': 'Stitching cancelled.',
  'panorama.name': 'Panorama',
};
