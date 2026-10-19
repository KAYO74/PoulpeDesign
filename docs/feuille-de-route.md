# Poulpe Design — Feature roadmap

October 4, 2026

Poulpe Design covers the essentials of Illustrator, Photoshop and Affinity in v1.0, through five milestones that each add a discipline: basic drawing, quick Canva-style creation, pro vector, photo retouching, layout and pro export.

## Goal and principles

- **One document, three disciplines.** As in Affinity, you move from vector (Illustrator / Designer) to pixels (Photoshop / Photo) and to layout (Publisher) without changing file or app.
- **Non-destructive everywhere.** Adjustment layers, live filters, masks and effects stay editable until export.
- **Simple first, powerful next.** Advanced features live in panels you open when needed, to keep the mockup's clean interface.
- **Installable desktop app, from v0.1.** Poulpe Design installs on Windows, macOS and Linux via Tauri, which bundles the same web code. The browser version remains available without installation. Everything runs locally, without a server (CanvasKit / WebGL 2, filters as shaders).
- **Consistent with the scoping document.** We keep its milestones v0.1 (engine), v0.2 (Canva) and v1.0. The scoping document's "v0.3 Affinity" step is split here into three: v0.3 pro vector, v0.4 photo retouching, v0.5 layout and pro export.

## Feature mapping

The flagship features of the three applications, and the milestone in which Poulpe Design brings them. "AI" = Illustrator, "PS" = Photoshop, "AF" = Affinity (Designer, Photo, Publisher).

| Feature                                                      | Found in     | Poulpe Design                   |
| ------------------------------------------------------------ | ------------ | ------------------------------- |
| Shapes, rounded rectangles, polygons, stars                  | AI, AF       | v0.1                            |
| Layers, groups, locking, visibility                          | AI, PS, AF   | v0.1                            |
| Artistic text and frame text, Google Fonts                   | AI, PS, AF   | v0.1                            |
| Fill, stroke, linear and radial gradients                    | AI, PS, AF   | v0.1                            |
| Multiple artboards                                           | AI, PS, AF   | v0.1                            |
| Unlimited undo / redo, history                               | AI, PS, AF   | v0.1                            |
| PNG, JPEG, SVG, PDF export                                   | AI, PS, AF   | v0.1                            |
| Templates, element library, social media formats             | (Canva)      | v0.2                            |
| Pen, nodes, Bézier curves, pencil                            | AI, AF       | v0.3                            |
| Boolean operations, Pathfinder, Shape Builder                | AI, AF       | v0.3                            |
| Symbols, layer styles, character and paragraph styles        | AI, AF       | v0.3                            |
| Text on a path, advanced OpenType, converting text to curves | AI, AF       | v0.3                            |
| Mesh gradients, conical gradients, patterns                  | AI, AF       | v0.3                            |
| Pixel brushes, eraser, clone stamp, healing brush            | PS, AF       | v0.4                            |
| Selections (lasso, magic wand, quick selection)              | PS, AF       | v0.4                            |
| Layer masks and clipping masks                               | PS, AF       | v0.1 (simple), v0.4 (pixel)     |
| Adjustment layers (levels, curves, HSL, balance)             | PS, AF       | v0.4                            |
| Live filters (blur, sharpen, noise, distortion)              | PS, AF       | v0.4                            |
| Blend modes and effects (shadow, glow, bevel)                | PS, AF       | v0.1 (blending), v0.3 (effects) |
| Crop, straighten, perspective transform                      | PS, AF       | v0.4                            |
| RGB / CMYK color management, ICC profiles, swatches          | AI, PS, AF   | v0.5                            |
| Master pages, linked text frames, layout styles              | AF Publisher | v0.5                            |
| Print PDF/X export, bleed, crop marks                        | AI, AF       | v0.5                            |
| Opening PSD, SVG, PDF and AI (PDF compatibility)             | AI, PS, AF   | v0.3 (SVG), v0.5 (PSD, PDF, AI) |
| Image tracing (Image Trace)                                  | AI           | v1.0                            |
| Automatic cutout and content-aware fill                      | PS           | v0.4 (fill), v1.0 (cutout)      |

## Detailed milestones

