# Installer Poulpe Design

Poulpe Design s'installe comme n'importe quelle application. Téléchargez le fichier de votre système depuis la [page d'accueil du projet](../README.md#installer-poulpe-design) ou la page [Versions](https://github.com/KAYO74/PoulpeDesign/releases), puis suivez les étapes ci-dessous.

Le téléchargement est libre et gratuit, sans compte GitHub.

Poulpe Design n'est pas encore signé numériquement. Windows et macOS se méfient donc au premier lancement : c'est normal, et il suffit de confirmer une fois.

## Windows

1. Téléchargez `Poulpe_windows_x64-setup.exe`.
2. Double-cliquez dessus. Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur **Informations complémentaires**, puis sur **Exécuter quand même**.
3. L'assistant demande d'abord la langue : **Français** ou **English**. Poulpe Design s'ouvrira dans cette langue.
4. Suivez l'assistant. Poulpe Design apparaît ensuite dans le menu Démarrer, et les fichiers `.poulpe` s'ouvrent d'un double-clic.

Les entreprises qui déploient des logiciels préfèrent souvent l'installeur `.msi`, disponible sur la page Versions. Il ne demande pas la langue : Poulpe Design la demande alors au premier lancement.

## macOS

1. Choisissez le bon fichier : `Poulpe_darwin_aarch64.dmg` pour un Mac à puce Apple (M1, M2, M3, M4), `Poulpe_darwin_x64.dmg` pour un Mac Intel. Pour savoir lequel vous avez : menu Pomme > **À propos de ce Mac**, ligne « Puce » ou « Processeur ».
2. Ouvrez le `.dmg` et glissez Poulpe Design dans le dossier **Applications**.
3. Au premier lancement, macOS refuse d'ouvrir une appli non signée. Ouvrez **Réglages Système > Confidentialité et sécurité**, descendez jusqu'au message sur Poulpe Design et cliquez sur **Ouvrir quand même**.

Si macOS dit que l'appli « est endommagée », ouvrez le Terminal et tapez :

```sh
xattr -cr /Applications/Poulpe.app
```

puis relancez Poulpe Design.

## Linux

**Ubuntu, Debian, Linux Mint et dérivées** : téléchargez `Poulpe_linux_amd64.deb` et double-cliquez dessus pour l'ouvrir dans l'installeur de logiciels, ou tapez :

```sh
sudo apt install ./Poulpe_linux_amd64.deb
```

**Autres distributions** : téléchargez `Poulpe_linux_amd64.AppImage`, rendez-le exécutable puis lancez-le :

```sh
chmod +x Poulpe_linux_amd64.AppImage
./Poulpe_linux_amd64.AppImage
```

## Langue et thème

Sur macOS et Linux, qui n'ont pas d'assistant d'installation, Poulpe Design demande la langue au premier lancement. Ensuite, sur tous les systèmes, la langue et le thème sombre ou clair se changent dans **Édition > Préférences** (ou Ctrl+, sur Windows et Linux, Cmd+, sur Mac).

## Sans installation

Les développeurs peuvent aussi lancer Poulpe Design dans le navigateur depuis le code source : voir [Contribuer](../README.md#contribuer).
