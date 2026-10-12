# Version 1.2

La version 1.2 reprend chaque outil des espaces Vectoriel, Pixel et Mise en page et le met au niveau d'Affinity : mêmes gestes, mêmes raccourcis, mêmes options dans la barre contextuelle, dans l'apparence de Poulpe Design. Les fichiers restent au format 7 : les nouveautés n'ajoutent que des champs facultatifs. Les installations 1.1.5 se mettent à jour toutes seules.

## Version 1.2.1

- **Outil Nœud** : un clic sur un segment droit ajoute le nœud exactement sous la souris (il se posait un peu plus loin sur la ligne).

## Pour tous les espaces

- Une même touche passe d'un outil à l'autre dans une famille (U pour les formes, M pour les rectangles et ellipses de sélection, J pour les outils de retouche…).
- Garder une touche enfoncée prend l'outil le temps du geste ; on revient au précédent en la lâchant.
- Les touches 1 à 0 règlent l'opacité de l'objet sélectionné ou du pinceau.

## Vectoriel

- **Formes** : rectangle arrondi, triangle, flèche, bulle, anneau, camembert, engrenage, nuage, cœur et spirale, avec leurs poignées rouges sur la toile (arrondi, nombre de côtés…) et un arrondi différent par coin, modifiable à tout moment (arrondi, concave, coupé).
- **Déplacer** : Ctrl pour agrandir depuis le centre, Alt-clic pour prendre l'objet du dessous, double-clic sur une courbe pour l'outil Nœud, sélection automatique, point d'origine, aligner et grouper dans la barre, duplication qui répète le dernier déplacement. Poignées pour redimensionner le plan de travail sur la toile.
- **Plume** en modes Intelligent, Polygone et Ligne, avec l'aperçu du segment suivant et la reprise d'un tracé ouvert. **Crayon** avec lissage, pression et fermeture automatique. **Couteau** à main levée.
- **Pinceau vectoriel** [B], **remplissage d'une zone fermée** [R], **constructeur de formes** qui ajoute ou retire les zones qui se chevauchent, **recadrage vectoriel** et **pipette de style**.
- **Remplissage** [G] : dégradés radial, elliptique, conique et image, avec des points modifiables sur la toile. **Transparence** [Y] séparée de la couleur. **Contour** [O] et **largeur de trait** [W] modifiables après coup.
- **Texte** : glisser pour choisir la taille, clic sur une courbe pour écrire le long du tracé, cadre de texte séparé du texte simple, barre avec gras, italique, souligné, alignements, interligne, listes et styles.

## Pixel

- **Recadrage** [C] avec redressement, proportions et grilles, **dégradé** [G], **masque rapide** [Q].
- **Éponge**, **gomme d'arrière-plan**, **gomme de zone**, **remplacement de couleur** [R], **correctif**, **retouche des imperfections** et **yeux rouges** [J].
- **Pinceaux** : Maj-clic pour une ligne droite, Alt-glisser pour la pipette, flux, dureté et taille réglés au clavier ou en glissant sur la toile, lissage, mode de fusion, protection de la transparence, panneau Pinceaux.
- **Sélections** : depuis le centre, bords lissés, Affiner ; un seul lasso [L] à main levée, polygonal ou magnétique ; tolérance réglée en glissant. Densité − et + sur les ombres, les tons moyens ou les hautes lumières.

## Mise en page

- L'espace Mise en page a ses propres outils, comme Publisher : cadre de texte, texte simple et tableau sur la touche T, cadres d'image rectangle et ellipse sur la touche F.
- **Texte** : barre complète (justifié, alignement vertical, colonnes, Ctrl+B, I et U), habillage autour des images et des formes, écoulement automatique qui ajoute pages et cadres jusqu'à ce que tout le texte tienne, cadre de texte qui prend la forme d'une forme cliquée, marges intérieures.
- **Images** : l'ajustement (remplir, contenir, étirer, aucun) reste quand on redimensionne le cadre, bouton Remplacer l'image, zoom et déplacement de l'image dans son cadre ; clic pour la taille réelle, glisser pour la taille choisie, plusieurs images d'un coup.
- **Pages** : sélection de plusieurs pages, fenêtres Ajouter des pages et Appliquer un gabarit, modification d'un élément du gabarit sur une page, détacher le gabarit.

## Organisation du code

Chaque famille d'outils vit dans son dossier, `apps/editor/src/tools/<famille>/` (formes, déplacer, tracés, peinture, texte, cadres, pixel, pinceaux, écoulement du texte). Un dossier exporte un `ToolModule` (`tools/types.ts`) : ses gestes sur la toile, sa barre contextuelle et ses traductions. `tools/registry.ts` les réunit, et le contrôleur du canevas les consulte avant les outils de base. La géométrie partagée est dans `packages/core` (`shapes.ts`, `frames.ts`, `tables.ts`, `pixelTools.ts`, `textWrap.ts`, `autoFlow.ts`…), testée à part ; chaque famille a ses tests de bout en bout (`apps/editor/e2e/v12-*.spec.ts`).
