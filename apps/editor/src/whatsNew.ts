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
    version: '1.8.0',
    fr: [
      'Visite guidée de 2 minutes et aide « Je viens de Photoshop / Illustrator » (touches comparées).',
      'Variantes de calques : enregistrez et rappelez visibilité, opacité et position.',
      'Outils Dégradé de formes et Filet de dégradé ; Fluidité avec masque de gel.',
      'Texte déformé en cercle et en montée ; grille isométrique.',
      'Plus rapide : correcteur, gomme magique et vectorisation en Rust, démarrage plus léger.',
    ],
    en: [
      '2-minute guided tour and a “Coming from Photoshop / Illustrator” help tab (keys compared).',
      'Layer comps: save and recall visibility, opacity and position.',
      'Shape blend and Gradient mesh tools; Liquify with a freeze mask.',
      'Warped text in circle and rise; isometric grid.',
      'Faster: healing, magic eraser and vectorizing in Rust, lighter startup.',
    ],
  },
  {
    version: '1.7.0',
    fr: [
      'Ouvrir ou enregistrer en tapant un chemin de fichier (appli de bureau).',
      'Créer plusieurs calques de pixels d’un coup.',
      'La recherche Ctrl+K affiche la touche de chaque outil.',
      'Import PSD : plus de calques de réglage reconnus, et un avertissement pour ceux qui sont ignorés.',
      'Photothèque vide plus claire.',
    ],
    en: [
      'Open or save by typing a file path (desktop app).',
      'Create several pixel layers at once.',
      'Ctrl+K search shows the key of each tool.',
      'PSD import: more adjustment layers recognised, and a warning for the ones that are skipped.',
      'Clearer empty photo library.',
    ],
  },
  {
    version: '1.6.0',
    fr: [
      'Choix de police : recherche, filtres (avec ou sans empattement, écriture, gras…) et noms écrits dans leur police.',
      'Texte déformé : arc et vague.',
      'Photothèque : exportez vos photos avec taille, qualité et filigrane.',
      'Un champ de recherche (Ctrl+K) toujours visible dans la barre de titre.',
    ],
    en: [
      'Font picker: search, filters (serif, sans serif, script, bold…) and names shown in their own font.',
      'Warped text: arc and wave.',
      'Photo library: export your photos with size, quality and watermark.',
      'A search field (Ctrl+K) always visible in the title bar.',
    ],
  },
  {
    version: '1.5.1',
    fr: [
      'Cette fenêtre Nouveautés s’affiche après chaque mise à jour.',
      'Développement RAW : touche \\ pour comparer avant et après.',
      'Panneaux : onglets défilables à la molette.',
      'Raccourcis affichés en anglais quand l’app est en anglais.',
      'Le document de départ prend le nom de la langue choisie.',
    ],
    en: [
      'This What’s new window now appears after every update.',
      'RAW develop: press \\ to compare before and after.',
      'Panels: tabs scroll with the mouse wheel.',
      'Shortcuts shown in English when the app is in English.',
      'The starting document is named in the chosen language.',
    ],
  },
  {
    version: '1.5.0',
    fr: [
      'Photothèque : classez et retouchez vos photos RAW, style Lightroom.',
      'Onglets de documents : « + » pour travailler sur plusieurs projets à la fois.',
      'Recherche de commande (Ctrl+K) et infobulles avec raccourci.',
      'Préréglages de touches Affinity, Photoshop et Illustrator.',
      'Retouches locales en dégradé linéaire et radial.',
    ],
    en: [
      'Photo library: sort and edit RAW photos, Lightroom style.',
      'Document tabs: "+" to work on several projects at once.',
      'Command search (Ctrl+K) and tooltips with shortcuts.',
      'Key presets for Affinity, Photoshop and Illustrator.',
      'Local adjustments with linear and radial gradients.',
    ],
  },
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
  // Tout premier lancement : la visite guidée (pas dans un navigateur piloté par les tests).
  if (seen === null && ui.get().settings.showWelcome && !navigator.webdriver)
    setTimeout(() => ui.set({ tourOpen: true }), 1200);
  if (seen !== null && RELEASES.some((r) => r.version === __APP_VERSION__)) setTimeout(openWhatsNew, 2500);
}
