# Signature des installeurs et mises à jour automatiques

Ce qui est prêt dans Poulpe Design, et ce qu'il reste à faire de votre côté, partie par partie. Chaque partie est indépendante : le workflow « Installeurs de bureau » l'active dès que ses secrets existent (dépôt GitHub > Settings > Secrets and variables > Actions), et continue sinon à produire des installeurs non signés, comme avant.

## 1. Mises à jour automatiques (gratuit)

**Prêt :** l'appli cherche une nouvelle version au lancement et dans Aide > Rechercher les mises à jour…, la télécharge, vérifie sa signature et redémarre. La clé publique est dans `apps/desktop/src-tauri/tauri.conf.json`.

**À faire :**

1. Ajouter le secret `TAURI_SIGNING_PRIVATE_KEY` avec la clé privée créée sur son ordinateur par `npx @tauri-apps/cli signer generate -w ~/Documents/poulpe-maj.key --ci` (la clé publique correspondante est dans `tauri.conf.json` ; la clé privée ne doit jamais être publiée ni perdue : sans elle, plus aucune mise à jour ne peut être signée pour les applis déjà installées). Pas de mot de passe : `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` n'est pas nécessaire.
2. Rendre les versions téléchargeables publiquement : l'appli lit `https://github.com/KAYO74/PoulpeDesign/releases/latest/download/latest.json`, qu'un dépôt privé ne sert pas. Tant que le dépôt est privé, l'appli ne trouve simplement pas de mise à jour.
3. Publier une version comme d'habitude (onglet Actions, « Installeurs de bureau ») : le fichier `latest.json` et les fichiers de mise à jour signés s'ajoutent tout seuls aux installeurs.

Sous Linux, la mise à jour automatique concerne l'AppImage ; les paquets `.deb` et Flathub se mettent à jour par le gestionnaire de paquets.

## 2. Windows (payant, ou gratuit pour un projet libre public)

Sans signature, Windows affiche « Windows a protégé votre ordinateur » au premier lancement.

- **Azure Trusted Signing** (Microsoft), environ 10 dollars par mois, pour une personne ou une entreprise vérifiée. **Prêt dans le workflow** : créer un compte Trusted Signing et un profil de certificat, puis ajouter les secrets `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` et les variables `AZURE_SIGNING_ENDPOINT` (par exemple `https://weu.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`.
- **SignPath Foundation** : gratuit pour les logiciels libres, sur demande, mais seulement pour un dépôt public. À demander une fois le dépôt rendu public ; le workflow devra alors appeler leur service (petite modification).
- Un certificat classique (« OV ») coûte 200 à 400 euros par an et doit désormais être stocké sur une clé matérielle, peu pratique avec GitHub Actions.

## 3. macOS (99 dollars par an)

Sans signature ni notarisation, macOS dit que l'appli « ne peut pas être ouverte ».

**À faire :** s'inscrire à l'Apple Developer Program (99 dollars par an), créer un certificat « Developer ID Application », l'exporter en `.p12`, puis ajouter les secrets : `APPLE_CERTIFICATE` (le `.p12` en base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (par exemple `Developer ID Application: Prénom Nom (ABCDE12345)`), `APPLE_ID`, `APPLE_PASSWORD` (un mot de passe d'application créé sur appleid.apple.com) et `APPLE_TEAM_ID`. Le workflow signe et fait notariser l'appli automatiquement.

## 4. Linux : Flathub (gratuit)

**Prêt :** `packaging/flathub/` contient le manifeste Flatpak, la fiche AppStream (vérifiée avec `appstreamcli validate`) et le raccourci de bureau, sous l'identifiant `io.github.kayo74.Poulpe` (Flathub exige un identifiant lié à un domaine ou à un compte GitHub qu'on contrôle).

**À faire, une fois le dépôt public et la version 1.0.0 publiée :** remplacer dans le manifeste l'empreinte `sha256` par celle du `.deb` publié, puis proposer l'appli sur Flathub (une demande d'intégration sur github.com/flathub/flathub, en suivant leur guide). Flathub relit la demande et héberge ensuite les mises à jour.

## Résumé des coûts

| Partie                    | Coût                              | Condition                  |
| ------------------------- | --------------------------------- | -------------------------- |
| Mises à jour automatiques | Gratuit                           | Dépôt (ou versions) public |
| Windows                   | ~10 $/mois, ou gratuit (SignPath) | SignPath : dépôt public    |
| macOS                     | 99 $/an                           | Compte Apple Developer     |
| Linux (Flathub)           | Gratuit                           | Dépôt public               |
