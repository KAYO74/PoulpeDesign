# Poulpe Design — Feuille de route des fonctionnalités

4 octobre 2026

Poulpe Design atteint l'essentiel d'Illustrator, Photoshop et Affinity en v1.0, en cinq jalons qui ajoutent chacun un métier : dessin de base, création rapide type Canva, vectoriel pro, retouche photo, mise en page et export pro.

## Objectif et principes

- **Un seul document, trois métiers.** Comme Affinity, on passe du vectoriel (Illustrator / Designer) au pixel (Photoshop / Photo) et à la mise en page (Publisher) sans changer de fichier ni d'appli.
- **Non destructif partout.** Calques de réglage, filtres dynamiques, masques et effets restent modifiables jusqu'à l'export.
- **Simple d'abord, puissant ensuite.** Les fonctions avancées vivent dans des panneaux qu'on ouvre au besoin, pour garder l'interface épurée de la maquette.
- **Application de bureau installable, dès la v0.1.** Poulpe Design s'installe sur Windows, macOS et Linux via Tauri, qui embarque le même code web. La version navigateur reste disponible sans installation. Tout tourne en local, sans serveur (CanvasKit / WebGL 2, filtres en shaders).
- **Cohérent avec le cadrage.** On garde ses jalons v0.1 (moteur), v0.2 (Canva) et v1.0. L'étape « v0.3 Affinity » du cadrage est découpée ici en trois : v0.3 vectoriel pro, v0.4 retouche photo, v0.5 mise en page et export pro.

## Correspondance des fonctionnalités

Les fonctions phares des trois logiciels, et le jalon où Poulpe Design les apporte. « AI » = Illustrator, « PS » = Photoshop, « AF » = Affinity (Designer, Photo, Publisher).

| Fonctionnalité                                               | Chez qui     | Poulpe Design                        |
| ------------------------------------------------------------ | ------------ | ------------------------------------ |
| Formes, rectangles arrondis, polygones, étoiles              | AI, AF       | v0.1                                 |
| Calques, groupes, verrouillage, visibilité                   | AI, PS, AF   | v0.1                                 |
| Texte artistique et texte en bloc, polices Google Fonts      | AI, PS, AF   | v0.1                                 |
| Remplissage, contour, dégradés linéaires et radiaux          | AI, PS, AF   | v0.1                                 |
| Plans de travail multiples (artboards)                       | AI, PS, AF   | v0.1                                 |
| Annuler / rétablir illimité, historique                      | AI, PS, AF   | v0.1                                 |
| Export PNG, JPEG, SVG, PDF                                   | AI, PS, AF   | v0.1                                 |
| Modèles, bibliothèque d'éléments, formats réseaux sociaux    | (Canva)      | v0.2                                 |
| Plume, nœuds, courbes de Bézier, crayon                      | AI, AF       | v0.3                                 |
| Opérations booléennes, Pathfinder, Shape Builder             | AI, AF       | v0.3                                 |
| Symboles, styles de calque, styles de texte et de paragraphe | AI, AF       | v0.3                                 |
| Texte sur tracé, OpenType avancé, vectorisation du texte     | AI, AF       | v0.3                                 |
| Dégradés de forme (mesh), dégradés coniques, motifs          | AI, AF       | v0.3                                 |
| Pinceaux pixel, gomme, tampon, correcteur                    | PS, AF       | v0.4                                 |
| Sélections (lasso, baguette magique, sélection rapide)       | PS, AF       | v0.4                                 |
| Masques de calque et masques d'écrêtage                      | PS, AF       | v0.1 (simples), v0.4 (pixel)         |
| Calques de réglage (niveaux, courbes, TSL, balance)          | PS, AF       | v0.4                                 |
| Filtres dynamiques (flou, netteté, bruit, déformation)       | PS, AF       | v0.4                                 |
| Modes de fusion et effets (ombre, lueur, biseau)             | PS, AF       | v0.1 (fusion), v0.3 (effets)         |
| Recadrage, redressement, transformation perspective          | PS, AF       | v0.4                                 |
| Gestion couleur RVB / CMJN, profils ICC, nuanciers           | AI, PS, AF   | v0.5                                 |
| Pages maîtres, cadres de texte liés, styles de mise en page  | AF Publisher | v0.5                                 |
| Export PDF/X d'impression, fonds perdus, traits de coupe     | AI, AF       | v0.5                                 |
| Ouverture PSD, SVG, PDF et AI (compatibilité PDF)            | AI, PS, AF   | v0.3 (SVG), v0.5 (PSD, PDF, AI)      |
| Vectorisation d'image (Image Trace)                          | AI           | v1.0                                 |
| Détourage auto et remplissage selon le contenu               | PS           | v0.4 (remplissage), v1.0 (détourage) |

