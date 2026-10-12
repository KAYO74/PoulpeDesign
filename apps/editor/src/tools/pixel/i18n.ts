/* Textes de ces outils (français, puis anglais). Ce fichier n'importe rien. */

export const fr: Record<string, string> = {
  'tip.crop.how':
    '**Glisser** les poignées pour recadrer, dedans pour déplacer le cadre, dehors pour en tracer un nouveau, **+Maj** garde les proportions. **Entrée** applique, **Échap** annule.',
  'tip.pixelGradient.how':
    '**Glisser** de la couleur principale vers la secondaire, **+Maj** par pas de 15°. **X** échange les couleurs.',
  'tip.sponge.how': '**Glisser** pour saturer ou désaturer (mode dans la barre contextuelle).',
  'tip.backgroundEraser.how':
    '**Glisser** en gardant le centre du pinceau sur le fond : seule sa couleur est effacée.',
  'tip.floodEraser.how': '**Cliquer** sur une zone de couleur pour l’effacer.',
  'tip.colorReplace.how':
    '**Glisser** sur la couleur à remplacer : elle prend la couleur principale, ombres et lumières gardées.',
  'tip.patch.how':
    '**Glisser** autour du défaut, puis **Glisser** la zone sur une partie propre de l’image. **Échap** efface la zone.',
  'tip.blemish.how':
    '**Cliquer** sur un défaut un peu plus petit que le pinceau. **[ ]** changent sa taille.',
  'tip.redEye.how': '**Cliquer** sur un œil rouge, ou **Glisser** un cadre autour.',

  'select.quickMask': 'Masque rapide',

  'hint.cropTool':
    'glisser les poignées pour recadrer le document, Redresser pour mettre l’horizon d’aplomb. Entrée applique, Échap annule.',
  'hint.pixelGradient':
    'glisser pour peindre un dégradé de la couleur principale à la secondaire. X échange les couleurs.',
  'hint.sponge': 'peindre pour saturer ou désaturer les couleurs.',
  'hint.backgroundEraser': 'peindre en gardant le centre du pinceau sur le fond : seule sa couleur s’efface.',
  'hint.floodEraser': 'clic pour effacer la zone de couleur proche ; la tolérance se règle en haut.',
  'hint.colorReplace': 'peindre sur une couleur pour la remplacer par la couleur principale.',
  'hint.patch': 'entourer le défaut, puis glisser la zone sur une partie propre de l’image.',
  'hint.blemish': 'clic sur un petit défaut pour l’effacer. [ et ] changent la taille.',
  'hint.redEye': 'clic sur un œil rouge, ou glisser un cadre autour.',

  'history.crop': 'Recadrage',
  'history.pixelGradient': 'Dégradé',
  'history.sponge': 'Éponge',
  'history.backgroundEraser': 'Gomme d’arrière-plan',
  'history.floodEraser': 'Gomme de zone',
  'history.colorReplace': 'Remplacement de couleur',
  'history.patch': 'Correctif',
  'history.blemish': 'Retouche des imperfections',
  'history.redEye': 'Yeux rouges',
  'history.quickMask': 'Masque rapide',

  'pixel.swapColors': 'Échanger les couleurs',
  'pixel.secondary': 'Secondaire',
  'pixel.continuous': 'Prélever en continu',

  'pixel.crop.ratio': 'Proportions',
  'pixel.crop.ratio.free': 'Libres',
  'pixel.crop.ratio.original': 'D’origine',
  'pixel.crop.ratio.1:1': '1:1 (carré)',
  'pixel.crop.ratio.4:3': '4:3',
  'pixel.crop.ratio.3:2': '3:2',
  'pixel.crop.ratio.16:9': '16:9',
  'pixel.crop.ratio.custom': 'Personnalisées',
  'pixel.crop.swap': 'Inverser largeur et hauteur',
  'pixel.crop.overlay': 'Repères',
  'pixel.crop.overlay.none': 'Aucun',
  'pixel.crop.overlay.thirds': 'Règle des tiers',
  'pixel.crop.overlay.grid': 'Grille',
  'pixel.crop.overlay.golden': 'Nombre d’or',
  'pixel.crop.straighten': 'Redresser',
  'pixel.crop.straightenHint': 'Tracez une ligne le long de l’horizon pour le mettre d’aplomb.',
  'pixel.crop.angle': 'Rotation',
  'pixel.crop.reset': 'Réinitialiser',

  'pixel.gradient.kind': 'Type',
  'pixel.gradient.linear': 'Linéaire',
  'pixel.gradient.radial': 'Radial',
  'pixel.gradient.elliptical': 'Elliptique',
  'pixel.gradient.conical': 'Conique',
  'pixel.gradient.aspect': 'Ellipse',
  'pixel.gradient.reverse': 'Inverser',
  'pixel.gradient.hint': 'Glisser sur le calque',

  'pixel.sponge.saturate': 'Saturer',
  'pixel.sponge.desaturate': 'Désaturer',

  'pixel.patch.source': 'Source (corriger la zone)',
  'pixel.patch.destination': 'Destination (recopier la zone)',
  'pixel.patch.drawHint': 'Entourez le défaut',
  'pixel.patch.dragHint': 'Glissez la zone sur une partie propre · Échap pour l’effacer',

  'pixel.blemish.hint': 'Cliquez sur le défaut',
  'pixel.blemishEdge': 'Défaut trop près du bord de l’image.',

  'pixel.redEye.darken': 'Assombrir',
  'pixel.redEye.hint': 'Cliquez sur l’œil ou tracez un cadre autour',
  'pixel.noRedEye': 'Pas de rouge à corriger ici.',

  'pixel.quickMask.on': 'Masque rapide',
  'pixel.quickMask.tip': 'Le pinceau et la gomme peignent la sélection : blanc ajoute, noir retire.',
  'pixel.quickMask.exit': 'Quitter (Q)',
};

