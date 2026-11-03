/*
 * Textes ajoutés en version 1.2.10 : enregistrer le projet en PSD (Photoshop et Affinity).
 */

export const frV1210 = {
  'file.openPath': 'Ouvrir un chemin…',
  'file.saveAsPath': 'Enregistrer sous un chemin…',
  'path.title.open': 'Ouvrir un fichier par son chemin',
  'path.title.save': 'Enregistrer sous un chemin',
  'path.hint':
    'Collez le chemin complet du fichier, par exemple /home/moi/affiche.poulpe ou C:\\Images\\affiche.psd.',
  'path.error': 'Impossible : {e}',
  'layer.newPixelMany': 'Plusieurs calques de pixels…',
  'layer.manyTitle': 'Créer plusieurs calques',
  'layer.manyCount': 'Nombre de calques',
  'layer.manyGo': 'Créer',
  'layer.comps': 'Variantes de calques…',
  'comps.title': 'Variantes de calques',
  'comps.hint': 'Enregistre l’état des calques (visibles, opacité, position) pour le rappeler en un clic.',
  'comps.name': 'Nom de la variante',
  'comps.add': 'Enregistrer l’état actuel',
  'comps.apply': 'Appliquer',
  'comps.update': 'Mettre à jour',
  'comps.delete': 'Supprimer',
  'comps.empty': 'Aucune variante.',
  'comps.default': 'Variante {n}',
  'history.compAdd': 'Nouvelle variante',
  'history.compApply': 'Variante appliquée',
  'history.compUpdate': 'Variante mise à jour',
  'history.compDelete': 'Variante supprimée',
  'file.saveAsPsd': 'Enregistrer en PSD (Photoshop, Affinity)…',
  'psdSave.savedActive':
    'Enregistré : le PSD montre le plan de travail actif, Poulpe Design garde tout le document',
  'object.blend': 'Dégradé de formes…',
  'shapeBlend.title': 'Dégradé de formes',
  'shapeBlend.hint':
    'Crée des formes intermédiaires entre les deux formes choisies : forme, couleur, trait et opacité changent pas à pas.',
  'shapeBlend.steps': 'Étapes',
  'shapeBlend.go': 'Créer',
  'shapeBlend.name': 'Dégradé de formes',
  'history.blend': 'Dégradé de formes',
} as const;

export type MessageKeyV1210 = keyof typeof frV1210;

export const enV1210: Record<MessageKeyV1210, string> = {
  'file.openPath': 'Open a path…',
  'file.saveAsPath': 'Save to a path…',
  'path.title.open': 'Open a file by its path',
  'path.title.save': 'Save to a path',
  'path.hint':
    'Paste the full path of the file, for example /home/me/poster.poulpe or C:\\Images\\poster.psd.',
  'path.error': 'Not possible: {e}',
  'layer.newPixelMany': 'Several pixel layers…',
  'layer.manyTitle': 'Create several layers',
  'layer.manyCount': 'Number of layers',
  'layer.manyGo': 'Create',
  'layer.comps': 'Layer comps…',
  'comps.title': 'Layer comps',
  'comps.hint':
    'Saves the state of the layers (visibility, opacity, position) so you can recall it in one click.',
  'comps.name': 'Comp name',
  'comps.add': 'Save current state',
  'comps.apply': 'Apply',
  'comps.update': 'Update',
  'comps.delete': 'Delete',
  'comps.empty': 'No comps yet.',
  'comps.default': 'Comp {n}',
  'history.compAdd': 'New comp',
  'history.compApply': 'Comp applied',
  'history.compUpdate': 'Comp updated',
  'history.compDelete': 'Comp deleted',
  'file.saveAsPsd': 'Save as PSD (Photoshop, Affinity)…',
  'psdSave.savedActive': 'Saved: the PSD shows the active artboard, Poulpe Design keeps the whole document',
  'object.blend': 'Blend shapes…',
  'shapeBlend.title': 'Blend shapes',
  'shapeBlend.hint':
    'Creates in-between shapes from the two selected shapes: outline, fill, stroke and opacity change step by step.',
  'shapeBlend.steps': 'Steps',
  'shapeBlend.go': 'Create',
  'shapeBlend.name': 'Blend',
  'history.blend': 'Blend shapes',
};
