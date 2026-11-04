/*
 * Textes de la fusion d'expositions et de l'empilement de mise au point.
 */

export const frFusion = {
  'image.fuse': 'Fusionner des expositions…',
  'history.fusion': 'Fusion d’images',
  'fusion.title': 'Fusionner des images',
  'fusion.mode': 'Mode',
  'fusion.mode.exposure': 'Expositions (HDR)',
  'fusion.mode.focus': 'Mise au point',
  'fusion.hintExposure':
    'Mélange des photos du même cadre prises à des expositions différentes : on garde le meilleur de chacune.',
  'fusion.hintFocus':
    'Empile des photos du même cadre mises au point à des distances différentes : chaque zone vient de l’image où elle est nette.',
  'fusion.contrast': 'Contraste',
  'fusion.saturation': 'Saturation',
  'fusion.wellExposed': 'Exposition',
  'fusion.run': 'Fusionner',
  'fusion.working': 'Fusion…',
  'fusion.cancelled': 'Fusion annulée.',
  'fusion.nameExposure': 'Fusion HDR',
  'fusion.nameFocus': 'Fusion mise au point',
};

export type MessageKeyFusion = keyof typeof frFusion;

export const enFusion: Record<MessageKeyFusion, string> = {
  'image.fuse': 'Merge Exposures…',
  'history.fusion': 'Merge images',
  'fusion.title': 'Merge images',
  'fusion.mode': 'Mode',
  'fusion.mode.exposure': 'Exposures (HDR)',
  'fusion.mode.focus': 'Focus stacking',
  'fusion.hintExposure':
    'Blends shots of the same frame taken at different exposures, keeping the best of each.',
  'fusion.hintFocus':
    'Stacks shots of the same frame focused at different distances: each area comes from the image where it is sharp.',
  'fusion.contrast': 'Contrast',
  'fusion.saturation': 'Saturation',
  'fusion.wellExposed': 'Exposure',
  'fusion.run': 'Merge',
  'fusion.working': 'Merging…',
  'fusion.cancelled': 'Merge cancelled.',
  'fusion.nameExposure': 'HDR merge',
  'fusion.nameFocus': 'Focus merge',
};
