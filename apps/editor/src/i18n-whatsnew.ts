/*
 * Fenêtre « Nouveautés » : montrée une fois après une mise à jour, et dans Aide.
 */

export const frWhatsNew = {
  'help.whatsNew': 'Nouveautés',
  'whatsNew.title': 'Nouveautés',
  'whatsNew.version': 'Version {version}',
  'whatsNew.ok': 'Compris',
} as const;

export type MessageKeyWhatsNew = keyof typeof frWhatsNew;

export const enWhatsNew: Record<MessageKeyWhatsNew, string> = {
  'help.whatsNew': 'What’s new',
  'whatsNew.title': 'What’s new',
  'whatsNew.version': 'Version {version}',
  'whatsNew.ok': 'Got it',
};
