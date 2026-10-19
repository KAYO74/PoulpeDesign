# Photo editing v0.4: status and code layout

October 5, 2026

v0.4 adds a **Photo Persona** to Poulpe Design, as in Affinity Photo: you retouch a photo with brushes, selections, a magic eraser, adjustment layers, filters and masks. Everything runs on your computer, offline and without any paid service.

## What the user sees

- **Personas.** The buttons at the top left of the toolbar switch from the Draw Persona to the Photo Persona. Each one has its own tools, shortcuts, Studio tabs and buttons. File > Open photo… (Ctrl+Alt+O, or from the welcome screen) creates a document the size of the photo and switches to the Photo Persona.
- **Photo Persona tools** (right-hand column):
  - Rectangular marquee (M), elliptical marquee, lasso (L) and magic wand (W). Shift adds to the selection, Alt subtracts, Shift+Alt keeps the intersection; the context toolbar offers the same modes, plus feather, tolerance and "Contiguous". The selection is shown as marching ants.
  - Brush (B), eraser (E) and paint bucket (G). The brush follows stylus pressure. Size, hardness, opacity and flow are set in the context toolbar and in the Brush tab; [ and ] change the size, X swaps the two colors, D resets to black and white. Painting with no pixel layer selected creates one.
  - **Magic eraser** (J): paint over what should disappear (in red), release, and Poulpe Design replaces it with its surroundings. Edit > Content-aware fill does the same on the selection.
  - Clone stamp (S, Alt+click to pick the source), dodge and burn (O), blur and sharpen brushes (R).
  - Text, color picker (which picks the brush color), hand and zoom, as in the Draw Persona.
- **Select menu**: select all (Ctrl+A), deselect (Ctrl+D), invert (Ctrl+Shift+I), feather, grow, shrink, selection from layer.
- **Pixel layers**: new pixel layer (Ctrl+Shift+N), copy selection to new layer (Ctrl+J), clear the selection (Delete), rasterize, merge visible layers into a new layer (Ctrl+Alt+Shift+E).
- **Adjustment layers** (Adjustments menu, toolbar button, Layers panel): brightness and contrast, levels, curves (per channel, with histogram), exposure, hue-saturation-lightness, vibrance, white balance, color balance, black and white, photo filter, gradient map, invert, threshold, posterize, and auto levels. They affect every layer below them, can be adjusted at any time in the Studio's Adjustment tab, and are dialed in with opacity.
- **Filters**: Gaussian blur, unsharp mask, clarity, add noise, vignette and pixelate. The Filters menu applies them to the layer's pixels with a live preview; Adjustments > Live filters adds them as layers that stay editable at any time.
- **Layer masks** (Layer > Mask menu, toolbar button): add (from the selection if there is one), enable or disable, invert, delete. Clicking the mask thumbnail in the Layers panel switches to "paint in mask" mode: black hides, white reveals.
- **Histogram tab** in the Studio, in the Photo Persona.

Retouching is undone with Ctrl+Z like everything else, is saved in the `.poulpe` file and shows up in PNG, JPEG, SVG and PDF exports.

## Code layout

| Where                                         | What                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/adjust.ts`                 | Pixel adjustments and filters (lookup tables, curves, blur, sharpening…), histogram, auto levels.             |
| `packages/core/src/inpaint.ts`                | The magic eraser: rebuilds an area with multi-scale PatchMatch (Barnes 2009, Wexler 2007), with no AI model.  |
| `packages/core/src/pixelMask.ts`              | Magic wand (tolerance-based fill) and selection outline.                                                      |
| `packages/render/src/bitmaps.ts`              | Retouched pixels stay in memory and are encoded to PNG in the background; they are written out before saving. |
| `packages/render/src/index.ts`                | Rendering of masks and adjustment layers (with cache).                                                        |
| `apps/editor/src/photo/photoTools.ts`         | Selection tools, brushes, magic eraser, clone stamp, paint bucket.                                            |
| `apps/editor/src/photo/photoActions.ts`       | Commands: masks, adjustment layers, filters, pixel layers, opening a photo.                                   |
| `apps/editor/src/photo/selection.ts`          | The pixel selection (a mask at the photo's resolution) and its operations.                                    |
| `apps/editor/src/photo/pixels.ts`             | Conversion between document coordinates and a layer's pixels, recording changed pixels in the history.        |
| `apps/editor/src/photo/inpaint.worker.ts`     | The magic eraser runs in a Web Worker, so the interface stays responsive during the computation.              |
| `apps/editor/src/panels/AdjustmentPanel.tsx`  | Adjustment tab (sliders, curves editor, histogram).                                                           |
| `apps/editor/src/components/PhotoContext.tsx` | Context toolbar for the photo tools.                                                                          |

The file format moves to version 4 (see [format-poulpe.md](format-poulpe.md)): adjustment layers and masks. Files from versions 1 to 3 open unchanged.

## Choices and deviations

- **Magic eraser without AI.** It rebuilds the area from pieces of the photo itself (the method behind Photoshop's "content-aware fill" before AI). It is free, offline and fast (one to two seconds for an average object). It is very good on backgrounds (sky, grass, walls, sand) and small objects; it is less good at inventing large structures (a face, a hidden building). A version based on a local AI model (LaMa) may be added later as an option.
- **Postponed:** automatic background removal and subject selection (local AI models, planned for v1.0), quick selection, polygonal lasso, healing brush, smudge, liquify and warps, LUTs, straighten, perspective, image size and canvas size.
- **Known limitations:** adjustment layers only apply the normal blend mode; the pixel selection is not part of the history (Ctrl+Z undoes retouching, not selections); a mask placed on a group follows its bounding box and can shift if the group changes size.
- **No CanvasKit or WebGL yet.** Canvas 2D is enough for 20 to 30 megapixel photos; adjustments are computed on the visible area, at screen resolution, and cached.

## Tests

- `packages/core/test/v04.test.ts`: every adjustment, blur, sharpening, vignette, pixelate, noise, histogram and auto levels, magic wand and outline, magic eraser (plain background, stripes, pixels outside the area left intact), saving a file with a mask and an adjustment, opening a version 3 file, SVG export of a mask.
- `apps/editor/e2e/photo.spec.ts`: switching Persona, brush and eraser on a new layer, rectangular selection and clearing, magic wand, magic eraser, adjustment layer and mask, saving then reopening, exports, Gaussian blur.
