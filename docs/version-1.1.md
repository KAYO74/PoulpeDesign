# Version 1.1

Version 1.1 brings together everything added since 1.0: the new name Poulpe Design, advanced layer management ([calques.md](calques.md)), the Preferences window and the Diagnostics page, rendering optimization ([performances.md](performances.md)), the customizable tools column ([panneaux-libres.md](panneaux-libres.md)) and choosing the language at installation, described here. 1.0 installations update themselves automatically.

## Language chosen at installation

- **Windows (`.exe` installer)**: the setup wizard first asks for the language (French or English). A small installer script, `apps/desktop/src-tauri/windows/langue.nsh`, writes this choice to `langue.txt`, next to `Poulpe.exe`. At launch, the app reads it (the `installer_language` command in `src-tauri/src/lib.rs`) and applies it.
  - The installer's choice is applied only once: automatic updates keep the same language without asking again, and so do not undo a change made later in Preferences. Reinstalling with a different language changes it.
  - Updating from 1.0 asks for the language once, since the old installer did not record it.
- **macOS, Linux and `.msi` installer**: with no wizard to ask the question, a bilingual window asks for it on the very first launch (`apps/editor/src/startLanguage.ts`). Someone who was already using the app keeps their language without being bothered.
- **Browser version**: the browser's language, as before.

The language is chosen before the welcome screen, which therefore appears directly in the right language.

## Language and theme in Preferences only

The language and theme buttons in the toolbar, and the View > Theme and View > Language submenus, have been removed. Both settings are in **Edit > Preferences**: the language under General, the dark or light theme under Display.
