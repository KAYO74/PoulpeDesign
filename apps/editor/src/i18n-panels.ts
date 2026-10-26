/*
 * Textes des panneaux rangés librement (Photoshop, Affinity) : menu Fenêtre, fermer un panneau,
 * le déposer dans un autre groupe. Onglets des Personas en haut, comme Affinity.
 */

export const frPanels = {
  'menu.window': 'Fenêtre',
  'panel.close': 'Fermer le panneau',
  'panel.dropHere': 'Déposez un panneau ici',
  'tab.draw': 'Vectoriel',
  'tab.photo': 'Pixel',
  'tab.layout': 'Mise en page',
  'tab.export': 'Export',
} as const;

export type MessageKeyPanels = keyof typeof frPanels;

export const enPanels: Record<MessageKeyPanels, string> = {
  'menu.window': 'Window',
  'panel.close': 'Close panel',
  'panel.dropHere': 'Drop a panel here',
  'tab.draw': 'Vector',
  'tab.photo': 'Pixel',
  'tab.layout': 'Layout',
  'tab.export': 'Export',
};
