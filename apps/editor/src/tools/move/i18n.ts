/* Textes de ces outils (français, puis anglais). Ce fichier n'importe rien. */

export const fr: Record<string, string> = {
  'tip.select.how':
    "**Cliquer** sur un objet pour le sélectionner, **+Maj** pour l'ajouter à la sélection, **+Ctrl** pour choisir dans un groupe, **+Alt** pour l'objet de dessous (cliquer encore pour descendre). **Glisser** dans le vide pour sélectionner au cadre. **Glisser**+**Alt** un objet pour le dupliquer. **Glisser** une poignée pour redimensionner, **+Maj** pour garder les proportions, **+Ctrl** pour partir du centre. **Double-cliquer** une courbe ou une forme pour ses nœuds. **Ctrl+J** répète la dernière transformation de la copie.",
  'tip.artboard.how':
    '**Glisser** dans le vide pour créer un plan de travail. **Glisser** un plan de travail pour le déplacer. **Glisser** une poignée du plan de travail actif pour le redimensionner, **+Maj** pour garder les proportions, **+Ctrl** pour partir du centre.',
  'tip.vectorCrop.how':
    '**Cliquer** un objet ou un groupe, puis **Glisser** une poignée pour le recadrer, **+Maj** pour garder les proportions. **Glisser** dedans pour déplacer le contenu. **Double-cliquer** ou **Entrée** pour terminer.',
  'tip.stylePicker.how':
    '**Cliquer** un objet pour prendre son style, puis **Cliquer** d’autres objets pour le leur appliquer. **Cliquer**+**Alt** pour prendre un autre style. **Échap** décharge le style.',
  'hint.select':
    'clic pour sélectionner (Alt : objet de dessous), glisser pour déplacer. Ctrl + poignée part du centre, double-clic sur une forme pour ses nœuds.',
  'hint.vectorCrop':
    'tirez les poignées pour recadrer l’objet sans rien effacer ; glissez dedans pour déplacer le contenu.',
  'hint.stylePicker':
    'cliquez un objet pour prendre son style, puis cliquez d’autres objets pour l’appliquer.',
  'history.vectorCrop': 'Recadrage vectoriel',
  'move.autoSelect': 'Sélection auto',
  'move.autoSelect.layer': 'Calque',
  'move.autoSelect.group': 'Groupe',
  'move.autoSelect.object': 'Objet',
  'move.origin': 'Afficher le point d’origine de la transformation',
  'move.separately': 'Transformer les objets séparément',
  'vcrop.name': 'Recadrage',
  'vcrop.mask': 'Cadre de recadrage',
  'vcrop.hint': 'Tirez les poignées pour recadrer, glissez dedans pour déplacer le contenu.',
  'vcrop.empty': 'Cliquez sur un objet ou un groupe à recadrer.',
  'vcrop.reset': 'Réinitialiser',
  'vcrop.done': 'Terminer',
  'stylePicker.loaded': 'Style de « {name} » pris',
  'stylePicker.loadedLabel': 'Style',
  'stylePicker.empty': 'Cliquez sur un objet pour prendre son style.',
  'stylePicker.apply': 'Appliquer',
  'stylePicker.part.fill': 'Remplissage',
  'stylePicker.part.stroke': 'Contour',
  'stylePicker.part.effects': 'Effets et opacité',
  'stylePicker.part.text': 'Texte',
  'stylePicker.effectsCount': '{n} effet(s)',
  'stylePicker.unload': 'Décharger',
};

export const en: Record<string, string> = {
  'tip.select.how':
    '**Click** an object to select it, **+Shift** to add it to the selection, **+Ctrl** to pick inside a group, **+Alt** for the object behind (click again to go deeper). **Drag** on empty space for a marquee. **Drag**+**Alt** an object to duplicate it. **Drag** a handle to resize, **+Shift** to keep proportions, **+Ctrl** from the center. **Double-click** a curve or shape for its nodes. **Ctrl+J** repeats the last transform of the copy.',
  'tip.artboard.how':
    '**Drag** on empty space to create an artboard. **Drag** an artboard to move it. **Drag** a handle of the active artboard to resize it, **+Shift** to keep proportions, **+Ctrl** from the center.',
  'tip.vectorCrop.how':
    '**Click** an object or group, then **Drag** a handle to crop it, **+Shift** to keep proportions. **Drag** inside to move the content. **Double-click** or **Enter** to finish.',
  'tip.stylePicker.how':
    '**Click** an object to pick up its style, then **Click** other objects to apply it. **Click**+**Alt** to pick another style. **Esc** unloads the style.',
  'hint.select':
    'click to select (Alt: object behind), drag to move. Ctrl + handle scales from the center, double-click a shape for its nodes.',
  'hint.vectorCrop':
    'drag the handles to crop the object without erasing anything; drag inside to move the content.',
  'hint.stylePicker': 'click an object to pick up its style, then click other objects to apply it.',
  'history.vectorCrop': 'Vector crop',
  'move.autoSelect': 'Auto-select',
  'move.autoSelect.layer': 'Layer',
  'move.autoSelect.group': 'Group',
  'move.autoSelect.object': 'Object',
  'move.origin': 'Show transform origin',
  'move.separately': 'Transform objects separately',
  'vcrop.name': 'Crop',
  'vcrop.mask': 'Crop frame',
  'vcrop.hint': 'Drag the handles to crop, drag inside to move the content.',
  'vcrop.empty': 'Click an object or group to crop.',
  'vcrop.reset': 'Reset',
  'vcrop.done': 'Done',
  'stylePicker.loaded': 'Picked up the style of “{name}”',
  'stylePicker.loadedLabel': 'Style',
  'stylePicker.empty': 'Click an object to pick up its style.',
  'stylePicker.apply': 'Apply',
  'stylePicker.part.fill': 'Fill',
  'stylePicker.part.stroke': 'Stroke',
  'stylePicker.part.effects': 'Effects & opacity',
  'stylePicker.part.text': 'Text',
  'stylePicker.effectsCount': '{n} effect(s)',
  'stylePicker.unload': 'Unload',
};
