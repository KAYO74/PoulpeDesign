/*
 * Textes des préréglages de touches d'outils (Aide > Raccourcis clavier).
 */

export const frKeyPresets = {
  'help.tab.switch': 'Je viens de Photoshop / Illustrator',
  'switch.from': 'Je viens de',
  'switch.tool': 'Outil',
  'switch.theirKey': 'Touche chez {app}',
  'switch.ourKey': 'Touche dans Poulpe',
  'switch.use': 'Utiliser les touches de {app}',
  'switch.using': 'Les touches de {app} sont actives.',
  'switch.back': 'Revenir aux touches d’Affinity',
  'switch.c1':
    'Les Personas (Vectoriel, Pixel, Mise en page) remplacent le passage d’une appli à l’autre : même document, autres outils.',
  'switch.c2': 'Les calques de réglage et les filtres en direct restent modifiables, comme dans Photoshop.',
  'switch.c3': 'Ctrl+K cherche n’importe quelle commande par son nom.',
  'switch.c4': 'Les fichiers PSD et .ai s’ouvrent ; on peut enregistrer en PSD.',
  'shortcuts.preset': 'Touches des outils',
  'shortcuts.preset.affinity': 'Comme Affinity',
  'shortcuts.preset.photoshop': 'Comme Photoshop',
  'shortcuts.preset.illustrator': 'Comme Illustrator',
} as const;

export type MessageKeyKeyPresets = keyof typeof frKeyPresets;

export const enKeyPresets: Record<MessageKeyKeyPresets, string> = {
  'help.tab.switch': 'Coming from Photoshop / Illustrator',
  'switch.from': 'I come from',
  'switch.tool': 'Tool',
  'switch.theirKey': '{app} key',
  'switch.ourKey': 'Poulpe key',
  'switch.use': 'Use {app} keys',
  'switch.using': '{app} keys are active.',
  'switch.back': 'Back to Affinity keys',
  'switch.c1': 'Personas (Vector, Pixel, Layout) replace switching apps: same document, other tools.',
  'switch.c2': 'Adjustment layers and live filters stay editable, as in Photoshop.',
  'switch.c3': 'Ctrl+K finds any command by name.',
  'switch.c4': 'PSD and .ai files open; you can save as PSD.',
  'shortcuts.preset': 'Tool keys',
  'shortcuts.preset.affinity': 'Like Affinity',
  'shortcuts.preset.photoshop': 'Like Photoshop',
  'shortcuts.preset.illustrator': 'Like Illustrator',
};
