/*
 * Textes de l'animation simple (animations d'entrée et export GIF).
 */

export const frAnim = {
  'object.animate': 'Animation…',
  'anim.title': 'Animation',
  'anim.selection': 'Objets choisis',
  'anim.noSelection':
    'Choisissez des objets pour les animer. La lecture et l’export montrent tout le plan de travail.',
  'anim.kind': 'Entrée',
  'anim.kind.none': 'Aucune',
  'anim.kind.fade': 'Fondu',
  'anim.kind.rise': 'Montée',
  'anim.kind.slide': 'Glissement',
  'anim.kind.zoom': 'Zoom',
  'anim.kind.pop': 'Rebond',
  'anim.kind.spin': 'Tourbillon',
  'anim.duration': 'Durée',
  'anim.delay': 'Délai',
  'anim.play': 'Rejouer',
  'anim.size': 'Taille',
  'anim.export': 'Exporter en GIF…',
  'anim.exporting': 'Création du GIF…',
  'anim.saved': 'GIF enregistré : {name}',
  'anim.empty': 'Aucun objet n’est animé sur ce plan de travail.',
  'history.animation': 'Animation',
  'anim.cancelled': 'Export annulé.',
  'anim.tooLong': 'Le GIF s’arrête à {s} s (au-delà, il serait trop lourd).',
};

export type MessageKeyAnim = keyof typeof frAnim;

export const enAnim: Record<MessageKeyAnim, string> = {
  'object.animate': 'Animation…',
  'anim.title': 'Animation',
  'anim.selection': 'Selected objects',
  'anim.noSelection': 'Select objects to animate them. Playback and export show the whole artboard.',
  'anim.kind': 'Entrance',
  'anim.kind.none': 'None',
  'anim.kind.fade': 'Fade',
  'anim.kind.rise': 'Rise',
  'anim.kind.slide': 'Slide',
  'anim.kind.zoom': 'Zoom',
  'anim.kind.pop': 'Pop',
  'anim.kind.spin': 'Spin',
  'anim.duration': 'Duration',
  'anim.delay': 'Delay',
  'anim.play': 'Replay',
  'anim.size': 'Size',
  'anim.export': 'Export as GIF…',
  'anim.exporting': 'Creating the GIF…',
  'anim.saved': 'GIF saved: {name}',
  'anim.empty': 'No object is animated on this artboard.',
  'history.animation': 'Animation',
  'anim.cancelled': 'Export cancelled.',
  'anim.tooLong': 'The GIF stops at {s} s (longer would be too heavy).',
};
