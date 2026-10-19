# Installing Poulpe Design

Poulpe Design installs like any other application. Download the file for your system from the [project home page](../README.md#installer-poulpe-design) or the [Releases](https://github.com/KAYO74/PoulpeDesign/releases) page, then follow the steps below.

The download is free and open to everyone, with no GitHub account needed.

Poulpe Design is not yet digitally signed. Windows and macOS are therefore wary of it the first time you launch it: this is normal, and you only need to confirm once.

## Windows

1. Download `Poulpe_windows_x64-setup.exe`.
2. Double-click it. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.
3. The installer first asks for the language: **Français** or **English**. Poulpe Design will open in that language.
4. Follow the installer. Poulpe Design then appears in the Start menu, and `.poulpe` files open with a double-click.

Companies that deploy software often prefer the `.msi` installer, available on the Releases page. It does not ask for the language: Poulpe Design asks for it at first launch instead.

## macOS

1. Choose the right file: `Poulpe_darwin_aarch64.dmg` for a Mac with Apple silicon (M1, M2, M3, M4), `Poulpe_darwin_x64.dmg` for an Intel Mac. To find out which one you have: Apple menu > **About This Mac**, "Chip" or "Processor" line.
2. Open the `.dmg` and drag Poulpe Design into the **Applications** folder.
3. At first launch, macOS refuses to open an unsigned app. Open **System Settings > Privacy & Security**, scroll down to the message about Poulpe Design and click **Open Anyway**.

If macOS says the app "is damaged", open Terminal and type:

```sh
xattr -cr /Applications/Poulpe.app
```

then launch Poulpe Design again.

## Linux

**Ubuntu, Debian, Linux Mint and derivatives**: download `Poulpe_linux_amd64.deb` and double-click it to open it in the software installer, or type:

```sh
sudo apt install ./Poulpe_linux_amd64.deb
```

**Other distributions**: download `Poulpe_linux_amd64.AppImage`, make it executable, then run it:

```sh
chmod +x Poulpe_linux_amd64.AppImage
./Poulpe_linux_amd64.AppImage
```

## Language and theme

On macOS and Linux, which have no installer wizard, Poulpe Design asks for the language at first launch. After that, on all systems, the language and the dark or light theme can be changed in **Edit > Preferences** (or Ctrl+, on Windows and Linux, Cmd+, on Mac).

## Without installing

Developers can also run Poulpe Design in the browser from the source code: see [Contributing](../README.md#contribuer).