## Jalons détaillés

> Schéma interactif « feuille de route » (6 jalons) : voir la [version en ligne](https://claude.ai/code/artifact/2c715d1a-2474-4a2e-9d8a-fdf7bd81d031).

Chaque jalon s'appuie sur le précédent : le vectoriel pro, la photo et la mise en page partagent le moteur de la v0.1.

### v0.1 Moteur d'édition de base

- **Outils :** sélection, sélection directe, rectangle, ellipse, polygone, étoile, ligne, texte, image, main, zoom, pipette.
- **Objets :** déplacer, redimensionner, pivoter, aligner, distribuer, magnétisme, règles et repères, grille.
- **Calques :** groupes, ordre, verrouillage, visibilité, opacité, 12 modes de fusion, masques d'écrêtage simples.
- **Couleur :** sélecteur TSL / RVB / hexadécimal, opacité, couleurs récentes, nuancier du document, dégradés linéaires et radiaux avec éditeur d'arrêts.
- **Texte :** police, graisse, taille, interlettrage, interligne, alignement, couleur, majuscules, souligné et barré.
- **Document :** plans de travail multiples, annuler illimité, enregistrement `.poulpe` local, export PNG, JPEG, SVG, PDF.
- **Bureau :** installateurs Windows (.msi), macOS (.dmg) et Linux (AppImage, .deb), ouverture des fichiers `.poulpe` par double-clic, menus natifs, glisser-déposer depuis le système, accès aux polices installées.

### v0.2 Côté Canva

Livrée le 5 octobre 2026, voir [cote-canva-v0.2.md](cote-canva-v0.2.md).

- Modèles par format (Instagram, story, A4, affiche, carte de visite, miniature YouTube).
- Bibliothèque d'éléments libres (formes, icônes, illustrations). Les photos CC0 intégrées sont reportées : on importe ses propres photos dans des cadres.
- Combinaisons de polices prêtes, palettes de couleurs suggérées, redimensionnement d'un design vers un autre format.

### v0.3 Vectoriel pro (Illustrator, Affinity Designer)

Première partie livrée le 5 octobre 2026, voir [vectoriel-pro-v0.3.md](vectoriel-pro-v0.3.md) : plume, crayon, outil Nœud, les cinq opérations booléennes, décalage de tracé, conversion en courbes (textes compris), pointillés, extrémités, jonctions et flèches, cinq effets (ombre portée, ombre interne, lueur externe, lueur interne, flou), texte sur tracé et import SVG. Le reste de la liste ci-dessous (symboles, styles, mesh, coniques, motifs, épaisseur variable, contours multiples, OpenType, colonnes, Shape Builder, ciseaux, couteau, biseau) suivra dans une v0.3.x. Le passage du rendu à CanvasKit est reporté : le rendu Canvas 2D actuel suffit pour tout ce qui précède, et les opérations booléennes passent par Paper.js.

- **Tracés :** plume, nœuds, poignées, crayon, lissage, ciseaux, couteau, outil coin (arrondir un angle).
- **Géométrie :** union, soustraction, intersection, exclusion, division, Shape Builder, décalage de tracé.
- **Contours avancés :** pointillés, extrémités, flèches, épaisseur variable, contours multiples par objet.
- **Couleur avancée :** dégradés coniques et de forme (mesh), motifs, couleurs globales liées, harmonies de couleurs.
- **Texte avancé :** texte sur tracé, colonnes, habillage autour des formes, OpenType (ligatures, chiffres, petites capitales), styles de caractère et de paragraphe, vectorisation du texte.
- **Réutilisation :** symboles, styles de calque, effets (ombre portée, ombre interne, lueur, biseau, contour), import SVG.

### v0.4 Retouche photo (Photoshop, Affinity Photo)

Livrée le 5 octobre 2026, voir [retouche-photo-v0.4.md](retouche-photo-v0.4.md) : Persona Photo, sélections (rectangle, ellipse, lasso, baguette magique, contour progressif, dilater, contracter), pinceau avec pression, gomme, pot de peinture, tampon, densité, flou et netteté au pinceau, **gomme magique** et remplissage d'après le contenu (hors ligne, sans IA), masques de calque pixel, 14 calques de réglage, 6 filtres dynamiques, niveaux automatiques et histogramme. Reportés : sélection rapide, lasso polygonal, correcteur, doigt, liquéfier et déformations, LUT, redressement, perspective, taille de l'image et de la zone de travail.

- **Calques pixel :** pinceaux avec pression du stylet, gomme, pot de peinture, tampon, correcteur, doigt, densité.
- **Sélections :** rectangle, ellipse, lasso, lasso polygonal, baguette magique, sélection rapide, affiner les bords.
- **Non destructif :** masques de calque pixel, calques de réglage (niveaux, courbes, teinte et saturation, balance des couleurs, noir et blanc, exposition, vibrance, LUT), filtres dynamiques (flous, netteté, bruit, déformations, liquéfier).
- **Image :** recadrage, redressement, perspective, taille de l'image et de la zone de travail, histogramme.

### v0.5 Mise en page et export pro (Affinity Publisher, impression)

Faite en octobre 2026, en deux parties. Première partie, voir [mise-en-page-v0.5.md](mise-en-page-v0.5.md) : Persona Mise en page et panneau Pages, documents multipages en colonne ou en vis-à-vis, pages maîtres, numéros de page, cadres de texte liés, marges, fond perdu, résolution du document, et PDF d'impression à la taille réelle avec traits de coupe. Deuxième partie, voir [impression-v0.5.md](impression-v0.5.md) : couleurs CMJN avec profil ICC, épreuvage à l'écran, PDF/X-4, ouverture des fichiers PSD, PDF et AI, export PSD et export par lots. Les niveaux de gris et les tons directs viendront avec les nuanciers.

- Documents multipages, pages maîtres, cadres de texte liés, numérotation.
- Gestion couleur RVB, CMJN et niveaux de gris avec profils ICC, épreuvage à l'écran.
- Export PDF/X avec fonds perdus et traits de coupe, export par tranches et par lots.
- Ouverture des fichiers PSD (calques) et PDF / AI, export PSD.

### v1.0 Version stable

Livrée le 5 octobre 2026, voir [version-1.0.md](version-1.0.md) : vectorisation d'image, détourage automatique (sélection du sujet, suppression de l'arrière-plan), macros, raccourcis personnalisables, extensions, mises à jour automatiques. La signature des installeurs et Flathub sont prêts et attendent les comptes nécessaires (voir [signature-et-mises-a-jour.md](signature-et-mises-a-jour.md)). L'accessibilité vérifiée, la documentation anglaise complète et les performances sur très gros fichiers suivront en v1.x.

