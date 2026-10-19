# Poulpe Design: scope and architecture

October 4, 2026

## Vision and principles

Poulpe Design (working name) is a free and open-source web application that brings together Affinity's graphic design capabilities (vector, photo, layout) and Canva's simplicity (templates, drag and drop), installed for free on Windows, macOS and Linux, and also usable in the browser.

- **Zero barriers**: a free desktop app to install, or the same app directly in the browser for those who cannot install software. No account required, no paid features.
- **Local first**: files stay on the user's device. The desktop app works entirely offline. No server is needed to edit.
- **Two levels of use**: a simple Canva-style mode (templates, reduced panels) and an advanced Affinity-style mode (pen, detailed layers, photo adjustments), on the same engine and the same file.
- **Open format**: the native file is documented and readable by anyone, and SVG, PDF and PNG export guarantees that you are never locked in.
- **Accessible**: WCAG 2.2 AA compliant interface, keyboard navigable, in French or English as the user chooses, smooth on a modest computer.
- **Affinity-style interface**: dark theme by default, tools in a column on the right by default (side can be changed), a context bar at the top that changes with the active tool, dockable and movable panels (layers, properties, colors, elements), a fully customizable layout that can be saved, and Draw, Photo and Layout workspaces you switch between in one click, like Affinity's "Personas". Light theme available.

## MVP scope

The first public version (v0.1) must let you create a poster or a social media visual from start to finish, then export it.

| Area         | In v0.1                                                                                                                                 | Later                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Distribution | Installed desktop app (Windows, macOS, Linux) and the same app in the browser                                                           | Automatic updates, app stores, Flatpak packages       |
| Interface    | Affinity-style layout: tools on the right by default (side can be changed), context bar, dockable panels, dark theme, French or English | Photo and Layout workspaces, customizable shortcuts   |
| Document     | Several pages or artboards, preset formats (A4, Instagram, YouTube…)                                                                    | Layout grids, shared styles                           |
| Shapes       | Rectangle, ellipse, polygon, line, fill, stroke, linear gradient                                                                        | Full pen tool, boolean operations, advanced gradients |
| Text         | Text block, free fonts and fonts installed on the computer, bold, italic, alignment, line spacing                                       | Text on a path, paragraph styles, advanced OpenType   |
| Images       | Import, crop, opacity, simple mask                                                                                                      | Photo retouching: levels, curves, filters, brushes    |
| Layers       | List, groups, order, locking, visibility                                                                                                | Advanced blend modes, adjustment layers               |
| Editing      | Selection, moving, resizing, rotation, alignment, snapping, undo and redo                                                               | Node editing, symbols, constraints                    |
| Files        | Open native format, double-click a `.poulpe` to open it, PNG, JPG, SVG export                                                           | PDF export, SVG and PSD import                        |
| Sharing      | File saved on the computer                                                                                                              | Real-time collaboration, share links                  |

Deliberately out of scope: full professional CMYK printing, RAW development, generative AI and reading Affinity's or Canva's proprietary formats, which are not documented.

## Tech stack

Everything is in TypeScript, rendering goes through Skia compiled to WebAssembly (CanvasKit) on WebGL, and the same web code is packaged as a desktop app with Tauri or served as a static site, with no server in either case.

