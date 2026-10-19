# Missing Photoshop and Affinity tools (v0.6): status and code organization

October 5, 2026

Versions 0.3 and 0.4 had left out a series of tools in order to move faster on the essentials. v0.6 adds them: everything the previous versions listed as "postponed" in vector and photo editing is in place, and the two known limitations of v0.4 are lifted.

## What the user sees

### Photo Persona

- **Polygonal lasso** (P): click the vertices; a double-click or Enter closes the selection.
- **Quick selection** (Q): paint over the subject, and the selection extends to neighboring pixels of the same color.
- **Healing brush** (Y): Alt+click picks the source, then paint; the source's texture is applied while keeping the lighting of the corrected area (frequency separation), which removes a wrinkle or a speck of dust without a visible blotch.
- **Smudge** (U): drags colors like a finger through wet paint.
- **Liquify** (K): push, twirl, bloat or pinch pixels, chosen in the context toolbar.
- **Straighten**: draw a line along something that should be horizontal, and the photo rotates by that amount.
- **Perspective**: four corner handles; place them on a real rectangle (a building front, a painting) and the image is straightened.
- **LUT**: a new adjustment layer. Six looks are built in (teal and orange, warm film, cool, faded, sepia, high-contrast black and white) and a `.cube` file from another program opens directly.
- **Image Size** and **Canvas Size** (Document menu): the first resamples, the second enlarges or crops the artboard around an anchor.
- **Pixel selection is now part of the history**: Ctrl+Z undoes a selection like a retouch.
- **Adjustment layers apply all blend modes**, not just "normal".

### Draw Persona

- **Scissors** (C): a click on a shape's outline opens it at that point (the shape becomes a curve).
- **Knife** (K): draw a line across a shape and it becomes two separate objects. With nothing selected, the knife cuts everything the line crosses; an open path is simply split into pieces.
- **Corner tool** (X): drag from a corner to round it, Alt for all the corners of the path at once. The context toolbar chooses between rounded and chamfer, and a radius applied with a single click.
- **Shape Builder** (U): draw a line across several shapes to merge them, Alt to subtract.
- **Symbols** (Layer > Symbols and styles menu, Library > Styles panel): create a symbol from the selection, place more instances, update the symbol from an instance, detach an instance. Editing the symbol updates all its instances.
- **Saved styles** (same place): "Save style" stores the appearance of the selected object (fill, strokes, effects, opacity, blend mode, and character settings for text); one click applies it elsewhere.
- **Conic gradient** and **pattern** in the Color tab: the conic gradient turns around an adjustable center, the pattern repeats an image at the chosen size and angle.
- **Multiple and variable-width strokes** in the Stroke tab: "Extra strokes" stacks several lines under the main stroke (a double border in one go), "Width" gives a calligraphic profile (pointed at both ends, swelling, pinched…), "Align" places the line at the center, inside or outside the path.
- **Bevel and emboss** in the Effects tab: depth, light angle, softening, intensity, highlight and shadow colors.
- **Text columns** and **OpenType features** in the Character tab: number of columns and gutter for a fixed-width frame; small caps, ligatures, old-style figures, fractions and stylistic alternates.

Everything can be undone with Ctrl+Z, is saved in the `.poulpe` file and appears in PNG, JPEG, SVG and PDF exports.

## Code organization

