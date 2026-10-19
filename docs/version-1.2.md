# Version 1.2

Version 1.2 reworks every tool in the Vector, Pixel and Layout workspaces and brings it up to Affinity's level: same gestures, same shortcuts, same options in the context bar, with Poulpe Design's own look. Files stay in format 7: the new features only add optional fields. 1.1.5 installations update themselves.

## Version 1.2.10

- **Project as PSD**: File › Save as PSD (Photoshop, Affinity)… produces a real Photoshop file, one layer per object, that Photoshop and Affinity open. The full Poulpe Design document is stored inside it: Poulpe Design reopens it with its shapes, text and effects still editable, and Ctrl+S saves it again as PSD. For a document with several artboards, Photoshop shows the active one.
- **Reminder**: File › Open already reads PSD files (layers), Illustrator files saved with PDF compatibility, and PDFs. Affinity files (.afdesign, .afphoto) cannot be opened because their format is not published; export them to PSD from Affinity.

## Version 1.2.9

- **Share your brushes**: Brush panel › Share my brushes… saves your brushes and their shapes in a `.poulpebrushes` file.
- **Install brushes**: from the Brush panel or Extensions › Manage extensions… › Install brushes…, for a `.poulpebrushes`, Photoshop `.abr` or Affinity `.afbrushes` file (shapes only, since Affinity's format is not published). Each pack can be removed with one click.

## Version 1.2.8

- **Brush creation**: Brush panel › Create a brush…, or View › Brush creation. The window stays open while you try the brush on the document, and closes with one click.
- **Shape from an image**: the dark parts of the image paint (or the opaque parts of a transparent PNG).
- **Photoshop brushes**: import the shapes from an .abr file.
- **Settings**: spacing, angle, roundness, random size and angle, scatter; the brush is saved as a preset together with its shape.

## Version 1.2.7

- **Colour wheel picker**: double-click the fill or stroke (tool column or context bar), or View › Colour picker; the window can be placed anywhere.
- **No colour**: a button in the tool column, the context bar and the picker.
- **Layers**: the eye that hides or shows a layer is always visible.
- **New logo**: the dark octopus on a pink background, in the app and its icons.
- **Brush size**: Alt + right-drag while using the brush, as in Photoshop (Ctrl + Alt + drag, as in Affinity, still works).

## Version 1.2.6

- **Merge**: right-click layers › Merge (union, subtract, intersect, exclude, divide, or into a single image with Ctrl+E); dropping a layer onto another also offers to group or merge them.
- **Group and delete**: Group and Delete buttons under the layer list, in every Persona.
- **Artboards**: right-click an artboard in the layers to add one or delete it.

## Version 1.2.5

- **Panels**: each panel (Layers, Brush, History…) detaches on its own when you drag its tab out of the group, or with a double-click on the tab; dropped back on the Studio, it returns to its place.
- **Interface size**: Preferences › Display, from 80% to 200%, to enlarge menus, panels and text in the desktop app.

## Version 1.2.4

- **Menus on Mac**: File, Edit, Layer… move to the bar at the top of the screen, next to the Apple menu, with the same shortcuts; Preferences and About are in the "Poulpe Design" menu, and a Window menu is added.
- **Windows and Linux**: the menus are in the window's title bar, next to the minimise, maximise and close buttons; drag the bar to move the window, double-click it to maximise.

## Version 1.2.3

- **Templates**: 9 new social media templates (TikTok, poll and recipe stories, carousel, contest, article, X, LinkedIn and video channel banners).
- **Formats**: screens from HD 720p to 8K (Full HD, 2K, 4K, cinema 4K, 5K, 6K, 8K, ultra-wide, tablet, web page), print from A0 to A6, B4, B5, US formats, flyers, posters, photos, business cards; new social formats (banners, vertical video, profile picture…).
- **My templates**: File › Save as template keeps the document in the app; the home screen offers it under "My templates", where each template can be exported as a `.poulpemodele` file and other people's templates imported.
- **Launcher**: the Start menu, the desktop, and the Linux and macOS application menus show "Poulpe Design" (the internal name "Poulpe" stays, so updates find the installed app).

## Version 1.2.2

- Code reorganised with no visible change: the five largest files are split into small modules, and ESLint checks the code on every change.

## Version 1.2.1

- **Node tool**: clicking a straight segment adds the node exactly under the mouse (it used to land a little further along the line).

## All workspaces

- The same key cycles through the tools of a family (U for shapes, M for rectangle and ellipse selection, J for retouching tools…).
- Holding a key down takes the tool for the duration of the gesture; releasing it returns to the previous one.
- Keys 1 to 0 set the opacity of the selected object or of the brush.

## Vector

- **Shapes**: rounded rectangle, triangle, arrow, callout, donut, pie, cog, cloud, heart and spiral, with their red handles on the canvas (rounding, number of sides…) and a different rounding on each corner, editable at any time (rounded, concave, chamfered).
- **Move**: Ctrl to scale from the centre, Alt-click to pick the object underneath, double-click a curve for the Node tool, auto-select, origin point, align and group in the bar, duplicate that repeats the last move. Handles to resize the artboard on the canvas.
- **Pen** in Smart, Polygon and Line modes, with a preview of the next segment and continuing an open path. **Pencil** with smoothing, pressure and auto-close. Freehand **Knife**.
- **Vector brush** [B], **fill a closed area** [R], **shape builder** that adds or removes overlapping areas, **vector crop** and **style picker**.
- **Fill** [G]: radial, elliptical, conical and bitmap gradients, with points editable on the canvas. **Transparency** [Y] separate from colour. **Stroke** [O] and **stroke width** [W] editable afterwards.
- **Text**: drag to choose the size, click a curve to type along the path, text frame separate from artistic text, bar with bold, italic, underline, alignment, line spacing, lists and styles.

## Pixel

- **Crop** [C] with straighten, ratios and grids, **gradient** [G], **quick mask** [Q].
- **Sponge**, **background eraser**, **flood eraser**, **colour replacement** [R], **patch**, **blemish removal** and **red eye** [J].
- **Brushes**: Shift-click for a straight line, Alt-drag for the colour picker, flow, hardness and size set from the keyboard or by dragging on the canvas, stabiliser, blend mode, protect alpha, Brushes panel.
- **Selections**: from the centre, antialiased edges, Refine; a single lasso [L] for freehand, polygonal or magnetic; tolerance set by dragging. Dodge and burn on shadows, midtones or highlights.

## Layout

- The Layout workspace has its own tools, like Publisher: text frame, artistic text and table on the T key, rectangle and ellipse picture frames on the F key.
- **Text**: full bar (justify, vertical alignment, columns, Ctrl+B, I and U), text wrap around images and shapes, auto flow that adds pages and frames until all the text fits, text frame that takes the shape of a clicked shape, insets.
- **Images**: the fit (fill, fit, stretch, none) is kept when the frame is resized, Replace image button, zoom and move the image inside its frame; click for actual size, drag for a chosen size, several images at once.
- **Pages**: multiple page selection, Add pages and Apply master windows, edit a master item on a page, detach the master.

## Code organisation

Each tool family lives in its own folder, `apps/editor/src/tools/<family>/` (shapes, move, paths, paint, text, frames, pixel, brushes, text flow). A folder exports a `ToolModule` (`tools/types.ts`): its canvas gestures, its context bar and its translations. `tools/registry.ts` gathers them, and the canvas controller consults them before the base tools. Shared geometry lives in `packages/core` (`shapes.ts`, `frames.ts`, `tables.ts`, `pixelTools.ts`, `textWrap.ts`, `autoFlow.ts`…), tested separately; each family has its own end-to-end tests (`apps/editor/e2e/v12-*.spec.ts`).
