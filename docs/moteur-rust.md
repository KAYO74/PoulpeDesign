# Moteur Rust et carte graphique (version 1.1.1)

10 octobre 2026

La version 1.1.1 commence la réécriture du cœur de Poulpe Design en Rust (option retenue : le moteur en Rust, l'interface actuelle gardée). Cette page fait le diagnostic des performances, décrit le nouveau moteur et ses réglages, donne les gains mesurés, la suite de la refonte et le plan de tests sur les quatre configurations types.

## Diagnostic

Ce qui a été vérifié avant de changer quoi que ce soit (même machine que [performances.md](performances.md) : Linux sans carte graphique, 4 cœurs).

| Point                          | Mesure avant la 1.1.1                                                          | Verdict                                      |
| ------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------- |
| Démarrage (fenêtre prête)      | 0,9 à 1,1 s dans Chromium, 6 Mo de mémoire JavaScript                          | Bon ; à confirmer dans l'appli sous Linux    |
| Zoom, défilement, survol       | 1 à 4 ms par image (plus de 250 i/s), 15 à 17 ms sur machine 4 fois plus lente | Bon depuis la 1.1.0 (cache d'images)         |
| Flou gaussien, photo de 12 Mpx | 4,5 s, interface figée                                                         | **Principal point noir**                     |
| Clarté, netteté (12 Mpx)       | 4,4 à 5 s, interface figée                                                     | **Principal point noir**                     |
| Teinte / saturation (12 Mpx)   | 0,95 s, interface figée                                                        | Lent                                         |
| Ouverture d'un gros `.poulpe`  | Décompression et conversion des images dans le fil de l'interface              | Gel de plusieurs secondes au-delà de 100 Mo  |
| Calcul des images              | Un seul cœur, pas de carte graphique                                           | Gâche la machine                             |
| Choix de la carte graphique    | Seulement « préférée » pour la vue web, au prochain lancement                  | Pas de choix du processeur ni de l'interface |

Conclusion : l'affichage courant est déjà fluide ; ce qui fige l'appli, ce sont les calculs lourds sur les pixels (filtres, réglages, gros fichiers), faits en JavaScript sur un seul cœur dans le fil de l'interface. C'est donc par là que commence le moteur Rust.

## Le moteur

```
crates/poulpe-engine        moteur Rust (bibliothèque), testé seul : cargo test --features gpu
  adjust.rs                 25 réglages et filtres, portage exact de packages/core/src/adjust.ts
  blur.rs                   flou gaussien (trois flous en boîte), lignes et colonnes en parallèle
  gpu.rs                    carte graphique via wgpu : choix, interface, mémoire vidéo, repli
  tiles.rs                  découpage des grandes images en tuiles, cache de tuiles limité en mémoire
  stats.rs                  profilage : durée des derniers calculs par sorte
crates/poulpe-engine-wasm   le même moteur compilé en WebAssembly (270 Ko, 80 Ko compressé)
packages/engine             chargement du WebAssembly dans la page, branché sur @poulpe/core
apps/desktop/src-tauri/src/engine.rs   moteur natif dans l'appli de bureau (commandes Tauri)
apps/editor/src/engine.ts   liaison avec l'éditeur (filtres, Préférences, Diagnostic)
```

Le même code Rust tourne de deux façons :

- **Dans la page, en WebAssembly** (navigateur et appli de bureau). Le rendu du canevas l'appelle directement, image par image, pour les filtres où il est nettement plus rapide que JavaScript : flou gaussien, netteté, clarté, teinte/saturation, seuil. Pour les réglages simples (une table par canal : niveaux, courbes, exposition…), le JavaScript du navigateur est aussi rapide et la copie des pixels coûterait plus qu'elle ne rapporte : ils restent en TypeScript.
- **En natif, dans l'appli de bureau.** Appliquer un filtre à une image de plus d'un million de pixels part au moteur natif, sur un fil à part : l'interface ne se fige plus. Le calcul se fait sur la carte graphique quand elle sait le faire (tables par canal, flou gaussien), sinon sur tous les cœurs du processeur.

**Mêmes pixels partout.** Le portage reprend les formules du TypeScript jusqu'aux arrondis (règle d'arrondi des `Uint8ClampedArray`, nombres flottants 32 bits là où le TypeScript en utilise). Les tests (`packages/engine/test/engine.test.ts`) comparent le moteur et le TypeScript sur chacun des 25 réglages, avec et sans repères de document : 0 pixel de différence. Sur la carte graphique, les tables par canal donnent exactement le même résultat ; le flou, calculé en flottants 32 bits, peut différer d'un niveau (sur 255) sur quelques pixels.

**Repli.** Si le WebAssembly ne se charge pas ou échoue (mémoire épuisée), il est débranché et le TypeScript reprend la main. Si la carte graphique échoue (pilote, mémoire vidéo), le calcul est refait sur le processeur. Une carte logicielle (llvmpipe, WARP) n'est jamais choisie : le processeur seul est plus rapide.

### Carte graphique (wgpu)

- Interfaces graphiques : Vulkan (Linux, Windows), Metal (macOS), DirectX 12 (Windows), OpenGL en dernier recours. Cartes NVIDIA, AMD, Intel et Apple Silicon.
- Choix automatique : la carte dédiée si elle existe, sinon la carte intégrée. « Intégrée » inverse l'ordre ; « Processeur seulement » n'ouvre aucune carte.
- La carte n'est ouverte qu'au premier calcul qui en a besoin : le démarrage n'est pas ralenti et l'appli au repos n'occupe pas de mémoire vidéo.
- Mémoire vidéo : une image trop grande pour la limite choisie (ou pour les limites de la carte) est traitée par tuiles, lues avec une marge pour les filtres qui regardent les pixels voisins.

```rust
// crates/poulpe-engine/src/gpu.rs : la carte graphique si elle sait faire et que l'image est assez
// grande pour que l'aller-retour vaille la peine, sinon (ou si elle échoue) tous les cœurs.
pub fn apply(gpu: Option<&Gpu>, data: &mut [u8], w: usize, h: usize, adj: &Adjustment, opts: &Options) -> (Where, f64) {
    let t0 = Instant::now();
    if let Some(gpu) = gpu {
        if w * h >= 1 << 20 && Gpu::supports(adj) && gpu.apply(data, w, h, adj, opts) {
            return (Where::Gpu, t0.elapsed().as_secs_f64() * 1000.0);
        }
    }
    adjust::apply(data, w, h, adj, opts);
    (Where::Cpu, t0.elapsed().as_secs_f64() * 1000.0)
}
```

## Réglages (Préférences > Performances)

| Réglage                                 | Valeurs                                                           | Effet                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Carte graphique                         | Automatique, Carte dédiée, Carte intégrée, Processeur seulement   | Moteur Rust : tout de suite. Affichage : au prochain lancement (Windows et Linux ; macOS choisit seul).                      |
| Interface graphique                     | Automatique, Vulkan, Metal, DirectX 12, OpenGL (selon le système) | Moteur Rust : tout de suite. Sous Windows, l'affichage passe aussi par Vulkan ou OpenGL au prochain lancement.               |
| Mémoire vidéo du moteur                 | 256 Mo à 8 Go (1 Go par défaut)                                   | Taille des tuiles envoyées à la carte graphique.                                                                             |
| Qualité d'aperçu                        | Rapide, Équilibrée, Haute                                         | Inchangé (voir [performances.md](performances.md)).                                                                          |
| Budget mémoire, cache d'images          | Comme avant                                                       | Limite de mémoire vive (RAM).                                                                                                |
| Profil Économie / Équilibré / Puissance | Boutons                                                           | Mode économie (carte intégrée, 512 Mo de mémoire vidéo, aperçu rapide) ou mode performance (carte dédiée, 4 Go, aperçu net). |
| Images par seconde dans la barre d'état | Case à cocher                                                     | Statistiques d'affichage (aussi dans Interface).                                                                             |

La section montre aussi l'état du moteur : WebAssembly actif, carte utilisée par le moteur natif et cartes trouvées. L'onglet Diagnostic ajoute le nombre de calculs et leur durée moyenne (profilage), par sorte et par lieu (`gpu:gaussianBlur`, `cpu:hsl`…), et les copie dans le rapport.

Ces réglages sont enregistrés dans `lancement.json` (dossier de configuration de l'appli) et lus au démarrage par Rust (`apps/desktop/src-tauri/src/launch.rs`). L'ancienne case « Accélération matérielle » devient le choix « Processeur seulement » ; un réglage déjà enregistré est repris tel quel.

## Les 5 gains rapides de la 1.1.1

1. **Filtres lourds en Rust dans la page** (WebAssembly) : flous et netteté 3 fois plus rapides, teinte et seuil 2 fois, dans le navigateur comme dans l'appli.
2. **Filtres sur les grandes images hors de l'interface** (appli de bureau) : sur tous les cœurs ou la carte graphique, jusqu'à 15 fois plus vite, et l'appli ne se fige plus pendant le calcul.
3. **Gros fichiers `.poulpe` ouverts et enregistrés hors de l'interface** (au-delà de 4 Mo, dans un Web Worker : `apps/editor/src/file.worker.ts`).
4. **Carte graphique, interface graphique et mémoire vidéo au choix**, appliqués tout de suite au moteur Rust.
5. **Rien de plus au démarrage** : le WebAssembly se charge quand l'appli est inactive, la carte graphique s'ouvre au premier calcul (démarrage mesuré : 1,1 s, comme avant ; 6 Mo de mémoire JavaScript au repos).

## Gains mesurés

Photo de 4000 × 3000 pixels (12 Mpx), Linux sans carte graphique, 4 cœurs. Commandes : `pnpm --filter @poulpe/engine test` (comparaison) et `cargo run --release --features gpu --example bench` dans `crates/poulpe-engine`.

| Calcul                 | Avant (TypeScript) | Dans la page (WebAssembly) | Appli de bureau (Rust natif, 4 cœurs) |
| ---------------------- | ------------------ | -------------------------- | ------------------------------------- |
| Flou gaussien (r = 20) | 4 500 ms           | 1 540 ms                   | **290 ms**                            |
| Clarté                 | 4 600 ms           | 2 200 ms                   | **300 ms**                            |
| Netteté                | 5 000 ms           | 1 500 ms                   | **300 ms**                            |
| Teinte / saturation    | 950 ms             | 540 ms                     | **170 ms**                            |
| Bruit                  | 340 ms             | (TypeScript)               | 86 ms                                 |
| Vibrance               | 140 ms             | (TypeScript)               | 68 ms                                 |
| Niveaux                | 40 ms              | (TypeScript)               | 9 ms                                  |

Avec 8 cœurs ou une vraie carte graphique, les temps natifs baissent encore ; ils sont à relever sur les quatre configurations ci-dessous. Sur la machine de mesure, la seule « carte » est logicielle (llvmpipe) : elle sert à vérifier les calculs de la carte graphique, pas à les chronométrer.

## Suite de la refonte

La 1.1.1 est la première des quatre étapes annoncées. Chaque étape est une version publiée, et les fichiers `.poulpe`, les mises à jour automatiques et la version navigateur continuent de marcher.

1. **Calculs sur les pixels** (1.1.1, cette version) : réglages, filtres, carte graphique, réglages de performance.
2. **Fichiers** : lecture et écriture des `.poulpe` en Rust dans l'appli de bureau, en flux et sans tout charger (fichiers de 500 Mo et plus), images gardées en mémoire par le moteur plutôt qu'en texte base64 dans la page.

   ```rust
   // Lecture d'une image d'un .poulpe sans charger l'archive entière (crate zip).
   pub fn read_asset(path: &Path, name: &str) -> zip::result::ZipResult<Vec<u8>> {
       let mut archive = zip::ZipArchive::new(BufReader::new(File::open(path)?))?;
       let mut entry = archive.by_name(name)?;
       let mut bytes = Vec::with_capacity(entry.size() as usize);
       std::io::copy(&mut entry, &mut bytes)?;
       Ok(bytes)
   }
   ```

3. **Rendu** : le dessin des plans de travail (formes, dégradés, textes, effets, modes de fusion) en Rust sur la carte graphique (vello sur wgpu), par tuiles mises en cache ; export PNG, JPEG et PDF à pleine résolution par le même moteur, sans passer par la page.

   ```rust
   // Une tuile du document, dessinée par vello sur la carte graphique puis gardée en cache.
   let mut scene = vello::Scene::new();
   for node in artboard.visible_nodes(tile.bounds()) {
       draw_node(&mut scene, node, tile.transform());
   }
   renderer.render_to_texture(&device, &queue, &scene, &tile.texture_view(), &params)?;
   ```

4. **Calques et historique** : le modèle du document et l'annulation en Rust ; l'interface React ne fait plus qu'afficher et envoyer les gestes.

## Plan de tests sur les quatre configurations types

À faire sur chaque machine avec l'appli de bureau 1.1.1, après mise à jour automatique depuis la 1.1.0.

| Étape                                                                | Attendu                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1. Lancer l'appli, chronométrer jusqu'à l'écran d'accueil            | Moins de 3 s                                                               |
| 2. Gestionnaire des tâches après 1 min sans rien faire               | Moins de 500 Mo pour tous les processus de l'appli                         |
| 3. Préférences > Performances                                        | Moteur Rust actif ; la bonne carte graphique et son interface affichées    |
| 4. Ouvrir une photo de 24 Mpx, Filtres > Flou gaussien, rayon 40     | L'appli reste réactive pendant le calcul ; Diagnostic : `gpu:gaussianBlur` |
| 5. Carte graphique : Processeur seulement, refaire l'étape 4         | Même image ; Diagnostic : `cpu:gaussianBlur`                               |
| 6. Ouvrir un `.poulpe` de plus de 200 Mo                             | Pas de gel ; le document s'ouvre                                           |
| 7. Activer les images par seconde, zoomer et défiler sur ce document | 60 i/s ou plus                                                             |
| 8. Exporter en PNG à 300 dpi                                         | Pas de gel de plus d'une seconde                                           |
| 9. `POULPE_BENCH=1` en ligne de commande                             | Rapport de mesure sur la sortie standard (à joindre)                       |
| 10. Diagnostic > Copier le rapport                                   | À joindre au ticket, avec les durées du moteur                             |

| Configuration                        | Interface attendue     | Résultat |
| ------------------------------------ | ---------------------- | -------- |
| Linux + NVIDIA (pilote propriétaire) | Vulkan                 | à faire  |
| Windows + AMD                        | DirectX 12 (ou Vulkan) | à faire  |
| Mac Intel                            | Metal                  | à faire  |
| Mac Apple Silicon                    | Metal                  | à faire  |

Ce qui est déjà vérifié automatiquement, à chaque modification (CI) : les 25 réglages identiques entre Rust et TypeScript, le calcul sur une carte graphique (logicielle, Vulkan llvmpipe) identique au processeur, le découpage en tuiles, le choix de la carte et la lecture des réglages, la compilation WebAssembly, et les tests de bout en bout de l'éditeur.
