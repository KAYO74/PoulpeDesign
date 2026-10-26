/*
 * Textes ajoutés en version 1.2.7 : sélecteur de couleur flottant (roue) et « aucune couleur » ;
 * puis les fenêtres de couleur de la barre du haut (cpop.*).
 */

export const frV127 = {
  'colorWindow.title': 'Sélecteur de couleur',
  'view.colorPicker': 'Sélecteur de couleur',
  'color.noColor': 'Aucune couleur',
  'color.shape': 'Sélecteur',
  'color.type': 'Type',
  'color.shapeBox': 'Carré',
  'color.shapeWheel': 'Roue',
  'color.shapeTriangle': 'Triangle',
  'cpop.swatches': 'Échantillons',
  'cpop.color': 'Couleur',
  'cpop.gradient': 'Dégradé',
  'cpop.palette': 'Couleurs',
  'cpop.reverse': 'Inverser',
  'cpop.stop': 'Arrêt',
  'cpop.primary': 'Couleur du pinceau',
} as const;

export type MessageKeyV127 = keyof typeof frV127;

export const enV127: Record<MessageKeyV127, string> = {
  'colorWindow.title': 'Color picker',
  'view.colorPicker': 'Color picker',
  'color.noColor': 'No color',
  'color.shape': 'Picker',
  'color.type': 'Type',
  'color.shapeBox': 'Box',
  'color.shapeWheel': 'Wheel',
  'color.shapeTriangle': 'Triangle',
  'cpop.swatches': 'Swatches',
  'cpop.color': 'Color',
  'cpop.gradient': 'Gradient',
  'cpop.palette': 'Colors',
  'cpop.reverse': 'Reverse',
  'cpop.stop': 'Stop',
  'cpop.primary': 'Brush color',
};