| Where                                     | What                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/lut.ts`                | 3D lookup tables: reading and writing `.cube` files, compact storage in the document, computed looks.                |
| `packages/core/src/retouch.ts`            | Retouching math: homography and perspective correction, liquify warps, healing brush, resampling.                    |
| `packages/core/src/pathCut.ts`            | Scissors (cutting a path at a point), knife on an open path, Corner tool (rounded and chamfer).                      |
| `packages/core/src/boolean.ts`            | `applyKnife` cuts a filled shape in two by intersecting it with two half-planes.                                     |
| `packages/core/src/strokeProfile.ts`      | Variable-width strokes: offered profiles and stroke converted to a filled shape.                                     |
| `packages/core/src/symbols.ts`            | Symbols: an instance's content mapped into its box, list of instances.                                               |
| `packages/core/src/styles.ts`             | Saved styles: taking an object's appearance, applying it to another.                                                 |
| `packages/core/src/editor.ts`             | `setExtraState` and `mark`: the history can carry state that is not in the document (the pixel selection).           |
| `packages/core/src/text.ts`               | Text columns and OpenType features in line breaking.                                                                 |
| `packages/core/src/svg.ts`                | Export of the conic gradient (as sectors), patterns, bevel, variable strokes and symbol contents.                    |
| `packages/render/src/index.ts`            | Rendering: conic and pattern paints, multiple and variable strokes, bevel, symbol instances, adjustment blend modes. |
| `apps/editor/src/photo/photoTools.ts`     | Polygonal lasso, quick selection, healing brush, smudge, liquify, straighten, perspective.                           |
| `apps/editor/src/photo/retouchActions.ts` | LUT, image size and canvas size commands.                                                                            |
| `apps/editor/src/photo/selection.ts`      | The pixel selection, copied as runs to fit in the history.                                                           |
| `apps/editor/src/canvas/pathTools.ts`     | Scissors, knife, Corner tool and Shape Builder on the canvas.                                                        |
| `apps/editor/src/symbolActions.ts`        | Symbol and saved style commands.                                                                                     |
| `apps/editor/src/vectorActions.ts`        | Extra strokes, width profiles, patterns.                                                                             |

The file format moves to version 7 (see [format-poulpe.md](format-poulpe.md)): `symbol` objects, the document's `symbols` and `styles`, `conic` and `pattern` paints, `align`, `profile` and `strokes` on strokes, `bevel` effect, `features` and `columns` on text, `lut` adjustment. Files from versions 1 to 6 open unchanged.

## Choices and deviations

- **The knife on a filled shape uses Boolean operations.** Cutting a shape in two amounts to intersecting it with two very large half-planes, one on each side of the line: the result is correct even on shapes with holes or several subpaths, without writing yet another geometric splitting routine.
- **Conic gradient.** The browser canvas can draw it (`createConicGradient`); where it cannot, Poulpe Design replaces it with sectors. SVG has no conic gradient at all: the export also approximates it with sectors, visually identical.
- **OpenType features: only `smcp`, `c2sc` and `kern` change the text on screen**, because Canvas 2D cannot enable the others. The others are kept in the document and applied in SVG and PDF export as well as when converting to curves; the Character tab says so when this is the case.
- **Variable-width strokes.** The stroke becomes a filled shape computed by Poulpe Design, so that the canvas and the SVG produce exactly the same drawing. Dashes and arrowheads do not apply to a variable-width stroke.
- **Bevel.** The relief is simulated with two offset copies of the shape, one lit and one shaded, clipped inside the shape. This is a layer-effect approach, not a lighting calculation: the result is crisp and fast, without WebGL.
- **Mesh fill:** not in this version. A real mesh gradient requires a grid of control points and dedicated rendering; conic, radial and pattern fills cover most needs in the meantime.
- **Postponed (v1.0):** image vectorization, local AI cutout, macros and extensions, automatic updates.

## Tests

- `packages/core/test/v06.test.ts`: LUT tables (reading `.cube`, round trip, interpolation, looks), homography and perspective correction, liquify, healing brush, resampling, pixel selection in the history, adjustment layer blend modes.
- `packages/core/test/v07.test.ts`: scissors, knife (open path and filled shape), Corner tool, width profiles, symbols (instances, SVG, missing symbol), saved styles (objects and text), text columns, OpenType features, saving and reopening a version 7 file, opening a version 6 file.
- `apps/editor/e2e/photo-pro.spec.ts`: polygonal lasso, quick selection, undoing a selection, healing brush, liquify, straighten, perspective, LUT look, image size.
- `apps/editor/e2e/vector-pro.spec.ts`: scissors, knife, Shape Builder, Corner tool, symbols (create, place, detach), saved styles, extra strokes and profile, bevel and conic gradient, columns and small caps.
