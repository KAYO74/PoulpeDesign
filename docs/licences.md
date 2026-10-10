# Licences et origine du contenu

Poulpe Design est construit avec l'intelligence artificielle : le créateur du projet décrit ce qu'il veut, Claude (Anthropic) écrit le code, la documentation et les images. Cette page dit d'où vient chaque partie et sous quelle licence, pour qu'on puisse vérifier qu'aucun élément n'est repris d'un logiciel propriétaire comme Photoshop, Illustrator ou Affinity.

Dernière vérification : 5 octobre 2026, sur la version 1.0.

## Le code de Poulpe Design

Tout le code des dossiers `packages/` et `apps/` a été écrit pour Poulpe Design et est distribué sous [MPL-2.0](../LICENSE). La vérification n'a trouvé aucun en-tête de licence ou de droit d'auteur d'un tiers, aucun commentaire signalant du code repris, et aucun fichier binaire propriétaire (`.psd`, `.abr`, `.icc`, polices `.ttf` ou `.otf`).

- **Formats de fichiers.** L'ouverture et l'export des fichiers Photoshop (`.psd`) passent par la bibliothèque libre [ag-psd](https://github.com/Agamnentzar/ag-psd) (MIT), et l'ouverture des PDF et des fichiers Illustrator par [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0). Les PDF d'impression suivent les normes publiques PDF/X-4 et XMP.
- **Couleurs d'impression.** Le profil CMJN est calculé par Poulpe Design lui-même (`packages/core/src/cmyk.ts` et `icc.ts`) ; le profil officiel FOGRA39, qui ne peut pas être redistribué, n'est pas inclus, seulement nommé.
- **Gomme magique.** Elle reconstruit l'image à partir de la photo elle-même, avec un algorithme écrit pour Poulpe Design et sans modèle d'IA.
- **Vectorisation.** L'algorithme est écrit pour Poulpe Design à partir de méthodes publiées (k-moyennes, suivi des bords, courbes de Schneider). Potrace, sous licence GPL incompatible, n'est pas utilisé.
- **Détourage par IA.** Le modèle U²-Net « silueta » (Apache-2.0 pour U²-Net, MIT pour la version du projet rembg) est téléchargé à la compilation, avec son empreinte vérifiée, et exécuté par ONNX Runtime (MIT) sur l'ordinateur.
- **Extensions.** Elles tournent dans QuickJS (MIT).
- **Looks LUT.** Les six looks sont calculés par Poulpe Design ; les fichiers `.cube` sont un format public.

Les mentions de ces composants sont livrées avec l'appli dans `LICENCES-TIERS.txt`.

## Bibliothèques utilisées

Toutes sont sous licences libres compatibles avec la MPL-2.0.

| Partie                                                | Nombre | Licences                                                                                                                                                                       |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Interface et moteur (paquets npm livrés dans l'appli) | 116    | MIT pour la plupart, BSD-3-Clause, Apache-2.0 (pdf.js), MIT ou Apache-2.0 (Tauri), MPL-2.0 ou Apache-2.0 (DOMPurify), MIT et Zlib (pako), ISC, 0BSD (tslib), OFL-1.1 (polices) |
| Appli de bureau (bibliothèques Rust)                  | 533    | MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0, Unlicense, MPL-2.0, CDLA-Permissive-2.0, 0BSD, CC0                                                                               |

Pour refaire la vérification : `pnpm licenses list --prod` et, dans `apps/desktop/src-tauri`, `cargo metadata --format-version 1`.

## Polices

Les 7 polices fournies avec Poulpe Design sont sous licence libre [SIL Open Font License](https://openfontlicense.org) et viennent de [Fontsource](https://fontsource.org) : Inter, Montserrat, Playfair Display, Lora, Oswald, Bricolage Grotesque et Pacifico. Les modèles n'utilisent que celles-ci.

Arial, Georgia, Times New Roman, Courier New, Verdana et Trebuchet MS sont seulement proposées dans la liste des polices quand elles sont déjà installées sur l'ordinateur ; elles ne sont pas fournies avec Poulpe Design.

## Icônes, modèles et illustrations

- **Icônes** de la bibliothèque : [Phosphor Icons](https://phosphoricons.com), licence MIT, voir [`packages/library/LICENSE-icons.md`](../packages/library/LICENSE-icons.md).
- **Modèles, formes, cadres, illustrations et palettes** : dessinés pour Poulpe Design, sous MPL-2.0.
- **Logo** de Poulpe Design : dessiné pour Poulpe Design.

## Images de la page d'accueil

Les captures d'écran de `docs/images/` sont prises dans Poulpe Design lui-même, avec des documents de démonstration faits pour l'occasion. Elles n'utilisent que des polices libres : les polices OFL ci-dessus pour l'interface et les designs, et DejaVu Sans Mono (licence libre Bitstream Vera) pour les chiffres de l'interface.

## Noms de marques

Poulpe Design n'est affilié ni à Adobe ni à Serif. Photoshop, Illustrator, Affinity et Canva sont des marques de leurs propriétaires ; elles sont citées seulement pour comparer les fonctionnalités et pour nommer les formats de fichiers pris en charge.