- Vectorisation d'image, détourage automatique et remplissage selon le contenu, calculés dans le navigateur.
- Actions et macros enregistrables, raccourcis personnalisables, extensions.
- Appli de bureau signée (Windows, macOS) avec mises à jour automatiques, publiée sur Flathub pour Linux.
- Performances sur gros fichiers, accessibilité WCAG 2.2 AA vérifiée, documentation FR / EN.

### v1.3 Prochaine version (demandée le 13 octobre 2026)

Tout sans régression ni bug : chaque point est vérifié par les tests avant d'être publié.

- **Documentation en anglais :** toute la documentation du dépôt traduite.
- **Panneaux :** déplacer plus facilement les fenêtres Calques, Pinceau, Historique et les autres.
- **Couleurs :** sélecteur RVB avec une roue, qui s'ouvre quand on choisit une couleur dans la barre d'outils ou dans le menu du haut ; le choix « aucune couleur » partout où l'on choisit une couleur, comme dans Affinity.
- **Pinceaux :** créer ses pinceaux et les partager, aussi sous forme d'extensions de l'appli ; une fenêtre de création de pinceau qui reste ouverte pendant qu'on essaie le pinceau sur le document, et qu'on peut fermer.
- **Interface :** régler la taille de l'interface dans les Préférences.

Pas prioritaire pour le moment : la signature des installeurs Mac (et Windows), Flathub.

## Hors périmètre et risques

- **Pas de 3D, de vidéo ni d'animation** avant la v1.0 : ce sont d'autres logiciels (After Effects, Blender).
- **Fichiers AI et PSD :** le format AI récent n'est lisible que via sa partie PDF, et les PSD complexes (objets dynamiques, effets propriétaires) seront ouverts en approximation.
- **Performance pixel :** les grosses images (plus de 50 mégapixels) et les pinceaux rapides poussent WebGL 2 et la mémoire du navigateur. On teste ce point dès la v0.4, avec WebGPU en option si nécessaire.
- **CMJN** : ni le navigateur ni Tauri n'en offrent de gestion native, il faut embarquer un moteur de couleur (lcms compilé en WASM).
- **Fonctions « intelligentes » :** le détourage et le remplissage automatiques exigent des modèles locaux lourds, d'où leur report en v1.0.
