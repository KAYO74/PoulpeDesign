/*
 * Textes de la réduction du bruit.
 */

export const frDenoise = {
  'adjust.denoise': 'Réduction du bruit',
  'param.luminance': 'Luminance',
};

export type MessageKeyDenoise = keyof typeof frDenoise;

export const enDenoise: Record<MessageKeyDenoise, string> = {
  'adjust.denoise': 'Noise reduction',
  'param.luminance': 'Luminance',
};