export const en: Record<string, string> = {
  'tip.crop.how':
    '**Drag** the handles to crop, inside to move the frame, outside to draw a new one, **+Shift** keeps the proportions. **Enter** applies, **Esc** cancels.',
  'tip.pixelGradient.how':
    '**Drag** from the primary color to the secondary one, **+Shift** in 15° steps. **X** swaps the colors.',
  'tip.sponge.how': '**Drag** to saturate or desaturate (mode in the context toolbar).',
  'tip.backgroundEraser.how':
    '**Drag** keeping the brush center on the background: only its color is erased.',
  'tip.floodEraser.how': '**Click** an area of color to erase it.',
  'tip.colorReplace.how':
    '**Drag** over the color to replace: it takes the primary color, keeping its shadows and highlights.',
  'tip.patch.how':
    '**Drag** around the flaw, then **Drag** the area onto a clean part of the image. **Esc** clears it.',
  'tip.blemish.how': '**Click** a flaw slightly smaller than the brush. **[ ]** change its size.',
  'tip.redEye.how': '**Click** a red eye, or **Drag** a frame around it.',

  'select.quickMask': 'Quick mask',

  'hint.cropTool':
    'drag the handles to crop the document, Straighten to level the horizon. Enter applies, Esc cancels.',
  'hint.pixelGradient':
    'drag to paint a gradient from the primary to the secondary color. X swaps the colors.',
  'hint.sponge': 'paint to saturate or desaturate colors.',
  'hint.backgroundEraser': 'paint keeping the brush center on the background: only its color is erased.',
  'hint.floodEraser': 'click to erase the area of similar color; set the tolerance at the top.',
  'hint.colorReplace': 'paint over a color to replace it with the primary color.',
  'hint.patch': 'draw around the flaw, then drag the area onto a clean part of the image.',
  'hint.blemish': 'click a small flaw to remove it. [ and ] change the size.',
  'hint.redEye': 'click a red eye, or drag a frame around it.',

  'history.crop': 'Crop',
  'history.pixelGradient': 'Gradient',
  'history.sponge': 'Sponge',
  'history.backgroundEraser': 'Background eraser',
  'history.floodEraser': 'Flood eraser',
  'history.colorReplace': 'Color replacement',
  'history.patch': 'Patch',
  'history.blemish': 'Blemish removal',
  'history.redEye': 'Red eye removal',
  'history.quickMask': 'Quick mask',

  'pixel.swapColors': 'Swap colors',
  'pixel.secondary': 'Secondary',
  'pixel.continuous': 'Sample continuously',

  'pixel.crop.ratio': 'Proportions',
  'pixel.crop.ratio.free': 'Free',
  'pixel.crop.ratio.original': 'Original',
  'pixel.crop.ratio.1:1': '1:1 (square)',
  'pixel.crop.ratio.4:3': '4:3',
  'pixel.crop.ratio.3:2': '3:2',
  'pixel.crop.ratio.16:9': '16:9',
  'pixel.crop.ratio.custom': 'Custom',
  'pixel.crop.swap': 'Swap width and height',
  'pixel.crop.overlay': 'Overlay',
  'pixel.crop.overlay.none': 'None',
  'pixel.crop.overlay.thirds': 'Rule of thirds',
  'pixel.crop.overlay.grid': 'Grid',
  'pixel.crop.overlay.golden': 'Golden ratio',
  'pixel.crop.straighten': 'Straighten',
  'pixel.crop.straightenHint': 'Draw a line along the horizon to level it.',
  'pixel.crop.angle': 'Rotation',
  'pixel.crop.reset': 'Reset',

  'pixel.gradient.kind': 'Type',
  'pixel.gradient.linear': 'Linear',
  'pixel.gradient.radial': 'Radial',
  'pixel.gradient.elliptical': 'Elliptical',
  'pixel.gradient.conical': 'Conical',
  'pixel.gradient.aspect': 'Ellipse',
  'pixel.gradient.reverse': 'Reverse',
  'pixel.gradient.hint': 'Drag on the layer',

  'pixel.sponge.saturate': 'Saturate',
  'pixel.sponge.desaturate': 'Desaturate',

  'pixel.patch.source': 'Source (fix the area)',
  'pixel.patch.destination': 'Destination (copy the area)',
  'pixel.patch.drawHint': 'Draw around the flaw',
  'pixel.patch.dragHint': 'Drag the area onto a clean part · Esc to clear it',

  'pixel.blemish.hint': 'Click the flaw',
  'pixel.blemishEdge': 'The flaw is too close to the edge of the image.',

  'pixel.redEye.darken': 'Darken',
  'pixel.redEye.hint': 'Click the eye or drag a frame around it',
  'pixel.noRedEye': 'No red to fix here.',

  'pixel.quickMask.on': 'Quick mask',
  'pixel.quickMask.tip': 'The brush and the eraser paint the selection: white adds, black removes.',
  'pixel.quickMask.exit': 'Exit (Q)',
};
