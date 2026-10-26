/*
 * Textes de la recherche de commande (Ctrl+K, « Que voulez-vous faire ? »).
 */

export const frPalette = {
  'help.search': 'Que voulez-vous faire ?',
  'palette.title': 'Que voulez-vous faire ?',
  'palette.placeholder': 'Tapez un outil, un menu ou une action (ex. flou, exporter, plume)…',
  'palette.none': 'Rien ne correspond. Essayez un autre mot.',
  'palette.tool': 'Outil',
  'palette.command': 'Action',
  'palette.hint': '↑ ↓ pour choisir · Entrée pour lancer · Échap pour fermer',
} as const;

export type MessageKeyPalette = keyof typeof frPalette;

export const enPalette: Record<MessageKeyPalette, string> = {
  'help.search': 'What do you want to do?',
  'palette.title': 'What do you want to do?',
  'palette.placeholder': 'Type a tool, a menu or an action (e.g. blur, export, pen)…',
  'palette.none': 'Nothing matches. Try another word.',
  'palette.tool': 'Tool',
  'palette.command': 'Action',
  'palette.hint': '↑ ↓ to choose · Enter to run · Esc to close',
};
