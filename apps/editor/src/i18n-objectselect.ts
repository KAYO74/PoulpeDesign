/*
 * Textes de la sélection d'objet par IA.
 */

export const frObjectSelect = {
  'tool.objectSelect': 'Sélection d’objet',
  'hint.objectSelect':
    'cliquer sur un objet : il est sélectionné par IA. Majuscule ajoute, Alt retire. La première fois, l’image est analysée.',
  'tip.objectSelect.desc': 'Cliquez sur un objet pour le sélectionner, l’IA trouve ses contours.',
  'smart.objectBusy': 'Analyse de l’image…',
  'smart.objectFailed': 'La sélection d’objet a échoué.',
  'smart.objectOutside': 'Cliquez sur une image visible.',
  'smart.objectModelMissing': 'Les modèles de sélection d’objet sont absents de cette installation.',
};

export type MessageKeyObjectSelect = keyof typeof frObjectSelect;

export const enObjectSelect: Record<MessageKeyObjectSelect, string> = {
  'tool.objectSelect': 'Object selection',
  'hint.objectSelect':
    'click an object: it is selected by AI. Shift adds, Alt subtracts. The first time, the image is analysed.',
  'tip.objectSelect.desc': 'Click an object to select it; the AI finds its edges.',
  'smart.objectBusy': 'Analysing the image…',
  'smart.objectFailed': 'Object selection failed.',
  'smart.objectOutside': 'Click on a visible image.',
  'smart.objectModelMissing': 'The object selection models are missing from this installation.',
};
