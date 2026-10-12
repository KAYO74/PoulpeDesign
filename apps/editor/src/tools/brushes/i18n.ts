/* Textes de ces outils (français, puis anglais). Ce fichier n'importe rien. */

export const fr: Record<string, string> = {
  // Bulles d'aide des outils
  'tip.brush.how':
    '**Glisser** pour peindre, **Maj**+**Cliquer** pour un trait droit depuis le point précédent. **Alt**+**Glisser** prélève la couleur. **Ctrl**+**Alt**+**Glisser** : taille et dureté. **[** **]** : taille, **Maj**+**[** **]** : dureté. **1** à **0** : opacité, **Maj**+**1** à **0** : flux.',
  'tip.eraser.how':
    '**Glisser** pour effacer, **Maj**+**Cliquer** pour un trait droit. **Ctrl**+**Alt**+**Glisser** : taille et dureté. **[** **]** : taille, **Maj**+**[** **]** : dureté.',
  'tip.fill.how':
    '**Cliquer** pour remplir la zone de couleur proche. **Alt**+**Cliquer** prélève la couleur. Mode de fusion et source (calque ou tous les calques) dans la barre.',
  'tip.clone.how':
    '**Cliquer**+**Alt** pour choisir la source, puis **Glisser** pour peindre. **Maj**+**Cliquer** : trait droit. Aligné, source, rotation et échelle dans la barre.',
  'tip.heal.how':
    '**Cliquer**+**Alt** pour choisir la source, puis **Glisser** sur le défaut. **Maj**+**Cliquer** : trait droit.',
  'tip.dodge.how':
    '**Glisser** pour éclaircir les ombres, les tons moyens ou les hautes lumières (plage de tons dans la barre). **Maj**+**Cliquer** : trait droit.',
  'tip.burn.how':
    '**Glisser** pour assombrir les ombres, les tons moyens ou les hautes lumières (plage de tons dans la barre). **Maj**+**Cliquer** : trait droit.',
  'tip.blurBrush.how': '**Glisser** pour adoucir. **Maj**+**Cliquer** : trait droit.',
  'tip.sharpenBrush.how': '**Glisser** pour rendre plus net. **Maj**+**Cliquer** : trait droit.',
  'tip.smudge.how': '**Glisser** pour étaler. **Maj**+**Cliquer** : trait droit.',
  'tip.marqueeRect.how':
    '**Glisser** pour sélectionner, **+Maj** pour un carré, **+Alt** pendant le tracé pour partir du centre. **Maj** au départ ajoute, **Alt** retire.',
  'tip.marqueeEllipse.how':
    '**Glisser** pour sélectionner, **+Maj** pour un cercle, **+Alt** pendant le tracé pour partir du centre. **Maj** au départ ajoute, **Alt** retire.',
  'tip.lasso.desc': 'Sélectionnez une zone à main levée, en polygone ou en suivant les bords (magnétique).',
  'tip.lasso.how':
    'Main levée : **Glisser** autour de la zone. Polygonal : **Cliquer** pour chaque sommet. Magnétique : **Cliquer**, puis suivre le bord. **Double-clic** ou **Entrée** ferme, **Retour arrière** retire un point. **L** : outil.',
  'tip.magicWand.how':
    '**Cliquer** pour sélectionner les pixels de couleur proche, **Glisser** vers la droite ou la gauche pour régler la tolérance. **Maj** ajoute, **Alt** retire.',
  // Barre d'état
  'hint.brush':
    'peint avec la couleur principale. Maj + clic : trait droit, Alt : prélever la couleur, Ctrl + Alt + glisser : taille et dureté.',
  'hint.marqueeRect':
    "glisser pour sélectionner (Alt pendant le tracé : depuis le centre). Maj ajoute, Alt retire, Maj + Alt garde l'intersection.",
  'hint.marqueeEllipse':
    "glisser pour sélectionner (Alt pendant le tracé : depuis le centre). Maj ajoute, Alt retire, Maj + Alt garde l'intersection.",
  'hint.lasso':
    'main levée, polygonal ou magnétique (dans la barre). Maj ajoute, Alt retire ; double-clic ou Entrée pour fermer.',
  'hint.magicWand': 'clic pour sélectionner les pixels de couleur proche ; glisser règle la tolérance.',
  'hint.clone': 'Alt + clic pour choisir la source, puis peindre pour la recopier. Maj + clic : trait droit.',
  'hint.dodge': 'peindre pour éclaircir la plage de tons choisie.',
  'hint.burn': 'peindre pour assombrir la plage de tons choisie.',
  // Barre contextuelle
  'brushes.stabilizer': 'Stabilisateur',
  'brushes.rope': 'Corde',
  'brushes.window': 'Fenêtre',
  'brushes.ropeLength': 'Longueur',
  'brushes.windowSize': 'Fenêtre',
  'brushes.protectAlpha': 'Protéger l’alpha',
  'brushes.source': 'Source',
  'brushes.source.layer': 'Calque actuel',
  'brushes.source.all': 'Tous les calques',
  'brushes.tonalRange': 'Plage de tons',
  'brushes.tone.shadows': 'Ombres',
  'brushes.tone.midtones': 'Tons moyens',
  'brushes.tone.highlights': 'Hautes lumières',
  'brushes.protectHue': 'Protéger la teinte',
  'brushes.aligned': 'Aligné',
  'brushes.clone.layer': 'Calque actuel',
  'brushes.clone.layerBelow': 'Calque actuel et dessous',
  'brushes.clone.below': 'Calques du dessous',
  'brushes.rotation': 'Rotation',
  'brushes.scale': 'Échelle',
  'brushes.fromCenter': 'Depuis le centre',
  'brushes.antialias': 'Anticrénelage',
  'brushes.refine': 'Affiner…',
  'brushes.lasso.freehand': 'Main levée',
  'brushes.lasso.polygonal': 'Polygonal',
  'brushes.lasso.magnetic': 'Magnétique',
  'brushes.magneticWidth': 'Largeur',
  'brushes.magneticHint': 'Cliquez, suivez le bord ; double-clic ou Entrée pour fermer',
  'brushes.wandHint': 'Glisser après le clic : tolérance',
  'brushes.sizeHardness': '{size} px · dureté {hardness} %',
  'brushes.toleranceValue': 'Tolérance : {n}',
  // Affiner la sélection
  'refine.title': 'Affiner la sélection',
  'refine.adjust': 'Agrandir / réduire',
  'refine.smooth': 'Lisser',
  'refine.feather': 'Adoucir',
  'refine.note': 'L’aperçu s’affiche sur le canevas. Valeurs en pixels du document.',
  'history.selectionRefine': 'Affiner la sélection',
  // Panneau Pinceau : préréglages
  'brush.presets': 'Préréglages',
  'brush.presetName': 'Nom du préréglage',
  'brush.savePreset': 'Enregistrer',
  'brush.deletePreset': 'Supprimer le préréglage',
  'preset.hardRound': 'Rond dur',
  'preset.mediumRound': 'Rond moyen',
  'preset.softRound': 'Rond doux',
  'preset.detail': 'Détail',
  'preset.airbrush': 'Aérographe',
  'preset.wash': 'Lavis large',
};

