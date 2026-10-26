import { setSettings, ui } from './store';

/*
 * Nouveautés de chaque version, affichées une fois après une mise à jour (et dans Aide > Nouveautés).
 * Ajouter une entrée en tête à chaque version publiée : trois à six lignes, simples, sans jargon.
 */

export interface ReleaseNotes {
  version: string;
  fr: string[];
  en: string[];
}

export const RELEASES: ReleaseNotes[] = [
  {
    version: '1.4.0',
    fr: [
      'Onglets en haut : Vectoriel, Pixel, Mise en page, Export.',
      'Photo : développement RAW, remplissage intelligent, déformation, filtres modifiables, objets liés.',
      'Panneau Couches, instantanés, motifs de hachures.',
      'Couleurs dans la barre du haut, listes et menus plus modernes.',
      'Texte des PDF conservé à l’ouverture.',
    ],
    en: [
      'Tabs at the top: Vector, Pixel, Layout, Export.',
      'Photo: RAW development, content-aware fill, mesh warp, editable filters, linked objects.',
      'Channels panel, snapshots, hatch patterns.',
      'Colors in the top bar, more modern lists and menus.',
      'PDF text is kept when opening.',
    ],
  },
  {
    version: '1.3.2',
    fr: [
      'Menu Fenêtre : afficher ou cacher chaque panneau.',
      'Panneaux déplaçables librement, comme dans Photoshop et Affinity.',
      'Connexion à des IA en ligne ou locales.',
    ],
    en: [
      'Window menu: show or hide each panel.',
      'Panels can be moved freely, like in Photoshop and Affinity.',
      'Connect online or local AI.',
    ],
  },
];

/** Ouvre la fenêtre des nouveautés (menu Aide ou après une mise à jour). */
export function openWhatsNew(): void {
  ui.set({ whatsNewOpen: true });
}

/**
 * Au lancement : si la version a changé depuis la dernière fois, affiche les nouveautés une fois.
 * Au tout premier lancement, on retient simplement la version.
 */
export function startWhatsNew(): void {
  const seen = ui.get().settings.lastSeenVersion;
  if (seen === __APP_VERSION__) return;
  setSettings({ lastSeenVersion: __APP_VERSION__ });
  if (seen !== null && RELEASES.some((r) => r.version === __APP_VERSION__)) setTimeout(openWhatsNew, 2500);
}
