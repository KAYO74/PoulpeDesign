/*
 * Visite guidée de 2 minutes : au premier lancement, puis dans Aide > Visite guidée.
 * Et le message quand une fenêtre chargée à la demande ne vient pas (loaderr.*).
 */

export const frTour = {
  'help.tour': 'Visite guidée',
  'tour.title': 'Visite guidée',
  'tour.step': 'Étape {n} sur {total}',
  'tour.skip': 'Passer',
  'tour.prev': 'Précédent',
  'tour.next': 'Suivant',
  'tour.done': 'Terminer',
  'tour.s1.title': 'Cinq onglets en haut',
  'tour.s1.text':
    'Photos pour classer vos photos, Vectoriel pour dessiner, Pixel pour retoucher, Mise en page pour les documents et Export pour livrer. Les outils changent avec l’onglet.',
  'tour.s2.title': 'Tout se trouve avec Ctrl+K',
  'tour.s2.text':
    'Tapez ce que vous voulez faire (« flou », « exporter », « plume ») : Poulpe retrouve l’outil ou l’action, avec son raccourci. Le champ en haut à droite fait la même chose.',
  'tour.s3.title': 'Les panneaux à droite',
  'tour.s3.text':
    'Couleur, Calques, Historique… Glissez un panneau où vous voulez, ou masquez-le dans le menu Fenêtre. Votre disposition est retenue.',
  'tour.s4.title': 'Plusieurs projets à la fois',
  'tour.s4.text':
    'Le « + » à côté du nom du document ouvre un nouvel onglet : chaque projet garde son contenu. Ouvrir un fichier n’efface plus ce que vous faisiez.',
  'tour.s5.title': 'Vos réflexes d’avant',
  'tour.s5.text':
    'Venez-vous de Photoshop ou d’Illustrator ? Une page montre où trouver chaque outil, et leurs touches d’outils se choisissent dans Aide > Raccourcis clavier.',
  'tour.s5.link': 'Ouvrir « Je viens de Photoshop / Illustrator »',
  'tour.s6.title': 'Enregistrer et exporter',
  'tour.s6.text':
    'Ctrl+S enregistre votre projet (.poulpe), le bouton Exporter en haut à droite crée PNG, JPEG, SVG, PDF ou PSD. Revoyez cette visite à tout moment dans le menu Aide.',
  'loaderr.title': 'Fenêtre indisponible',
  'loaderr.text':
    'Cette fenêtre n’a pas pu se charger. L’appli vient peut-être d’être mise à jour : rechargez la page pour continuer. Votre travail n’est pas perdu tant que la page reste ouverte.',
  'loaderr.reload': 'Recharger la page',
  'loaderr.close': 'Fermer',
} as const;

export const enTour: Record<keyof typeof frTour, string> = {
  'help.tour': 'Guided tour',
  'tour.title': 'Guided tour',
  'tour.step': 'Step {n} of {total}',
  'tour.skip': 'Skip',
  'tour.prev': 'Back',
  'tour.next': 'Next',
  'tour.done': 'Finish',
  'tour.s1.title': 'Five tabs at the top',
  'tour.s1.text':
    'Photos to sort your photos, Vector to draw, Pixel to retouch, Layout for documents and Export to deliver. The tools change with the tab.',
  'tour.s2.title': 'Find anything with Ctrl+K',
  'tour.s2.text':
    'Type what you want to do (“blur”, “export”, “pen”): Poulpe finds the tool or action, with its shortcut. The field at the top right does the same.',
  'tour.s3.title': 'Panels on the right',
  'tour.s3.text':
    'Color, Layers, History… Drag a panel wherever you like, or hide it from the Window menu. Your layout is remembered.',
  'tour.s4.title': 'Several projects at once',
  'tour.s4.text':
    'The “+” next to the document name opens a new tab: each project keeps its content. Opening a file no longer wipes what you were doing.',
  'tour.s5.title': 'Your old habits',
  'tour.s5.text':
    'Coming from Photoshop or Illustrator? One page shows where to find each tool, and their tool keys can be picked in Help > Keyboard shortcuts.',
  'tour.s5.link': 'Open “Coming from Photoshop / Illustrator”',
  'tour.s6.title': 'Save and export',
  'tour.s6.text':
    'Ctrl+S saves your project (.poulpe), the Export button at the top right creates PNG, JPEG, SVG, PDF or PSD. Replay this tour anytime from the Help menu.',
  'loaderr.title': 'Window unavailable',
  'loaderr.text':
    'This window could not be loaded. The app may have just been updated: reload the page to continue. Your work is not lost while the page stays open.',
  'loaderr.reload': 'Reload the page',
  'loaderr.close': 'Close',
};

export type MessageKeyTour = keyof typeof frTour;
