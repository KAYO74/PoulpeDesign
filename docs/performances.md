# Performances : mesure et optimisation du canevas

6 octobre 2026

Cette page dit où Poulpe Design ralentissait, ce qui a été changé et ce que l'on gagne, chiffres avant et après à l'appui. Elle décrit aussi les réglages de performance que la fenêtre Préférences affiche.

## Comment on mesure

La mesure est intégrée à l'appli : `?bench` dans l'adresse de l'éditeur, ou `POULPE_BENCH=1 poulpe` pour l'appli de bureau, qui écrit son rapport sur la sortie standard (voir [moteur-v0.1.md](moteur-v0.1.md#performances-de-lappli-de-bureau-sous-linux)).

Le document d'essai contient 1 000 objets (formes unies, dégradés, contours, rotations, 40 blocs de texte) sur un plan de travail 1920 × 1080. Chaque scénario rejoue un geste réel image par image, 60 fois. Le temps d'une image compte tout ce que le geste provoque : le geste lui-même, la mise à jour des panneaux, les dessins de l'image suivante (canevas, règles) et la fin du dessin par le navigateur. En dessous de 16 ms, l'image suit l'écran à 60 images par seconde.

Machine de mesure : machine virtuelle Linux sans carte graphique, 4 cœurs Xeon, Chromium 141, canevas de 721 × 718 px. La colonne « machine lente » ralentit le processeur 4 fois (réglage de Chromium), ce qui donne une idée d'un vieil ordinateur ou de l'appli de bureau sous Linux, dont la vue web est environ 4 fois plus lente sans carte graphique.

## Résultats

Temps moyen d'une image, en millisecondes (images par seconde entre parenthèses).

| Scénario                         | Avant   | Après     | Machine lente, avant | Machine lente, après |
| -------------------------------- | ------- | --------- | -------------------- | -------------------- |
| Survol des objets à la souris    | 30 (34) | 1 (1 000) | 141 (7)              | 5 (189)              |
| Défilement                       | 24 (42) | 1,4 (713) | 113 (9)              | 6 (166)              |
| Zoom                             | 69 (15) | 3,6 (279) | 337 (3)              | 15 (66)              |
| Défilement à fort zoom (× 4)     | 54 (18) | 3,3 (307) | 270 (4)              | 17 (60)              |
| Déplacement de 50 objets         | 54 (18) | 15 (66)   | 247 (4)              | 68 (15)              |
| Réglage de la couleur d'un objet | 49 (20) | 11 (90)   | 223 (4)              | 48 (21)              |
| Premier affichage du document    | 24 (41) | 17 (59)   | 113 (9)              | 117 (9)              |

Pas de fuite de mémoire : la mesure complète rejouée 4 fois de suite dans la même fenêtre, la mémoire JavaScript reste stable (47, 49, 49, 49 Mo après nettoyage). Les images gardées par le cache sont limitées par le réglage « Cache d'images » (256 Mo au plus par défaut) ; pour un écran de cette taille, elles occupent quelques Mo.

Ce qu'on en retient :

- **Bouger la souris, défiler et zoomer ne font plus ramer**, même sur une machine lente : de 3 à 9 images par seconde avant, plus de 60 après.
- **Déplacer ou modifier des objets est 3 à 4 fois plus rapide**, grâce à ce changement et à la liste des calques virtualisée (PR #22), qui ne recrée plus ses 1 000 lignes à chaque image.
- Le premier affichage d'un document ne change pas : il faut bien tout dessiner une fois.

## Ce qui ralentissait, et ce qui a changé

1. **Chaque mouvement de souris redessinait tout le document.** La position du pointeur (affichée dans la barre d'état) passait par l'état de l'interface, et le canevas se redessinait à chaque changement de cet état, y compris celui-là. Il lisait aussi les couleurs du thème (un calcul de style de la page) à chaque fois. Désormais le canevas ignore ce qui ne le concerne pas (pointeur, messages, boîtes de dialogue) et ne relit les couleurs que quand le thème change.
2. **Cache d'images du canevas** (`packages/render/src/cache.ts`). Le contenu de chaque plan de travail est gardé en image et simplement recopié tant qu'il ne change pas. Quand des objets sont sélectionnés, ce qui est dessous et ce qui est dessus sont gardés en deux images, et seuls les objets sélectionnés (ceux qu'on modifie) sont dessinés à chaque image. Une image reste bonne tant que ses objets sont les mêmes : les documents sont immuables, un objet inchangé garde son identité, la vérification est donc immédiate. Les modes de fusion, les calques de réglage, les cadres de texte liés, les numéros de page, les symboles et les images en cours de retouche sont pris en compte ; dans le doute, le dessin se fait en direct comme avant.
3. **Zoom et défilement.** Pendant le geste, l'image déjà calculée est déplacée ou étirée ; elle est redessinée nette dès que le geste s'arrête (140 ms). Le réglage « Qualité d'aperçu » permet de redessiner net à chaque image.
4. **Objets hors de l'écran ignorés.** À fort zoom, seuls les objets visibles sont dessinés.
5. **Règles** redessinées au plus une fois par image et seulement quand la vue change, sans réallouer leur toile.
6. **Damier de transparence** dessiné d'un seul motif au lieu de milliers de petits carrés.
7. **Taille des textes** : à chaque commande, la taille de tous les textes était recalculée (mesure de chaque mot). Elle est maintenant gardée tant que le texte ne change pas.
8. **Historique** : la liste des étapes n'est plus recopiée à chaque image d'un geste, et le nombre d'étapes gardées est limité (500 par défaut, réglable) pour que la mémoire ne grossisse pas sans fin sur les grosses retouches photo.
9. **Zone de saisie du texte** : elle ne se met plus à jour à chaque changement du document quand aucun texte n'est en cours d'édition.

Les tests de bout en bout vérifient que l'image affichée avec le cache est la même qu'un dessin complet sans cache, pendant un déplacement et après une modification (`apps/editor/e2e/performance.spec.ts`).

## Réglages de performance

Ils sont appliqués par `apps/editor/src/perf.ts` ; la fenêtre Préférences > Performances les affiche, les enregistre et appelle `setPerformanceSettings` au démarrage avec les valeurs enregistrées.

| Réglage                 | Champ                  | Par défaut          | Effet                                                                                                                                                                                   |
| ----------------------- | ---------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache d'images          | `cacheMb`              | 256 Mo              | Mémoire maximale des images gardées du canevas. 0 désactive le cache (tout est redessiné à chaque image).                                                                               |
| Étapes d'annulation     | `historyLimit`         | 500                 | Les étapes plus anciennes sont oubliées. 0 : illimité.                                                                                                                                  |
| Qualité d'aperçu        | `previewQuality`       | équilibrée          | `fast` : image étirée pendant le zoom même si elle ne couvre pas tout l'écran ; `balanced` : étirée tant qu'elle couvre l'écran ; `full` : redessinée nette à chaque image (plus lent). |
| Accélération matérielle | `hardwareAcceleration` | oui                 | Images du cache confiées à la carte graphique (toiles hors écran). Non : gardées en mémoire centrale, utile si un pilote graphique pose problème.                                       |
| Fils de calcul          | `workerThreads`        | nombre de cœurs − 1 | Fils utilisés par le détourage par IA.                                                                                                                                                  |

`renderStats()` donne les chiffres de la fenêtre Diagnostic : mémoire occupée par le cache, nombre d'images gardées, durée moyenne et maximale des 60 dernières images, mémoire JavaScript (Chromium).

## Linux : ombre des plans de travail (1.1.2)

Premier retour sur un vrai poste Linux (i7, RTX 4060, écran 2560 × 1440) : 45 ms par image dans l'appli de bureau. Quand WebKitGTK dessine le canevas sans carte graphique (cas fréquent avec certains pilotes), le flou de l'ombre portée des plans de travail (`shadowBlur`) coûtait à lui seul 22 ms par image. L'ombre est maintenant floutée une seule fois sur un petit carré, puis ses coins sont recopiés et ses bords étirés (`drawArtboardShadow`) : même rendu à 1 niveau de couleur près.

Mesure dans WebKitGTK 2.52 sans accélération du canevas, 1 000 objets, fenêtre 2560 × 1440, en ms par image :

| Scénario                         | Avant | Après |
| -------------------------------- | ----: | ----: |
| Survol à la souris               |  18,7 |   5,2 |
| Défilement                       |  28,7 |   6,1 |
| Zoom                             |  34,7 |  16,4 |
| Réglage de la couleur d'un objet |  44,4 |  23,2 |
| Déplacement de 50 objets         |  51,5 |  33,1 |

Autres constats du même rapport :

- WebKit masque le nom de la carte graphique (« Apple GPU ») et annonce au plus 8 cœurs : le Diagnostic affiche maintenant le modèle du processeur, ses vrais fils d'exécution et la mémoire occupée par tous les processus de l'appli, lus par l'appli de bureau.
- WebKitGTK n'active l'isolation multi-origine (`crossOriginIsolated`, threads partagés dans la page) que pour les pages servies en HTTP, pas pour le protocole de l'appli : les calculs lourds passent donc par le moteur Rust natif, qui utilise tous les cœurs.

## Pistes suivantes

- Calques de réglage et filtres photo calculés dans un Web Worker, hors du fil de l'interface.
- Refaire la mesure dans l'appli de bureau sur un vrai poste Linux (`POULPE_BENCH=1 poulpe`).
