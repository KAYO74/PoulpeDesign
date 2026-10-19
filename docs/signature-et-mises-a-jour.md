# Installer signing and automatic updates

What is ready in Poulpe Design, and what is left for you to do, part by part. Each part is independent: the "Installeurs de bureau" (desktop installers) workflow turns it on as soon as its secrets exist (GitHub repository > Settings > Secrets and variables > Actions), and otherwise keeps producing unsigned installers, as before.

## 1. Automatic updates (free)

**Ready:** the app checks for a new version at launch and in Help > Check for Updates…, downloads it, verifies its signature and restarts. The public key is in `apps/desktop/src-tauri/tauri.conf.json`.

**To do:**

1. Add the `TAURI_SIGNING_PRIVATE_KEY` secret with the private key created on your own computer by `npx @tauri-apps/cli signer generate -w ~/Documents/poulpe-maj.key --ci` (the matching public key is in `tauri.conf.json`; the private key must never be published or lost: without it, no update can ever be signed again for apps already installed). No password: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is not needed.
2. Make releases publicly downloadable: the app reads `https://github.com/KAYO74/PoulpeDesign/releases/latest/download/latest.json`, which a private repository does not serve. As long as the repository is private, the app simply finds no update.
3. Publish a release as usual (Actions tab, "Installeurs de bureau"): the `latest.json` file and the signed update files are added to the installers automatically.

On Linux, automatic updates apply to the AppImage; the `.deb` and Flathub packages are updated by the package manager.

## 2. Windows (paid, or free for a public open-source project)

Without a signature, Windows shows "Windows protected your PC" on first launch.

- **Azure Trusted Signing** (Microsoft), about 10 dollars a month, for a verified individual or company. **Ready in the workflow**: create a Trusted Signing account and a certificate profile, then add the secrets `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` and the variables `AZURE_SIGNING_ENDPOINT` (for example `https://weu.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`.
- **SignPath Foundation**: free for open-source software, on request, but only for a public repository. To be requested once the repository is public; the workflow will then need to call their service (a small change).
- A classic ("OV") certificate costs 200 to 400 euros a year and must now be stored on a hardware key, which is impractical with GitHub Actions.

## 3. macOS (99 dollars a year)

Without signing and notarization, macOS says the app "cannot be opened".

**To do:** join the Apple Developer Program (99 dollars a year), create a "Developer ID Application" certificate, export it as `.p12`, then add the secrets: `APPLE_CERTIFICATE` (the `.p12` in base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (for example `Developer ID Application: Prénom Nom (ABCDE12345)`), `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password created on appleid.apple.com) and `APPLE_TEAM_ID`. The workflow signs and notarizes the app automatically.

## 4. Linux: Flathub (free)

**Ready:** `packaging/flathub/` contains the Flatpak manifest, the AppStream metadata (checked with `appstreamcli validate`) and the desktop entry, under the identifier `io.github.kayo74.Poulpe` (Flathub requires an identifier tied to a domain or a GitHub account you control).

**To do, once the repository is public and version 1.0.0 is released:** replace the `sha256` hash in the manifest with that of the published `.deb`, then submit the app to Flathub (a submission on github.com/flathub/flathub, following their guide). Flathub reviews the submission and then hosts the updates.

## Cost summary

| Part              | Cost                           | Condition                       |
| ----------------- | ------------------------------ | ------------------------------- |
| Automatic updates | Free                           | Public repository (or releases) |
| Windows           | ~$10/month, or free (SignPath) | SignPath: public repository     |
| macOS             | $99/year                       | Apple Developer account         |
| Linux (Flathub)   | Free                           | Public repository               |
