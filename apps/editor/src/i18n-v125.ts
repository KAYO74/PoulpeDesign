/*
 * Textes ajoutés en version 1.2.5 : panneaux détachables un par un et taille de l'interface.
 */

export const frV125 = {
  'panel.tabHint': 'Glissez l’onglet hors du groupe pour en faire une fenêtre seule (double-clic : détacher)',
  'prefs.uiScale': 'Taille de l’interface',
  'prefs.uiScaleWeb':
    'Taille de l’interface : dans le navigateur, utilisez son zoom (Ctrl + et Ctrl −, ou Cmd sur Mac).',
} as const;

export type MessageKeyV125 = keyof typeof frV125;

export const enV125: Record<MessageKeyV125, string> = {
  'panel.tabHint': 'Drag the tab out of the group to make it a window of its own (double-click: undock)',
  'prefs.uiScale': 'Interface size',
  'prefs.uiScaleWeb': 'Interface size: in the browser, use its zoom (Ctrl + and Ctrl −, or Cmd on Mac).',
};
