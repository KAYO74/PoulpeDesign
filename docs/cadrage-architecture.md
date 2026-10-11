# Poulpe Design : cadrage et architecture

4 octobre 2026

## Vision et principes

Le Poulpe Design (nom provisoire) est une application web libre qui réunit la création graphique d'Affinity (vectoriel, photo, mise en page) et la simplicité de Canva (modèles, glisser-déposer), installée gratuitement sur Windows, macOS et Linux, et aussi utilisable dans le navigateur.

- **Zéro barrière** : une appli de bureau gratuite à installer, ou la même appli directement dans le navigateur pour ceux qui ne peuvent pas installer de logiciel. Pas de compte obligatoire, pas de fonction payante.
- **Local d'abord** : les fichiers restent sur l'appareil de l'utilisateur. L'appli de bureau fonctionne entièrement hors ligne. Aucun serveur n'est nécessaire pour éditer.
- **Deux niveaux d'usage** : un mode simple façon Canva (modèles, panneaux réduits) et un mode avancé façon Affinity (plume, calques détaillés, réglages photo), sur le même moteur et le même fichier.
- **Format ouvert** : le fichier natif est documenté et lisible par tous, et l'export SVG, PDF et PNG garantit qu'on n'est jamais enfermé.
- **Accessible** : interface conforme WCAG 2.2 AA, navigable au clavier, en français ou en anglais au choix de l'utilisateur, fluide sur un ordinateur modeste.
- **Interface façon Affinity** : thème sombre par défaut, outils en colonne à droite par défaut (côté modifiable), barre contextuelle en haut qui change avec l'outil actif, panneaux ancrables et déplaçables (calques, propriétés, couleurs, éléments), disposition entièrement personnalisable et enregistrable, et des espaces de travail Dessin, Photo et Mise en page qu'on bascule d'un clic comme les « Personas » d'Affinity. Thème clair disponible.

## Périmètre du MVP

La première version publique (v0.1) doit permettre de créer une affiche ou un visuel réseau social de A à Z, puis de l'exporter.

| Domaine      | Dans la v0.1                                                                                                                                         | Plus tard                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Distribution | Appli de bureau installée (Windows, macOS, Linux) et même appli dans le navigateur                                                                   | Mises à jour automatiques, boutiques d'applications, paquets Flatpak  |
| Interface    | Disposition façon Affinity : outils à droite par défaut (côté modifiable), barre contextuelle, panneaux ancrables, thème sombre, français ou anglais | Espaces de travail Photo et Mise en page, raccourcis personnalisables |
| Document     | Plusieurs pages ou plans de travail, formats prédéfinis (A4, Instagram, YouTube…)                                                                    | Grilles de mise en page, styles partagés                              |
| Formes       | Rectangle, ellipse, polygone, ligne, remplissage, contour, dégradé linéaire                                                                          | Outil plume complet, opérations booléennes, dégradés avancés          |
| Texte        | Bloc de texte, polices libres et polices installées sur l'ordinateur, gras, italique, alignement, interlignage                                       | Texte sur tracé, styles de paragraphe, OpenType avancé                |
| Images       | Import, recadrage, opacité, masque simple                                                                                                            | Retouche photo : niveaux, courbes, filtres, pinceaux                  |
| Calques      | Liste, groupes, ordre, verrouillage, visibilité                                                                                                      | Modes de fusion avancés, calques de réglage                           |
| Édition      | Sélection, déplacement, redimensionnement, rotation, alignement, magnétisme, annuler et rétablir                                                     | Édition de nœuds, symboles, contraintes                               |
| Fichiers     | Format natif ouvert, double-clic sur un `.poulpe` pour l'ouvrir, export PNG, JPG, SVG                                                                | Export PDF, import SVG et PSD                                         |
| Partage      | Fichier enregistré sur l'ordinateur                                                                                                                  | Collaboration en temps réel, liens de partage                         |

Hors périmètre assumé : impression professionnelle CMJN complète, développement RAW, IA générative et lecture des formats propriétaires d'Affinity ou de Canva, qui ne sont pas documentés.

## Stack technique

Tout est en TypeScript, le rendu passe par Skia compilé en WebAssembly (CanvasKit) sur WebGL, et le même code web est empaqueté en appli de bureau avec Tauri ou servi comme site statique, sans serveur dans les deux cas.

