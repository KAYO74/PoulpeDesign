/*
 * Textes des filtres en direct des calques.
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
};
