/*
 * Textes du glisser-déposer de fichiers dans la fenêtre.
 */

export const frDrop = {
  'file.dropUnsupported': 'Format non pris en charge : {name}',
} as const;

export type MessageKeyDrop = keyof typeof frDrop;

export const enDrop: Record<MessageKeyDrop, string> = {
  'file.dropUnsupported': 'Unsupported format: {name}',
};
