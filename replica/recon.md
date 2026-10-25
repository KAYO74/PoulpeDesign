# Recon : le meilleur de Photoshop et d'Affinity pour Poulpe Design

## Portée
- **Apps étudiées** : Adobe Photoshop (bureau) et Affinity Photo / Designer (bureau).
- **Tranche** : ce qui manque encore à Poulpe Design, pas une copie de tout. Poulpe a déjà les Personas, les outils à parité Affinity (v1.2.0), calques, masques, réglages, pinceaux, PSD.
- **Pour qui** : tout le monde, appli libre (MPL-2.0).
- **Règle** : on reprend les fonctions et la façon de travailler, **pas le look**. Le thème Poulpe (sombre/clair, coins arrondis, Inter) ne change pas. Seule la couleur d'accent devient réglable.

## Sources (publiques uniquement)
| source | lien |
| --- | --- |
| Guide Photoshop | https://helpx.adobe.com/photoshop/user-guide.html |
| Nouveautés Photoshop | https://helpx.adobe.com/photoshop/using/whats-new.html |
| Aide Affinity Photo | https://affinity.help/photo2/ |
| Aide Affinity Designer | https://affinity.help/designer2/ |
| Code Poulpe (état actuel) | docs/version-1.2.md, docs/outils-manquants-v0.6.md, docs/retouche-photo-v0.4.md |

L'état « existe / manque » côté Poulpe vient d'une recherche dans le code : à confirmer en ouvrant l'appli.

## Écrans (ajouts proposés)
| ID | écran | accès | but | composants | états |
| --- | --- | --- | --- | --- | --- |
| S01 | Préférences › Affichage | Édition › Préférences | thème, **couleur du thème** | listes, pastilles, sélecteur de couleur | origine, pastille, couleur libre, thème clair |
| S02 | Persona Développement | bouton Persona, ouverture d'un RAW | régler un RAW avant retouche | curseurs, histogramme, avant/après | sans RAW, chargement, erreur de lecture |
| S03 | Persona Export | bouton Persona | tranches et exports multiples | liste de tranches, formats, tailles | aucune tranche, export en cours |
| S04 | Panneau Couches | Studio | voir et charger les canaux | vignettes de canaux | RVB, alpha, couche de réserve |
| S05 | Panneau Historique › Instantanés | Studio | revenir à un état nommé | liste, bouton + | vide, plein |
| S06 | Plages de fusion | calque › bouton engrenage | fondre un calque selon la luminosité | deux courbes | par défaut, modifié |
| S07 | Remplissage selon le contenu | Édition, sélection active | effacer une zone | aperçu, zone d'échantillon | sans sélection (grisé), calcul |

## Parcours
```
F01 Changer la couleur du thème (fait)
    S01 : Préférences › Affichage › une pastille  (2 clics + raccourci Ctrl+,)
    edge : thème clair (couleur pâle foncée auto), retour à l'origine, couleur très claire (texte foncé)
F02 Retoucher une photo RAW
    Fichier › Ouvrir .dng -> S02 réglages -> Appliquer -> Persona Photo
    edge : RAW non reconnu, très grande image
F03 Effacer un objet
    Sélection -> S07 -> Valider   (Photoshop : 3 clics, objectif pareil)
F04 Exporter des icônes en plusieurs tailles
    S03 -> créer tranches des calques -> choisir 1x/2x/3x PNG + SVG -> Exporter
F05 Filtre réglable plus tard
    Filtres › Flou (en direct) -> calque filtre dans Calques -> double-clic pour modifier
```

## Composants
- **Pastille de couleur** (nouveau, S01) : rond 20 px, contour `--line-2`, actif = contour `--fg`.
- Réutilisés : `Select`, `NumberField`, `Modal`, panneaux Studio, `FloatingFrame`, barre contextuelle. Tout utilise les jetons CSS (`--panel`, `--line`, `--accent`…).

## Modèle de données (déduit)
```
Settings.accent   string | null   (#rrggbb, null = rose d'origine)   confiance : sûre (fait)
FilterLayer       id, kind (blur|sharpen|noise…), params, mask?        preuve : Live Filters Affinity   confiance : haute
LinkedImage       id, source (embedded|path), bytes, transform          preuve : Smart Objects            confiance : moyenne
Slice             id, name, rect | layerId, exports[{format, scale}]    preuve : Export Persona           confiance : haute
Snapshot          id, name, historyIndex | docCopy                      preuve : Snapshots                confiance : moyenne
BlendRanges       source[curve], underlying[curve] sur chaque calque    preuve : Blend Ranges             confiance : moyenne
```
Le format `.poulpe` devra monter de version pour FilterLayer, LinkedImage, Slice, BlendRanges.

## Ce qui ne se copie pas
Remplissage génératif Firefly (service payant), Adobe Stock et bibliothèques CC, format .afphoto (fermé), polices et pinceaux propriétaires. Voir les lignes `skip` de features.csv.

## Taille
7 écrans, 5 parcours, 5 entités. Difficile : RAW (LibRaw en Rust), filtres en direct sur le moteur GPU, panorama/HDR. Taille **L** (un trimestre) pour tout ; les « must » seuls font **M**.
