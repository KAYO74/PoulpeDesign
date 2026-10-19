/*
 * Textes ajoutés en version 1.2.9 : partage de pinceaux (paquets installés comme des extensions).
 */

export const frV129 = {
  'brushPacks.title': 'Pinceaux',
  'brushPacks.none': 'Aucun pinceau installé.',
  'brushPacks.install': 'Installer des pinceaux…',
  'brushPacks.share': 'Partager mes pinceaux…',
  'brushPacks.shareHint': 'Enregistre vos pinceaux et leurs formes dans un fichier .poulpebrushes',
  'brushPacks.defaultName': 'Mes pinceaux',
  'brushPacks.installed': '« {name} » installé : {n} pinceaux',
  'brushPacks.invalid': 'Aucun pinceau lisible dans ce fichier',
  'brushPacks.count': '{n} pinceaux',
} as const;

export type MessageKeyV129 = keyof typeof frV129;

export const enV129: Record<MessageKeyV129, string> = {
  'brushPacks.title': 'Brushes',
  'brushPacks.none': 'No brushes installed.',
  'brushPacks.install': 'Install brushes…',
  'brushPacks.share': 'Share my brushes…',
  'brushPacks.shareHint': 'Saves your brushes and their shapes in a .poulpebrushes file',
  'brushPacks.defaultName': 'My brushes',
  'brushPacks.installed': '“{name}” installed: {n} brushes',
  'brushPacks.invalid': 'No readable brush in this file',
  'brushPacks.count': '{n} brushes',
};
