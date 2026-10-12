/* Textes de ces outils (français, puis anglais). Ce fichier n'importe rien. */

export const fr: Record<string, string> = {
  'tip.gradient.desc':
    'Posez et modifiez un dégradé (linéaire, radial, elliptique, conique) ou un motif sur le remplissage ou le contour.',
  'tip.gradient.how':
    '**Glisser** sur l’objet pour tracer le dégradé, **+Maj** par pas de 45°. **Glisser** les poignées et les arrêts. **Cliquer** sur la ligne pour ajouter un arrêt ; **Suppr** ou tirer un arrêt hors de la ligne pour le retirer.',
  'tip.transparency.desc':
    'Faites disparaître progressivement tout l’objet (remplissage, contour, effets) sans toucher à ses couleurs.',
  'tip.transparency.how':
    '**Glisser** sur l’objet : du côté opaque vers le côté transparent, **+Maj** par pas de 45°. Poignées et arrêts se modifient comme avec l’outil Remplissage.',
  'tip.contour.desc': 'Agrandissez ou rétrécissez une forme en décalant son tracé, modifiable ensuite.',
  'tip.contour.how':
    '**Glisser** vers la droite pour agrandir, vers la gauche pour rétrécir. **+Alt** garde l’original et pose le contour sur une copie.',
  'tip.strokeWidth.desc': 'Faites varier l’épaisseur du trait où vous voulez le long du tracé.',
  'tip.strokeWidth.how':
    '**Glisser** depuis un point du trait pour y poser un point de largeur. **Glisser** un point le long du trait pour le déplacer, ou le bout de sa barre pour changer sa largeur. **Suppr** retire le point choisi.',

  'hint.gradient':
    'glisser sur l’objet pour tracer le dégradé ; glisser ses poignées et ses arrêts, clic sur la ligne pour ajouter un arrêt.',
  'hint.transparency':
    'glisser de la partie opaque vers la partie transparente ; poignées et arrêts se modifient ensuite.',
  'hint.contour':
    'glisser vers la droite pour agrandir la forme, vers la gauche pour la rétrécir. Alt garde l’original.',
  'hint.strokeWidth':
    'glisser depuis le trait pour poser un point de largeur ; glisser un point pour le déplacer, Suppr pour le retirer.',

  'paint.type': 'Type',
  'paint.kind.none': 'Aucun',
  'paint.kind.solid': 'Uni',
  'paint.kind.linear': 'Linéaire',
  'paint.kind.radial': 'Radial',
  'paint.kind.elliptical': 'Elliptique',
  'paint.kind.conic': 'Conique',
  'paint.kind.bitmap': 'Motif',
  'paint.context': 'Appliquer à',
  'paint.stopColor': 'Couleur de l’arrêt',
  'paint.stopOpacity': 'Opacité',
  'paint.stopPosition': 'Position',
  'paint.rotate': 'Pivoter de 90°',
  'paint.reverse': 'Inverser',
  'paint.remove': 'Retirer',
  'paint.fillHint': 'Glissez pour tracer · Clic sur la ligne : nouvel arrêt',
  'paint.transHint': 'Glissez de l’opaque vers le transparent',
  'paint.contourRadius': 'Rayon',
  'paint.contourJoin': 'Jonction',
  'paint.join.miter': 'Angle vif',
  'paint.join.round': 'Arrondie',
  'paint.join.bevel': 'Biseautée',
  'paint.miterLimit': 'Limite d’angle',
  'paint.contourHint': 'Glissez : à droite pour agrandir, à gauche pour rétrécir',
  'paint.widthPoint': 'Largeur du point',
  'paint.widthReset': 'Largeur constante',
  'paint.widthHint': 'Glissez depuis le trait pour poser un point de largeur',
  'history.gradient': 'Dégradé',
  'history.gradientStop': 'Arrêt de dégradé',
  'history.transparency': 'Transparence',
  'history.contour': 'Contour',
  'history.strokeWidth': 'Largeur de trait',
};

export const en: Record<string, string> = {
  'tip.gradient.desc':
    'Apply and edit a gradient (linear, radial, elliptical, conical) or a bitmap on the fill or the stroke.',
  'tip.gradient.how':
    '**Drag** on the object to draw the gradient, **+Shift** in 45° steps. **Drag** the handles and the stops. **Click** the line to add a stop; **Delete** or drag a stop off the line to remove it.',
  'tip.transparency.desc': 'Fade the whole object out (fill, stroke, effects) without changing its colors.',
  'tip.transparency.how':
    '**Drag** on the object from the opaque side to the transparent side, **+Shift** in 45° steps. Edit handles and stops as with the Fill tool.',
  'tip.contour.desc': 'Grow or shrink a shape by offsetting its path, editable afterwards.',
  'tip.contour.how':
    '**Drag** right to grow, left to shrink. **+Alt** keeps the original and puts the contour on a copy.',
  'tip.strokeWidth.desc': 'Vary the stroke width anywhere along the path.',
  'tip.strokeWidth.how':
    '**Drag** from a point of the stroke to add a width point there. **Drag** a point along the stroke to move it, or the end of its bar to change its width. **Delete** removes the selected point.',

  'hint.gradient':
    'drag on the object to draw the gradient; drag its handles and stops, click the line to add a stop.',
  'hint.transparency': 'drag from the opaque part to the transparent part; handles and stops stay editable.',
  'hint.contour': 'drag right to grow the shape, left to shrink it. Alt keeps the original.',
  'hint.strokeWidth':
    'drag from the stroke to add a width point; drag a point to move it, Delete removes it.',

  'paint.type': 'Type',
  'paint.kind.none': 'None',
  'paint.kind.solid': 'Solid',
  'paint.kind.linear': 'Linear',
  'paint.kind.radial': 'Radial',
  'paint.kind.elliptical': 'Elliptical',
  'paint.kind.conic': 'Conical',
  'paint.kind.bitmap': 'Bitmap',
  'paint.context': 'Apply to',
  'paint.stopColor': 'Stop color',
  'paint.stopOpacity': 'Opacity',
  'paint.stopPosition': 'Position',
  'paint.rotate': 'Rotate 90°',
  'paint.reverse': 'Reverse',
  'paint.remove': 'Remove',
  'paint.fillHint': 'Drag to draw · Click the line: new stop',
  'paint.transHint': 'Drag from opaque to transparent',
  'paint.contourRadius': 'Radius',
  'paint.contourJoin': 'Join',
  'paint.join.miter': 'Miter',
  'paint.join.round': 'Round',
  'paint.join.bevel': 'Bevel',
  'paint.miterLimit': 'Miter limit',
  'paint.contourHint': 'Drag right to grow, left to shrink',
  'paint.widthPoint': 'Point width',
  'paint.widthReset': 'Constant width',
  'paint.widthHint': 'Drag from the stroke to add a width point',
  'history.gradient': 'Gradient',
  'history.gradientStop': 'Gradient stop',
  'history.transparency': 'Transparency',
  'history.contour': 'Contour',
  'history.strokeWidth': 'Stroke width',
};
