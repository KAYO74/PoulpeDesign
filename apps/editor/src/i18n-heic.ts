/*
 * Textes des photos HEIC / HEIF.
 */

export const frHeic = {
  'heic.unreadable': 'Cette photo HEIC est illisible ou abîmée.',
  'heic.tooBig': 'Cette photo HEIC est trop grande (plus de 100 millions de pixels).',
  'heic.unsupported':
    'Cette photo HEIC utilise une variante pas encore prise en charge (par exemple 10 bits ou une image composée). Exportez-la en JPEG depuis votre appareil.',
};

export type MessageKeyHeic = keyof typeof frHeic;

export const enHeic: Record<MessageKeyHeic, string> = {
  'heic.unreadable': 'This HEIC photo is unreadable or damaged.',
  'heic.tooBig': 'This HEIC photo is too large (over 100 million pixels).',
  'heic.unsupported':
    'This HEIC photo uses a variant that is not supported yet (for example 10-bit or a tiled image). Export it as JPEG from your device.',
};