> Interactive "roadmap" diagram (6 milestones): see the [online version](https://claude.ai/code/artifact/2c715d1a-2474-4a2e-9d8a-fdf7bd81d031).

Each milestone builds on the previous one: pro vector, photo and layout share the v0.1 engine.

### v0.1 Basic editing engine

- **Tools:** selection, direct selection, rectangle, ellipse, polygon, star, line, text, image, hand, zoom, eyedropper.
- **Objects:** move, resize, rotate, align, distribute, snapping, rulers and guides, grid.
- **Layers:** groups, order, locking, visibility, opacity, 12 blend modes, simple clipping masks.
- **Color:** HSL / RGB / hexadecimal picker, opacity, recent colors, document swatches, linear and radial gradients with a stop editor.
- **Text:** font, weight, size, letter spacing, line spacing, alignment, color, uppercase, underline and strikethrough.
- **Document:** multiple artboards, unlimited undo, local `.poulpe` saving, PNG, JPEG, SVG, PDF export.
- **Desktop:** Windows (.msi), macOS (.dmg) and Linux (AppImage, .deb) installers, opening `.poulpe` files by double-click, native menus, drag and drop from the system, access to installed fonts.

### v0.2 Canva side

Delivered on October 5, 2026, see [cote-canva-v0.2.md](cote-canva-v0.2.md).

- Templates by format (Instagram, story, A4, poster, business card, YouTube thumbnail).
- Library of free elements (shapes, icons, illustrations). Built-in CC0 photos are postponed: you import your own photos into frames.
- Ready-made font pairings, suggested color palettes, resizing a design to another format.

### v0.3 Pro vector (Illustrator, Affinity Designer)

First part delivered on October 5, 2026, see [vectoriel-pro-v0.3.md](vectoriel-pro-v0.3.md): pen, pencil, Node tool, the five boolean operations, path offset, conversion to curves (including text), dashes, caps, joins and arrows, five effects (drop shadow, inner shadow, outer glow, inner glow, blur), text on a path and SVG import. The rest of the list below (symbols, styles, mesh, conical gradients, patterns, variable width, multiple strokes, OpenType, columns, Shape Builder, scissors, knife, bevel) will follow in a v0.3.x. The move of rendering to CanvasKit is postponed: the current Canvas 2D rendering is enough for everything above, and boolean operations go through Paper.js.

- **Paths:** pen, nodes, handles, pencil, smoothing, scissors, knife, corner tool (rounding a corner).
- **Geometry:** union, subtract, intersect, exclude, divide, Shape Builder, path offset.
- **Advanced strokes:** dashes, caps, arrows, variable width, multiple strokes per object.
- **Advanced color:** conical and mesh gradients, patterns, linked global colors, color harmonies.
- **Advanced text:** text on a path, columns, text wrap around shapes, OpenType (ligatures, figures, small caps), character and paragraph styles, converting text to curves.
- **Reuse:** symbols, layer styles, effects (drop shadow, inner shadow, glow, bevel, outline), SVG import.

### v0.4 Photo retouching (Photoshop, Affinity Photo)

Delivered on October 5, 2026, see [retouche-photo-v0.4.md](retouche-photo-v0.4.md): Photo Persona, selections (rectangle, ellipse, lasso, magic wand, feather, grow, shrink), pressure-sensitive brush, eraser, paint bucket, clone stamp, dodge and burn, blur and sharpen brushes, **magic eraser** and content-aware fill (offline, without AI), pixel layer masks, 14 adjustment layers, 6 live filters, auto levels and histogram. Postponed: quick selection, polygonal lasso, healing brush, smudge, liquify and distortions, LUT, straighten, perspective, image and canvas size.

- **Pixel layers:** brushes with stylus pressure, eraser, paint bucket, clone stamp, healing brush, smudge, dodge and burn.
- **Selections:** rectangle, ellipse, lasso, polygonal lasso, magic wand, quick selection, refine edges.
- **Non-destructive:** pixel layer masks, adjustment layers (levels, curves, hue and saturation, color balance, black and white, exposure, vibrance, LUT), live filters (blurs, sharpen, noise, distortions, liquify).
- **Image:** crop, straighten, perspective, image and canvas size, histogram.

### v0.5 Layout and pro export (Affinity Publisher, print)

Done in October 2026, in two parts. First part, see [mise-en-page-v0.5.md](mise-en-page-v0.5.md): Layout Persona and Pages panel, multi-page documents in a column or as facing pages, master pages, page numbers, linked text frames, margins, bleed, document resolution, and print PDF at actual size with crop marks. Second part, see [impression-v0.5.md](impression-v0.5.md): CMYK colors with an ICC profile, soft proofing, PDF/X-4, opening PSD, PDF and AI files, PSD export and batch export. Grayscale and spot colors will come with swatches.

- Multi-page documents, master pages, linked text frames, page numbering.
- RGB, CMYK and grayscale color management with ICC profiles, soft proofing.
- PDF/X export with bleed and crop marks, slice export and batch export.
- Opening PSD (layers) and PDF / AI files, PSD export.

### v1.0 Stable version

Delivered on October 5, 2026, see [version-1.0.md](version-1.0.md): image tracing, automatic cutout (subject selection, background removal), macros, customizable shortcuts, extensions, automatic updates. Installer signing and Flathub are ready and waiting for the necessary accounts (see [signature-et-mises-a-jour.md](signature-et-mises-a-jour.md)). Verified accessibility, complete English documentation and performance on very large files will follow in v1.x.

- Image tracing, automatic cutout and content-aware fill, computed in the browser.
- Recordable actions and macros, customizable shortcuts, extensions.
- Signed desktop app (Windows, macOS) with automatic updates, published on Flathub for Linux.
- Performance on large files, verified WCAG 2.2 AA accessibility, FR / EN documentation.

### v1.3 Next version (requested on October 13, 2026)

Everything without regressions or bugs: each item is checked by the tests before being released.

- **English documentation:** all of the repository's documentation translated.
- **Panels:** moving the Layers, Brush, History and other windows more easily.
- **Colors:** an RGB picker with a wheel, which opens when you choose a color in the toolbar or in the top menu; the "No color" choice wherever a color is chosen, as in Affinity.
- **Brushes:** creating your own brushes and sharing them, also as app extensions; a brush creation window that stays open while you try the brush on the document, and that can be closed.
- **Interface:** setting the interface size in Preferences.

Not a priority for now: signing the Mac (and Windows) installers, Flathub.

## Out of scope and risks

- **No 3D, video or animation** before v1.0: those belong to other software (After Effects, Blender).
- **AI and PSD files:** the recent AI format can only be read through its PDF part, and complex PSDs (smart objects, proprietary effects) will be opened as an approximation.
- **Pixel performance:** large images (more than 50 megapixels) and fast brushes push WebGL 2 and the browser's memory. We test this from v0.4, with WebGPU as an option if needed.
- **CMYK**: neither the browser nor Tauri offers native support for it, so a color engine has to be bundled (lcms compiled to WASM).
- **"Smart" features:** automatic cutout and fill require heavy local models, hence their postponement to v1.0.
