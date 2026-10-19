# Editing engine v0.1: status and code organization

October 5, 2026

This page describes what the v0.1 code contains, how the code is split up, what the performance measurements under Linux show, and the known limitations.

## Running Poulpe Design

You need Node 20 or later and pnpm 10 (`corepack enable` is enough).

```sh
pnpm install
pnpm dev            # editor in the browser: http://localhost:5173
pnpm test           # engine tests
pnpm e2e            # end-to-end tests in Chromium
```

Desktop app: you also need [Rust and Tauri's system dependencies](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm desktop:dev    # desktop window with hot reload
pnpm desktop:build  # installers for the current system (in apps/desktop/src-tauri/target/release/bundle)
```

The installers for all three operating systems are built by GitHub Actions (`.github/workflows/desktop.yml`), run manually, on a `v*` tag, or when a PR touches the desktop app.

## Organization

| Folder            | Role                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | Document model, geometry, colors, text layout, commands and history, SVG export, `.poulpe` file. No browser dependency: tested with Vitest. |
| `packages/render` | Rendering the document onto a canvas, PNG and JPEG export.                                                                                  |
| `apps/editor`     | The interface (React + Vite): Affinity-style window, tools, panels, menus, shortcuts, file input and output.                                |
| `apps/desktop`    | The Tauri 2 desktop app that embeds `apps/editor`: window, `.poulpe` file association, installed fonts.                                     |

A gesture becomes a command, the command modifies the document, and the canvas redraws. Documents are immutable (immer): each command produces a new document that shares everything that has not changed with the previous one, which makes undo unlimited and cheap. A gesture (dragging, resizing, adjusting a color with a slider) leaves only one entry in the history.

## What v0.1 does

- **Affinity-style window**: menus, toolbar, context toolbar, tools column on the right (or left), tabbed Studio (Color, Stroke, Transform, Character, Layers, History) on the right or left, dark or light theme, French or English. Settings are remembered.
- **Tools**: move, direct selection (inside groups), artboard, rectangle (rounded corners), ellipse, polygon, star, line, text, image, color picker, hand, zoom. Single-key keyboard shortcuts as in Affinity.
- **Objects**: click and marquee selection, moving, resizing (Shift keeps proportions, Alt from the center), rotation (Shift in 15° steps), duplication with Alt + drag, alignment, distribution, flipping, 90° rotation, snapping to the edges and centers of objects, artboards and guides, rulers, guides and grid.
- **Guides**: drag from a ruler to place a guide, drag it to move it, drag it back onto the ruler to remove it; View > Clear guides. They are saved in the document.
- **Layers**: tree of artboards and objects, drag and drop to reorder or put into a group, groups, locking, visibility, renaming, opacity, 16 blend modes, simple clipping mask.
- **Color**: fill and stroke, HSV picker with hue and opacity, hexadecimal, RGB or HSL input, recent colors, document swatches, linear and radial gradients with a stop editor.
- **Text**: artistic text (click) or text block (drag), on-canvas editing, font (7 bundled free fonts and installed fonts), weight, size, italic, underline, strikethrough, capitals, letter spacing, line spacing, alignment and justification. Font, size, weight, italic, underline, strikethrough, letter spacing and color can change within a single text: select characters while editing and adjust the Character or Color panel; with no selection, the setting applies to what you type next.
- **Images**: import, cropping (double-click the image or the Crop button: the handles change the frame, dragging moves the image within the frame, the hidden part stays visible as a transparent overlay), reset to the full image.
- **Document**: multiple artboards, preset sizes, unlimited undo and redo with a History panel, copy, cut, paste, duplicate.
- **Files**: saving and opening the `.poulpe` format ([specification](format-poulpe.md)), image import (menu or drag and drop), PNG and JPEG export (scale, quality, transparent background), vector SVG and multi-page vector PDF with embedded fonts.
- **Drafts**: the unsaved document is copied to the browser (IndexedDB) shortly after each change. If the window closes without saving, Poulpe Design offers to reopen it on the next launch. The draft is cleared on save.
- **PDF fonts**: the fonts bundled with Poulpe Design are embedded in the PDF (read from their WOFF files and converted to TrueType). Installed fonts are embedded too in the desktop app, and in the browser when it gives access to local fonts (Chrome, Edge). A PostScript font (OpenType CFF) or a font that cannot be found is replaced with a standard font, and Poulpe Design reports it on export.
- **Desktop**: Tauri app, Windows, macOS and Linux installers, double-click a `.poulpe` file to open it, list of installed fonts.

## Deviations from the scope, accepted for this first version

- **Canvas 2D rendering instead of CanvasKit.** All drawing goes through `packages/render`, so CanvasKit can replace it without touching anything else. Canvas 2D is enough for v0.1, uses the system fonts directly and does not load 7 MB of WebAssembly; CanvasKit becomes useful in v0.3 for Boolean operations.
- **PDF through jsPDF and svg2pdf instead of pdf-lib.** The PDF is built from the SVG export, which keeps gradients and vector paths; pdf-lib cannot draw gradients.
- **In-window menus** rather than native system menus, identical in the browser and on the desktop.

## Desktop app performance under Linux

The scope asked us to measure the desktop app under Linux, where Tauri relies on WebKitGTK, before keeping Tauri rather than Electron. The benchmark is built into Poulpe Design: `?bench` in the editor's address, or `POULPE_BENCH=1 poulpe` for the desktop app, which writes its report to standard output. It draws 1,000 objects (shapes, gradients, strokes, rotations, 40 text blocks) on a 1920 × 1080 artboard and times 60 frames per scenario, forcing drawing to finish on each frame.

First measurement, on October 5, 2026, on a Linux virtual machine without a graphics card (Ubuntu 24.04, 4 Xeon cores at 2.8 GHz, Xvfb virtual display, 1056 × 718 px canvas window). Average time to draw one frame, and the corresponding frames per second:

| Scenario                    | Chromium 141     | Desktop app (WebKitGTK 2.52) | Ratio |
| --------------------------- | ---------------- | ---------------------------- | ----- |
| Redraw, 720 solid shapes    | 16 ms (61 fps)   | 74 ms (13 fps)               | × 4.5 |
| Redraw, 240 gradient shapes | 8.9 ms (113 fps) | 39 ms (26 fps)               | × 4.4 |
| Redraw, 40 text blocks      | 2.6 ms (381 fps) | 25 ms (40 fps)               | × 9.5 |
| Full redraw (1,000 objects) | 26 ms (38 fps)   | 103 ms (10 fps)              | × 3.9 |
| Moving 50 objects           | 32 ms (31 fps)   | 121 ms (8 fps)               | × 3.8 |
| Zooming and scrolling       | 58 ms (17 fps)   | 186 ms (5 fps)               | × 3.2 |

Takeaways:

- **Without a graphics card, WebKitGTK draws about 4 times slower than Chromium**, and text up to 10 times slower. The cost is proportional to the number of objects: about 0.1 ms per object in the desktop app versus 0.03 ms in Chromium.
- Estimate based on this per-object cost: a typical document (poster, social media post: a few dozen objects) draws in under 16 ms, so at 60 frames per second, in both cases; in the desktop app, on this kind of machine, smoothness drops beyond 150 to 200 objects.
- These figures are a floor: WebKitGTK could not use any graphics acceleration here. The measurement must be repeated on a real Linux workstation (`POULPE_BENCH=1 poulpe`) before deciding between Tauri and Electron.
- Already done: text layout and shape paths are cached as long as an object does not change (a 10 to 25% gain on text). Next leads, in order: during a move, keep the objects that do not move as an image and redraw only the selection; then the CanvasKit (WebGL) rendering planned for v0.3, which no longer goes through WebKitGTK's Canvas 2D.

## Still to do

v0.1 is complete. Known limitations, to be addressed in later versions:

- PDF export only embeds TrueType fonts; PostScript fonts (OpenType CFF) are replaced with a standard font.
- The bundled fonts only cover the Latin alphabet.
- The up and down arrows, Home and End follow Poulpe Design's layout; word shortcuts (Ctrl + arrows) follow those of the system's text input field, which may differ slightly on text with several sizes.
