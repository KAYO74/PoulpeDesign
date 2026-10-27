/*
 * Textes des préréglages de touches d'outils (Aide > Raccourcis clavier).
 */

export const frKeyPresets = {
  'shortcuts.preset': 'Touches des outils',
  'shortcuts.preset.affinity': 'Comme Affinity',
  'shortcuts.preset.photoshop': 'Comme Photoshop',
  'shortcuts.preset.illustrator': 'Comme Illustrator',
} as const;

export type MessageKeyKeyPresets = keyof typeof frKeyPresets;

export const enKeyPresets: Record<MessageKeyKeyPresets, string> = {
  'shortcuts.preset': 'Tool keys',
  'shortcuts.preset.affinity': 'Like Affinity',
  'shortcuts.preset.photoshop': 'Like Photoshop',
  'shortcuts.preset.illustrator': 'Like Illustrator',
};
