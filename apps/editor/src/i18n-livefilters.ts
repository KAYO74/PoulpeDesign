/*
 * Textes des filtres en direct des calques et des objets dynamiques (images liées).
 */

export const frLiveFilters = {
  'menu.layerLiveFilters': 'Filtres en direct du calque',
  'livefilter.title': 'filtre en direct',
  'livefilter.hint':
    'Le filtre agit sur ce calque seulement et reste modifiable : double-cliquez dessus dans le panneau Calques pour le régler à nouveau.',
  'livefilter.edit': 'Régler le filtre',
  'livefilter.remove': 'Supprimer le filtre',
  'livefilter.hide': 'Désactiver le filtre',
  'livefilter.show': 'Activer le filtre',
  'history.addLiveFilter': 'Filtre en direct',
  'history.liveFilter': 'Réglage du filtre en direct',
  'history.removeLiveFilter': 'Suppression du filtre en direct',
  'menu.smartObject': 'Objet dynamique',
  'link.place': 'Placer une image liée…',
  'link.replace': 'Remplacer l’image…',
  'link.embed': 'Incorporer l’image liée',
  'link.update': 'Mettre à jour les images liées',
  'link.badge': 'Image liée : {path}',
  'link.missing': '{n} image(s) liée(s) introuvable(s) : l’image incorporée est gardée.',
  'history.updateLinks': 'Mise à jour des images liées',
  'history.embedImage': 'Incorporation de l’image',
  'history.replaceImage': 'Remplacement de l’image',
} as const;

export type MessageKeyLiveFilters = keyof typeof frLiveFilters;

export const enLiveFilters: Record<MessageKeyLiveFilters, string> = {
  'menu.layerLiveFilters': 'Layer live filters',
  'livefilter.title': 'live filter',
  'livefilter.hint':
    'The filter only affects this layer and stays editable: double-click it in the Layers panel to adjust it again.',
  'livefilter.edit': 'Adjust filter',
  'livefilter.remove': 'Delete filter',
  'livefilter.hide': 'Disable filter',
  'livefilter.show': 'Enable filter',
  'history.addLiveFilter': 'Live filter',
  'history.liveFilter': 'Live filter settings',
  'history.removeLiveFilter': 'Delete live filter',
  'menu.smartObject': 'Smart object',
  'link.place': 'Place linked image…',
  'link.replace': 'Replace image…',
  'link.embed': 'Embed linked image',
  'link.update': 'Update linked images',
  'link.badge': 'Linked image: {path}',
  'link.missing': '{n} linked image(s) not found: the embedded image is kept.',
  'history.updateLinks': 'Update linked images',
  'history.embedImage': 'Embed image',
  'history.replaceImage': 'Replace image',
};
