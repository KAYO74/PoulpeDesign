/*
 * Textes des panneaux rangés librement (Photoshop, Affinity) : menu Fenêtre, fermer un panneau,
 * le déposer dans un autre groupe.
 */

export const frPanels = {
  'menu.window': 'Fenêtre',
  'panel.close': 'Fermer le panneau',
  'panel.dropHere': 'Déposez un panneau ici',
} as const;

export type MessageKeyPanels = keyof typeof frPanels;

export const enPanels: Record<MessageKeyPanels, string> = {
  'menu.window': 'Window',
  'panel.close': 'Close panel',
  'panel.dropHere': 'Drop a panel here',
};