| Couche                    | Choix                                                                                                                                                         | Pourquoi                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Langage                   | TypeScript strict                                                                                                                                             | Le langage web le plus connu des contributeurs, typage sûr pour un moteur complexe                                                                                                                                           |
| Appli de bureau           | [Tauri 2](https://v2.tauri.app/) (licences MIT et Apache-2.0) pour Windows, macOS et Linux                                                                    | Installeurs légers car Tauri utilise le moteur web du système au lieu d'embarquer Chromium ; accès natif aux fichiers, aux polices installées et aux menus ; une petite couche en Rust pour les traitements lourds si besoin |
| Rendu du canevas          | [CanvasKit](https://skia.org/docs/user/modules/canvaskit/) (Skia en WebAssembly, licence BSD-3) sur WebGL 2                                                   | Le moteur de Chrome et d'Android : tracés vectoriels précis, opérations booléennes, mise en page de texte avec HarfBuzz, rendu GPU rapide                                                                                    |
| Filtres photo             | Shaders WebGL 2, calculs lourds dans des Web Workers                                                                                                          | L'interface reste fluide pendant les traitements ; passage à WebGPU quand il sera généralisé                                                                                                                                 |
| Interface                 | React, Vite, primitives accessibles [Radix UI](https://www.radix-ui.com/), panneaux ancrables, jetons de design en variables CSS                              | Composants accessibles au clavier et aux lecteurs d'écran, disposition façon Affinity, thèmes sombre et clair simples                                                                                                        |
| État de l'appli           | Modèle de document en TypeScript pur, hors React                                                                                                              | Le moteur se teste sans navigateur et pourra servir ailleurs (ligne de commande, serveur d'export)                                                                                                                           |
| Stockage                  | Bureau : fichiers natifs via Tauri, double-clic sur un `.poulpe`. Navigateur : File System Access, téléchargement en repli, brouillons dans IndexedDB et OPFS | Local d'abord, hors ligne, aucun coût d'hébergement                                                                                                                                                                          |
| Collaboration (plus tard) | [Yjs](https://yjs.dev/) (CRDT, licence MIT)                                                                                                                   | Fusion des modifications sans serveur central obligatoire                                                                                                                                                                    |
| Export                    | PNG, JPG, WebP par le canevas ; SVG par notre propre sérialiseur ; PDF avec [pdf-lib](https://pdf-lib.js.org/)                                                | Vectoriel préservé en SVG et PDF                                                                                                                                                                                             |
| Polices                   | Polices libres (licence OFL) fournies, plus les polices installées sur l'ordinateur                                                                           | Pas de dépendance à un service tiers                                                                                                                                                                                         |
| Outillage                 | Monorepo pnpm, Vitest, Playwright avec tests visuels de rendu, ESLint, Prettier, GitHub Actions qui produit les installeurs des trois systèmes                | Un seul dépôt, chaque modification vérifiée et empaquetée automatiquement                                                                                                                                                    |
| Distribution              | Installeurs sur les GitHub Releases de KAYO74/PoulpeDesign, version navigateur sur GitHub Pages ou Cloudflare Pages                                           | Gratuit à distribuer, donc gratuit pour toujours                                                                                                                                                                             |

Alternative écartée pour le rendu : Canvas 2D seul, trop lent au-delà de quelques milliers d'objets et sans opérations booléennes. Un moteur WebGL écrit de zéro reste possible plus tard derrière la même interface de rendu. Pour le bureau, Electron est l'alternative : il embarque Chromium, donc un rendu identique partout, mais des installeurs bien plus lourds. Risque à surveiller avec Tauri : le moteur web de Linux (WebKitGTK) est moins performant en WebGL ; on le mesure dès la v0.1 et on bascule sur Electron si l'écart est trop grand, sans toucher au reste du code.

## Architecture du moteur

Le code est découpé en paquets indépendants autour d'un modèle de document unique : l'interface ne modifie jamais le dessin directement, elle passe par des commandes.

> Schéma interactif « architecture du moteur » (4 couches, 3 modules) : voir la [version en ligne](https://claude.ai/code/artifact/90f3d5ab-7d39-4c67-82cb-f23c92eeb1f1).

Un geste devient une commande, la commande modifie le modèle, et le rendu ne redessine que les objets touchés avant d'afficher le résultat dans le canevas de l'interface. Ce découpage rend l'annulation fiable, permet de tester le moteur sans navigateur et prépare la collaboration et un futur système d'extensions isolées.

## Format de fichier ouvert

Le fichier natif est une archive ZIP contenant un document JSON versionné et ses ressources, sur le modèle d'OpenDocument et d'OpenRaster. Son extension est `.poulpe`.

```
affiche.poulpe (ZIP)
├── manifest.json      version du format, appli d'origine, liste des fichiers
├── document.json      pages, calques, objets, styles (schéma publié)
├── assets/
│   ├── images/        images d'origine, jamais recompressées
│   └── fonts/         polices embarquées si leur licence le permet
└── thumbnail.png      aperçu pour les explorateurs de fichiers
```

- **Lisible par tous** : le schéma de `document.json` est publié en JSON Schema avec une spécification rédigée, sous licence CC-BY 4.0, pour que d'autres logiciels puissent le lire et l'écrire.
- **Versionné** : chaque fichier porte sa version de format ; l'appli migre automatiquement les anciens fichiers et refuse proprement un fichier plus récent qu'elle.
- **Robuste** : les objets sont identifiés par des identifiants stables, ce qui prépare la collaboration et les comparaisons de versions.
- **Interopérable** : l'export SVG et PDF reste la voie d'échange avec Inkscape, Illustrator ou Affinity. Le SVG n'est pas retenu comme format natif car il ne gère ni les pages multiples, ni les réglages photo non destructifs, ni les modèles.

## Licence et gouvernance

Le code est publié sous licence MPL-2.0, celle de Penpot : toute modification d'un fichier du projet doit rester ouverte, sans empêcher d'intégrer l'appli dans d'autres outils.

| Option                | Ce qu'elle garantit                                                                 | Limite                                                           |
| --------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **MPL-2.0 (retenue)** | Les fichiers modifiés restent libres ; compatible avec la plupart des bibliothèques | Une entreprise peut ajouter des fichiers fermés autour           |
| AGPL-3.0              | Toute version hébergée en ligne doit publier son code complet                       | Freine les contributions d'entreprises et certaines intégrations |
| MIT                   | Adoption maximale, aucune contrainte                                                | Rien n'empêche une version fermée et payante                     |

- **Contenus** : modèles, icônes et illustrations fournis sous CC0 ou CC-BY 4.0, polices sous OFL, pour que tout ce qui est créé avec l'appli soit utilisable librement, y compris commercialement.
- **Contributions** : signature DCO (une ligne dans chaque commit) plutôt qu'un accord de cession, pour que le code reste à la communauté.
- **Communauté** : code de conduite Contributor Covenant, guide de contribution, tickets étiquetés « première contribution », discussions publiques sur GitHub.
- **Décisions** : le créateur du projet tranche au départ ; une fois des contributeurs réguliers arrivés, les choix structurants passent par des propositions écrites (RFC) dans le dépôt.

## Feuille de route

La v0.1 vise un premier usage complet et simple, puis on élargit vers Canva avant de creuser les outils experts d'Affinity.

> Schéma interactif « feuille de route » (6 phases, 5 portes) : voir la [version en ligne](https://claude.ai/code/artifact/90f3d5ab-7d39-4c67-82cb-f23c92eeb1f1).

Chaque phase ne démarre qu'une fois la porte précédente franchie. Les phases ne sont pas datées : le rythme dépendra du nombre de contributeurs, et une version est publiée dès que sa porte est atteinte.

## Décisions prises

Les quatre choix structurants sont tranchés le 4 octobre 2026 ; le reste du document s'applique sauf objection.

- [x] **Nom du projet** : Poulpe Design pour le moment, extension de fichier `.poulpe`.
- [x] **Dépôt GitHub** : [KAYO74/PoulpeDesign](https://github.com/KAYO74/PoulpeDesign), privé, relié au projet.
- [x] **Licence du code** : MPL-2.0.
- [x] **Langues de l'interface** : français et anglais, au choix de l'utilisateur dans l'appli.
