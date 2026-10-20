/*
 * Textes ajoutés en version 1.2.7 : sélecteur de couleur flottant (roue) et « aucune couleur ».
 */

export const frV127 = {
  'colorWindow.title': 'Sélecteur de couleur',
  'view.colorPicker': 'Sélecteur de couleur',
  'color.noColor': 'Aucune couleur',
  'color.shape': 'Forme du sélecteur',
  'color.shapeBox': 'Carré',
  'color.shapeWheel': 'Roue',
  'color.shapeTriangle': 'Triangle',
} as const;

export type MessageKeyV127 = keyof typeof frV127;

export const enV127: Record<MessageKeyV127, string> = {
  'colorWindow.title': 'Color picker',
  'view.colorPicker': 'Color picker',
  'color.noColor': 'No color',
  'color.shape': 'Picker shape',
  'color.shapeBox': 'Box',
  'color.shapeWheel': 'Wheel',
  'color.shapeTriangle': 'Triangle',
};
