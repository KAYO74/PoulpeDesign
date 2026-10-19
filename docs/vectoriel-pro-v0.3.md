# Pro vector v0.3: status and code layout

October 5, 2026

v0.3 gives Poulpe Design the vector drawing tools of Illustrator and Affinity Designer: drawing and editing curves, combining shapes, fine-tuning strokes, adding effects, writing along a curve and opening SVG files.

## What the user sees

- **Pen** (P). A click places a sharp node, a drag places a curve. Clicking the first node closes the path, Enter or Esc leaves it open, Backspace removes the last node.
- **Pencil** (N). Freehand drawing, smoothed on release. The "Smoothing" slider in the context toolbar sets how strong the smoothing is.
- **Node tool** (A, formerly "Direct selection"). On a path, it shows the nodes and their handles. You move a node or a handle, click a segment to add a node, drag a segment to bend it; Delete removes the chosen nodes, and a double-click switches a node between sharp and smooth. The context toolbar offers Sharp, Smooth, Delete and Close / open. On a shape that is not a path, it offers "Convert to Curves".
- **Geometry** (Layer > Geometry and five toolbar buttons): add (union), subtract, intersect, xor (exclude) and divide. As in Affinity, the result takes the style of the bottom object.
- **Layer**: Convert to Curves (Ctrl+Enter, texts included), Expand Stroke (the stroke becomes a filled shape) and Offset Path… (grow or shrink a shape by a given distance).
- **Stroke panel**: solid or dashed style (with dash and gap lengths), caps, joins, and arrowheads at the start and end of open paths.
- **Effects panel** (new Studio tab): drop shadow, inner shadow, outer glow, inner glow and Gaussian blur, each with its checkbox, color, opacity, offset and softness. Effects also show up in PNG, JPEG and SVG exports; in PDF, an object carrying an effect is included as an image.
- **Text on path** (Text menu): select a text and a shape, then "Put Text on Path". On a circle, the text starts at the top and is centered. A slider in the context toolbar slides it along the curve, and "Remove Text from Path" flattens it again. The text stays editable and can also be converted to curves.
- **SVG import**: File > Import Image or SVG…, or drag and drop. The SVG comes in as editable objects (paths, shapes, simple texts, gradients, embedded images), grouped and scaled down if they exceed the artboard.

## Code layout

| Where                                     | What                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/bezier.ts`             | Bézier curve math: point, split, exact bounding box, nearest point, flattening.                                              |
| `packages/core/src/pathEdit.ts`           | Path editing model (subpaths, nodes, handles) and its operations.                                                            |
| `packages/core/src/vector.ts`             | Strokes (caps, dashes, arrowheads), conversion to path, text-on-path layout.                                                 |
| `packages/core/src/boolean.ts`            | Boolean operations, offset, expand stroke and smoothing, with [Paper.js](http://paperjs.org) (MIT) and paperjs-offset (MIT). |
| `packages/core/src/effects.ts`            | Default effect settings and the margin they add around an object.                                                            |
| `packages/core/src/svgImport.ts`          | Reading an SVG file into Poulpe Design objects.                                                                              |
| `packages/core/src/svg.ts`                | SVG export: advanced strokes, arrowheads, effect filters, text on path.                                                      |
| `packages/render/src/index.ts`            | Rendering of advanced strokes, text on path and effects (offscreen layers).                                                  |
| `apps/editor/src/canvas/pathTools.ts`     | Pen, pencil and Node tool.                                                                                                   |
| `apps/editor/src/vectorActions.ts`        | What the vector commands do to the document.                                                                                 |
| `apps/editor/src/textToCurves.ts`         | Converting a text to curves from its font file, with [opentype.js](https://opentype.js.org) (MIT).                           |
| `apps/editor/src/panels/StrokePanel.tsx`  | Stroke panel.                                                                                                                |
| `apps/editor/src/panels/EffectsPanel.tsx` | Effects panel.                                                                                                               |

The file format moves to version 3 (see [format-poulpe.md](format-poulpe.md)). All new fields are optional: files from versions 1 and 2 open unchanged.

## Choices and deviations

- **No CanvasKit yet.** The roadmap planned to switch rendering to CanvasKit in v0.3 for boolean operations. Paper.js handles them very well without touching the renderer, and the current Canvas 2D draws all the new strokes and effects. CanvasKit would add 7 MB and a performance question that is still open on Linux; we are keeping it for when it brings a real gain (photo editing in v0.4, or large files).
- **Postponed to a v0.3.x:** symbols, layer and text styles, conical and mesh gradients, patterns, variable width and multiple strokes, advanced OpenType, columns and text wrap, Shape Builder, scissors, knife, corner tool, bevel. SVG import currently ignores masks, clipping paths and filters.

## Tests

- `packages/core/test/v03.test.ts`: path editing, boolean operations, offset, SVG import and export, text on path, conversion to curves.
- `apps/editor/e2e/vector.spec.ts`: pen, Node tool, pencil, geometry, conversion and offset, dashes, arrowheads and effects, text on a circle then converted to curves, SVG import.