export const en: Record<string, string> = {
  'tip.brush.how':
    '**Drag** to paint, **Shift**+**Click** for a straight line from the previous point. **Alt**+**Drag** picks the color. **Ctrl**+**Alt**+**Drag**: size and hardness. **[** **]**: size, **Shift**+**[** **]**: hardness. **1** to **0**: opacity, **Shift**+**1** to **0**: flow.',
  'tip.eraser.how':
    '**Drag** to erase, **Shift**+**Click** for a straight line. **Ctrl**+**Alt**+**Drag**: size and hardness. **[** **]**: size, **Shift**+**[** **]**: hardness.',
  'tip.fill.how':
    '**Click** to fill the area of similar color. **Alt**+**Click** picks the color. Blend mode and source (layer or all layers) in the bar.',
  'tip.clone.how':
    '**Click**+**Alt** to pick the source, then **Drag** to paint. **Shift**+**Click**: straight line. Aligned, source, rotation and scale in the bar.',
  'tip.heal.how':
    '**Click**+**Alt** to pick the source, then **Drag** over the flaw. **Shift**+**Click**: straight line.',
  'tip.dodge.how':
    '**Drag** to lighten the shadows, midtones or highlights (tonal range in the bar). **Shift**+**Click**: straight line.',
  'tip.burn.how':
    '**Drag** to darken the shadows, midtones or highlights (tonal range in the bar). **Shift**+**Click**: straight line.',
  'tip.blurBrush.how': '**Drag** to soften. **Shift**+**Click**: straight line.',
  'tip.sharpenBrush.how': '**Drag** to sharpen. **Shift**+**Click**: straight line.',
  'tip.smudge.how': '**Drag** to smear. **Shift**+**Click**: straight line.',
  'tip.marqueeRect.how':
    '**Drag** to select, **+Shift** for a square, **+Alt** while dragging to draw from the center. **Shift** at the start adds, **Alt** subtracts.',
  'tip.marqueeEllipse.how':
    '**Drag** to select, **+Shift** for a circle, **+Alt** while dragging to draw from the center. **Shift** at the start adds, **Alt** subtracts.',
  'tip.lasso.desc': 'Select an area freehand, as a polygon or by following edges (magnetic).',
  'tip.lasso.how':
    'Freehand: **Drag** around the area. Polygonal: **Click** each corner. Magnetic: **Click**, then follow the edge. **Double-click** or **Enter** closes, **Backspace** removes a point. **L**: tool.',
  'tip.magicWand.how':
    '**Click** to select pixels of a similar color, **Drag** right or left to set the tolerance. **Shift** adds, **Alt** subtracts.',
  'hint.brush':
    'paints with the primary color. Shift + click: straight line, Alt: pick the color, Ctrl + Alt + drag: size and hardness.',
  'hint.marqueeRect':
    'drag to select (Alt while dragging: from the center). Shift adds, Alt subtracts, Shift + Alt intersects.',
  'hint.marqueeEllipse':
    'drag to select (Alt while dragging: from the center). Shift adds, Alt subtracts, Shift + Alt intersects.',
  'hint.lasso':
    'freehand, polygonal or magnetic (in the bar). Shift adds, Alt subtracts; double-click or Enter closes.',
  'hint.magicWand': 'click to select pixels of a similar color; drag to set the tolerance.',
  'hint.clone': 'Alt + click to pick the source, then paint to copy it. Shift + click: straight line.',
  'hint.dodge': 'paint to lighten the chosen tonal range.',
  'hint.burn': 'paint to darken the chosen tonal range.',
  'brushes.stabilizer': 'Stabilizer',
  'brushes.rope': 'Rope',
  'brushes.window': 'Window',
  'brushes.ropeLength': 'Length',
  'brushes.windowSize': 'Window',
  'brushes.protectAlpha': 'Protect alpha',
  'brushes.source': 'Source',
  'brushes.source.layer': 'Current layer',
  'brushes.source.all': 'All layers',
  'brushes.tonalRange': 'Tonal range',
  'brushes.tone.shadows': 'Shadows',
  'brushes.tone.midtones': 'Midtones',
  'brushes.tone.highlights': 'Highlights',
  'brushes.protectHue': 'Protect hue',
  'brushes.aligned': 'Aligned',
  'brushes.clone.layer': 'Current layer',
  'brushes.clone.layerBelow': 'Current layer & below',
  'brushes.clone.below': 'Layers beneath',
  'brushes.rotation': 'Rotation',
  'brushes.scale': 'Scale',
  'brushes.fromCenter': 'From center',
  'brushes.antialias': 'Antialias',
  'brushes.refine': 'Refine…',
  'brushes.lasso.freehand': 'Freehand',
  'brushes.lasso.polygonal': 'Polygonal',
  'brushes.lasso.magnetic': 'Magnetic',
  'brushes.magneticWidth': 'Width',
  'brushes.magneticHint': 'Click, follow the edge; double-click or Enter to close',
  'brushes.wandHint': 'Drag after the click: tolerance',
  'brushes.sizeHardness': '{size} px · hardness {hardness} %',
  'brushes.toleranceValue': 'Tolerance: {n}',
  'refine.title': 'Refine selection',
  'refine.adjust': 'Grow / shrink',
  'refine.smooth': 'Smooth',
  'refine.feather': 'Feather',
  'refine.note': 'The preview shows on the canvas. Values in document pixels.',
  'history.selectionRefine': 'Refine selection',
  'brush.presets': 'Presets',
  'brush.presetName': 'Preset name',
  'brush.savePreset': 'Save',
  'brush.deletePreset': 'Delete preset',
  'preset.hardRound': 'Hard round',
  'preset.mediumRound': 'Medium round',
  'preset.softRound': 'Soft round',
  'preset.detail': 'Detail',
  'preset.airbrush': 'Airbrush',
  'preset.wash': 'Large wash',
};
