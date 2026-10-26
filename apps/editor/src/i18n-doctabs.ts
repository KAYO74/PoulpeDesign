/*
 * Onglets de documents : ouvrir plusieurs projets à la fois.
 */

export const frDocTabs = {
  'tabs.new': 'Nouveau document',
  'tabs.close': 'Fermer le document',
  'file.unsavedAll': 'Des documents ont des modifications non enregistrées. Continuer quand même ?',
} as const;

export type MessageKeyDocTabs = keyof typeof frDocTabs;

export const enDocTabs: Record<MessageKeyDocTabs, string> = {
  'tabs.new': 'New document',
  'tabs.close': 'Close document',
  'file.unsavedAll': 'Some documents have unsaved changes. Continue anyway?',
};
