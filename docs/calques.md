# Gestion des calques

Le panneau **Calques** montre le calque du dessus en premier, comme dans Affinity et Photoshop.

## Changer l'ordre

| Action                            | Raccourci                  | Où                                      |
| --------------------------------- | -------------------------- | --------------------------------------- |
| Premier plan                      | Ctrl+Maj+] (Cmd sur macOS) | Clic droit, Calque › Ordre, Disposition |
| Avancer d'un niveau               | Ctrl+]                     | idem                                    |
| Reculer d'un niveau               | Ctrl+[                     | idem                                    |
| Arrière-plan                      | Ctrl+Maj+[                 | idem                                    |
| Sélectionner le calque au-dessus  | Alt+]                      | Calque › Ordre                          |
| Sélectionner le calque en dessous | Alt+[                      | Calque › Ordre                          |

Avec plusieurs calques sélectionnés, ils bougent ensemble en gardant leur ordre. Tout changement d'ordre
s'annule (Ctrl+Z) et se retrouve tel quel dans le fichier `.poulpe`.

## Glisser-déposer

- Glisser une ligne la place à n'importe quelle position : un trait montre où elle va tomber.
- Lâcher au milieu d'un groupe met les calques dedans (le groupe s'encadre), sur un plan de travail tout en haut de celui-ci.
- Lâcher au milieu d'un autre calque ouvre un petit menu : **Grouper**, fusionner les formes (**Union**, **Soustraction**, **Intersection**, **Exclusion**) ou **Fusionner en une image**.
- Si la ligne glissée fait partie de la sélection, toute la sélection suit (« 3 calques » sous le pointeur).
- Près du bord du panneau, la liste défile toute seule.

## Fusionner, grouper, supprimer

- Clic droit › **Fusionner** : Union, Soustraction, Intersection, Exclusion, Division (les formes et courbes deviennent une seule courbe), ou **Fusionner en une image** (Ctrl+E, aussi dans le menu Calque) qui aplatit formes, textes et photos en une image, à la place du calque le plus haut.
- Sous la liste : **Grouper** (Ctrl+G) et **Supprimer** (aussi la touche Suppr), dans toutes les Personas.
- Clic droit sur un plan de travail : **Ajouter un plan de travail** ou **Supprimer le plan de travail** (il en reste toujours un).

## Sélection dans le panneau

- Clic : un calque. Ctrl+clic (Cmd sur macOS) : ajoute ou retire. Maj+clic : toute la plage.
- Flèches haut/bas : calque précédent/suivant (Maj pour étendre), F2 : renommer, touche Menu : menu contextuel.

## Beaucoup de calques

Au-delà de 150 lignes, le panneau n'affiche que les lignes visibles (liste virtualisée) et chaque ligne
n'est redessinée que si son calque change. Mesure avec 3 000 calques (Chromium, sans GPU) : affichage
du panneau 2,3 s avant, 0,16 s après ; changer la sélection 0,7 s avant, 0,12 s après.

Code : `apps/editor/src/panels/LayersPanel.tsx`, `apps/editor/src/layers.ts`, `moveNodesTo` dans
`packages/core/src/tree.ts`. Tests : `packages/core/test/calques.test.ts`, `apps/editor/e2e/layers.spec.ts`.