| Layer                 | Choice                                                                                                                                       | Why                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language              | Strict TypeScript                                                                                                                            | The web language best known to contributors, safe typing for a complex engine                                                                                                                        |
| Desktop app           | [Tauri 2](https://v2.tauri.app/) (MIT and Apache-2.0 licenses) for Windows, macOS and Linux                                                  | Lightweight installers because Tauri uses the system's web engine instead of bundling Chromium; native access to files, installed fonts and menus; a small Rust layer for heavy processing if needed |
| Canvas rendering      | [CanvasKit](https://skia.org/docs/user/modules/canvaskit/) (Skia in WebAssembly, BSD-3 license) on WebGL 2                                   | The engine of Chrome and Android: precise vector paths, boolean operations, text layout with HarfBuzz, fast GPU rendering                                                                            |
| Photo filters         | WebGL 2 shaders, heavy computations in Web Workers                                                                                           | The interface stays smooth during processing; move to WebGPU once it is widely available                                                                                                             |
| Interface             | React, Vite, accessible [Radix UI](https://www.radix-ui.com/) primitives, dockable panels, design tokens as CSS variables                    | Components accessible by keyboard and screen readers, Affinity-style layout, simple dark and light themes                                                                                            |
| App state             | Document model in pure TypeScript, outside React                                                                                             | The engine can be tested without a browser and could be used elsewhere (command line, export server)                                                                                                 |
| Storage               | Desktop: native files via Tauri, double-click a `.poulpe`. Browser: File System Access, download as a fallback, drafts in IndexedDB and OPFS | Local first, offline, no hosting cost                                                                                                                                                                |
| Collaboration (later) | [Yjs](https://yjs.dev/) (CRDT, MIT license)                                                                                                  | Merging changes without a mandatory central server                                                                                                                                                   |
| Export                | PNG, JPG, WebP through the canvas; SVG through our own serializer; PDF with [pdf-lib](https://pdf-lib.js.org/)                               | Vectors preserved in SVG and PDF                                                                                                                                                                     |
| Fonts                 | Bundled free fonts (OFL license), plus the fonts installed on the computer                                                                   | No dependency on a third-party service                                                                                                                                                               |
| Tooling               | pnpm monorepo, Vitest, Playwright with visual rendering tests, ESLint, Prettier, GitHub Actions producing installers for all three systems   | A single repository, every change checked and packaged automatically                                                                                                                                 |
| Distribution          | Installers on the GitHub Releases of KAYO74/PoulpeDesign, browser version on GitHub Pages or Cloudflare Pages                                | Free to distribute, so free forever                                                                                                                                                                  |

Rejected rendering alternative: Canvas 2D alone, too slow beyond a few thousand objects and without boolean operations. A WebGL engine written from scratch remains possible later behind the same rendering interface. For the desktop, Electron is the alternative: it bundles Chromium, so rendering is identical everywhere, but installers are much heavier. Risk to watch with Tauri: Linux's web engine (WebKitGTK) performs worse with WebGL; we measure it from v0.1 and switch to Electron if the gap is too large, without touching the rest of the code.

## Engine architecture

The code is split into independent packages around a single document model: the interface never modifies the drawing directly, it goes through commands.

> Interactive "engine architecture" diagram (4 layers, 3 modules): see the [online version](https://claude.ai/code/artifact/90f3d5ab-7d39-4c67-82cb-f23c92eeb1f1).

A gesture becomes a command, the command modifies the model, and the renderer only redraws the affected objects before displaying the result in the interface's canvas. This split makes undo reliable, lets the engine be tested without a browser, and prepares collaboration and a future system of sandboxed extensions.

## Open file format

The native file is a ZIP archive containing a versioned JSON document and its resources, modeled on OpenDocument and OpenRaster. Its extension is `.poulpe`.

```
poster.poulpe (ZIP)
├── manifest.json      format version, source app, file list
├── document.json      pages, layers, objects, styles (published schema)
├── assets/
│   ├── images/        original images, never recompressed
│   └── fonts/         embedded fonts if their licence allows it
└── thumbnail.png      preview for file browsers
```

- **Readable by anyone**: the `document.json` schema is published as a JSON Schema with a written specification, under the CC-BY 4.0 license, so that other software can read and write it.
- **Versioned**: each file carries its format version; the app automatically migrates old files and cleanly rejects a file newer than itself.
- **Robust**: objects are identified by stable IDs, which prepares collaboration and version comparisons.
- **Interoperable**: SVG and PDF export remains the way to exchange with Inkscape, Illustrator or Affinity. SVG was not chosen as the native format because it handles neither multiple pages, nor non-destructive photo adjustments, nor templates.

## License and governance

The code is published under the MPL-2.0 license, the one used by Penpot: any change to a project file must stay open, without preventing the app from being integrated into other tools.

| Option               | What it guarantees                                       | Limitation                                                     |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| **MPL-2.0 (chosen)** | Modified files stay free; compatible with most libraries | A company can add closed files around it                       |
| AGPL-3.0             | Any version hosted online must publish its full code     | Discourages contributions from companies and some integrations |
| MIT                  | Maximum adoption, no constraints                         | Nothing prevents a closed, paid version                        |

- **Content**: templates, icons and illustrations provided under CC0 or CC-BY 4.0, fonts under OFL, so that everything created with the app can be used freely, including commercially.
- **Contributions**: DCO sign-off (one line in each commit) rather than a copyright assignment agreement, so that the code stays with the community.
- **Community**: Contributor Covenant code of conduct, contribution guide, issues labeled "good first issue", public discussions on GitHub.
- **Decisions**: the project's creator decides at first; once regular contributors arrive, structural choices go through written proposals (RFCs) in the repository.

## Roadmap

v0.1 aims at a first complete and simple use, then we broaden toward Canva before digging into Affinity's expert tools.

> Interactive "roadmap" diagram (6 phases, 5 gates): see the [online version](https://claude.ai/code/artifact/90f3d5ab-7d39-4c67-82cb-f23c92eeb1f1).

Each phase only starts once the previous gate is passed. Phases are not dated: the pace will depend on the number of contributors, and a version is released as soon as its gate is reached.

## Decisions made

The four structural choices were settled on October 4, 2026; the rest of the document applies unless someone objects.

- [x] **Project name**: Poulpe Design for now, `.poulpe` file extension.
- [x] **GitHub repository**: [KAYO74/PoulpeDesign](https://github.com/KAYO74/PoulpeDesign), private, linked to the project.
- [x] **Code license**: MPL-2.0.
- [x] **Interface languages**: French and English, chosen by the user in the app.
