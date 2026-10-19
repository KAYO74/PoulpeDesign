# Version 1.0: status and code organization

October 5, 2026

v1.0 adds to Poulpe Design the things that save time in Illustrator, Photoshop and Affinity: turning an image into a vector drawing, cutting out a subject in one click, recording your actions as macros, choosing your shortcuts and extending the app with extensions. The desktop app updates itself, and everything is ready for signing the installers. Everything is computed on the computer, offline and without any paid service.

## What the user sees

- **Vectorize Image** (Layer > Vectorize Image…, like Illustrator's "Image Trace"). You pick a preset (logo, black and white, sketch, grayscale, photo with low or high detail) or set the number of colors, the threshold, ignored specks, smoothing and sharp corners yourself; the before / after preview updates live. The result is a group of paths, one color per path, placed above the image (which is hidden, kept or deleted, as you choose). The paths can then be edited with the Node tool.
- **Remove Background** (Layer menu): the background of a photo disappears under a layer mask, which can be retouched with the brush, disabled or deleted (nothing is lost).
- **Select Subject** (Select menu, Photo Persona): selects the main person, animal or object; the selection combines with the add, subtract and intersect modes.
- **Macros** (Macros tab of the Studio, next to History; Extensions > Record Macro). Record, perform your actions, Stop. What gets recorded: menu and shortcut commands, filters with their settings, adjustment layers with their final settings, path offset, selection modification, vectorization, keyboard moves and extension commands. The macro replays in one click on another image or another object; steps that do not apply are skipped and reported. You can rename it (double-click), remove a step, save it to a `.poulpemacro` file to share it, and open someone else's.
- **Customizable shortcuts** (Help > Keyboard Shortcuts). Every command, macro or extension command has a button: click it, then press the keys you want. A shortcut that is already taken is removed from the other command (with a message), Backspace removes a shortcut, "Default" and "Reset All" go back to the original shortcuts. Single letters stay reserved for tools.
- **Extensions** (new menu Extensions > Manage Extensions…). An extension is a JavaScript file that adds commands to the Extensions menu. Three examples are shipped: Shape Grid, Random Colors, Rosette. An extension command forms a single history step (Ctrl+Z undoes it entirely) and can ask for settings in a small dialog. To write an extension: [extensions.md](extensions.md).
- **Automatic updates** (desktop app). At launch, Poulpe Design quietly checks whether a newer version exists and offers "Install and Restart". Help > Check for Updates… does the same on demand. The "Check at startup" option can be unchecked in the update dialog.

## Code organization

| Where                                  | What                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/trace.ts`           | Vectorization: color reduction (k-means), speck merging, pixel outlines, corners, Bézier curves (Schneider), stacking.                         |
| `packages/core/src/matte.ts`           | Cutout: preparing the image for the model, upscaling its output and refining the edges with a guided filter.                                   |
| `apps/editor/src/smart/`               | Vectorization and cutout in the editor, their Web Workers and the "Vectorize Image" dialog.                                                    |
| `apps/editor/scripts/fetch-models.mjs` | Downloads the cutout model (44 MB, SHA-256 checksum verified) before the build; it is not kept in Git.                                         |
| `apps/editor/src/macros/`              | Recorder (`recorder.ts`, no dependencies), macros and playback (`macros.ts`), Studio tab.                                                      |
| `apps/editor/src/shortcuts.ts`         | Custom shortcuts, stored in the browser or the app.                                                                                            |
| `apps/editor/src/registry.ts`          | Commands added at runtime (macros, extensions); `commands.ts` combines them with the app's own and routes everything through `runCommand`.     |
| `apps/editor/src/extensions/`          | Extension host (`host.ts`, QuickJS), what extensions can do to the document (`api.ts`), the `poulpe` object (`prelude.js`), examples, dialogs. |
| `apps/editor/src/updater.ts`           | Checking for, downloading and installing updates, then restarting.                                                                             |
| `apps/desktop/src-tauri/`              | Tauri `updater` and `process` plugins, update public key in `tauri.conf.json`.                                                                 |
| `.github/workflows/desktop.yml`        | Signing of updates, of macOS and of Windows, each enabled only if its secrets exist.                                                           |
| `packaging/flathub/`                   | Flatpak manifest, AppStream metadata and desktop entry, ready for a Flathub submission.                                                        |

The file format does not change (version 7): vectorization creates paths and the cutout creates a layer mask, both of which already existed. Macros, shortcuts and extensions are stored separately, in the app.

## Choices and deviations

- **Vectorization written for Poulpe Design.** Potrace and its ports are GPL-licensed, which is incompatible with MPL-2.0: the algorithm is written here, from published methods (k-means, pixel edge tracing, Schneider fitting). Colors are "stacked" like Illustrator's Stacked mode: each path also covers the area of the colors placed above it, which avoids white gaps between two colors.
- **AI cutout, on the computer.** The model is U²-Net in its "silueta" version (44 MB, published by the rembg project under the MIT license, U²-Net itself being under the Apache 2.0 license), run by ONNX Runtime in WebAssembly in a Web Worker. It was compared with u2netp (4.6 MB, noticeably less accurate on arms and hair) and IS-Net (178 MB, the most accurate, but too heavy for the installer; its compressed version leaves blotches). Expect 1 to 4 seconds per photo. Edges are refined by a guided filter on the photo at 1024 pixels.
- **App size.** The model (44 MB) and ONNX Runtime (14 MB) are bundled: the installer grows by about 50 MB, in exchange for a cutout that works offline. The website only downloads them on the first cutout.
- **Sandboxed extensions.** An extension runs in QuickJS (a JavaScript interpreter compiled to WebAssembly), not in the page: it has no window, no network, no files and no access to the desktop app, and it is stopped after 5 seconds of computation or 64 MB of memory. It only sees copies of the document and goes through the functions in `api.ts`. Extension panels with their own interface are postponed: a command asks for its settings in a dialog described by the extension.
- **Macros.** Mouse actions on the canvas (drawing a shape, painting) are not recorded, as in Affinity; neither are settings made in the Transform, Color and Stroke panels, for now. A macro replays as several history steps.
- **Tool shortcuts** (single letters): not customizable yet.
- **Installer signing.** It requires paid accounts or a membership application; everything is ready in the workflow, see [signature-et-mises-a-jour.md](signature-et-mises-a-jour.md). Automatic updates need releases to be publicly downloadable: as long as the repository is private, the app finds no update (with no error message at launch).
- **Postponed**: verified WCAG 2.2 AA accessibility, complete user documentation in English, performance on very large files (planned for v1.x).

## Tests

- `packages/core/test/v10.test.ts`: vectorization of a square (four sharp corners, straight segments), a disc (a few curves that stay on the circle), a ring (even-odd hole, stacked background), color reduction and speck merging, outlines with a hole, transparent pixels; model tensor, upscaling, guided filter, final mask.
- `apps/editor/e2e/smart.spec.ts`: color and black-and-white vectorization (disc recovered to within 4 pixels), background removal with the real model (opaque subject, transparent background), subject selection.
- `apps/editor/e2e/automation.spec.ts`: recording then playing back a macro on another object, changing a shortcut (the old one no longer works, the menu shows the new one), installing an example extension and running its command with settings (one history step, still there after reloading), the two other examples, and sandboxing (no `window`, `fetch` or Tauri access; an infinite loop is stopped).

## Licenses of added components

ONNX Runtime Web (MIT, Microsoft), U²-Net "silueta" model (Apache 2.0 for U²-Net, Xuebin Qin et al.; MIT for the rembg version, Daniel Gatis), QuickJS (MIT, Fabrice Bellard and Charlie Gordon) and quickjs-emscripten (MIT, Jake Teton-Landis), Tauri `updater` and `process` plugins (MIT or Apache 2.0). The notices ship with the app in `LICENCES-TIERS.txt`.
