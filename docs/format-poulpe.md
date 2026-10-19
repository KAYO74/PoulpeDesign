# `.poulpe` file format (version 4)

A Poulpe Design document is a ZIP archive. Everything in it can be read with standard tools: any unzip program is enough to recover the original images and the document as JSON.

```
poster.poulpe (ZIP)
├── manifest.json        format version, source app, file list (uncompressed, first)
├── document.json        the document
├── assets/images/       imported images as they are (never recompressed), edited pixels and masks (PNG)
└── thumbnail.png        preview of the first artboard, 256 px at most (optional)
```

The reading and writing code is in [`packages/core/src/file.ts`](../packages/core/src/file.ts), and the types in [`packages/core/src/types.ts`](../packages/core/src/types.ts).

## manifest.json

```json
{
  "format": "poulpe",
  "version": 4,
  "generator": "Poulpe Design 0.2.0",
  "created": "2026-10-04T09:43:00.000Z",
  "files": ["document.json", "assets/images/img_1a2b3c.png", "thumbnail.png"]
}
```

## document.json

| Field        | Type             | Content                                                                                                                  |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `format`     | `"poulpe"`       | Always `poulpe`.                                                                                                         |
| `version`    | integer          | Format version. Poulpe Design migrates older versions and cleanly refuses a version newer than its own.                  |
| `id`, `name` | text             | Stable identifier and name of the document.                                                                              |
| `artboards`  | list             | Artboards, each with `x`, `y`, `width`, `height`, `background` (paint) and `children`.                                   |
| `swatches`   | list of colors   | Document swatches.                                                                                                       |
| `assets`     | object           | Images, by identifier: `mime`, `width`, `height` and `path` in the archive.                                              |
| `guides`     | object, optional | Guides dragged from the rulers: `x` (vertical guides) and `y` (horizontal guides), lists of positions in document space. |
| `layout`     | object, optional | Layout and printing (version 4), see below.                                                                              |

All coordinates are in pixels in document space: an object is not relative to its artboard. Each object is an `x`, `y`, `width`, `height` box rotated by `rotation` degrees around its center. `children` lists go from bottom to top.

### Pages and master pages (version 5)

A page is an artboard; the page order is that of `artboards`. Two optional fields are added to artboards:

| Field      | Content                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `master`   | `true`: master page. It is not a page (no number, not exported with "all pages").                                   |
| `masterId` | Identifier of this page's master page. Its objects are drawn beneath those of the page, at the same relative place. |

Document `layout`:

| Field         | Content                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| `dpi`         | Pixels per inch (96 if absent). Gives the real size of pages when printing and in the PDF.  |
| `bleed`       | Bleed around each page, in pixels.                                                          |
| `margins`     | `{ "top", "bottom", "inside", "outside" }` in pixels; `inside` is on the binding side.      |
| `facing`      | `true`: facing pages (page 1 alone on the right, then spreads; even pages are on the left). |
| `firstNumber` | Number of the first page (1 if absent).                                                     |

Version 6, for printing (optional):

| Field       | Content                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `colorMode` | `"rgb"` (default) or `"cmyk"`: the document is meant for a print shop (CMYK input, proofing, CMYK PDF). |
| `cmyk`      | Exact CMYK values entered by the user, per color: `{ "#00a0e6": [100, 0, 0, 0] }` (from 0 to 100).      |

### Objects

Common fields: `id`, `name`, `x`, `y`, `width`, `height`, `rotation`, `opacity` (0 to 1), `blendMode`, `visible`, `locked`, `effects` and `mask` (optional, see below).

| `type`       | Specific fields                                                                   |
| ------------ | --------------------------------------------------------------------------------- |
| `rect`       | `fill`, `stroke`, `cornerRadius`                                                  |
| `ellipse`    | `fill`, `stroke`                                                                  |
| `polygon`    | `fill`, `stroke`, `sides`                                                         |
| `star`       | `fill`, `stroke`, `points`, `innerRatio`                                          |
| `path`       | `fill`, `stroke`, `d`, `viewBox`, `fillRule` (optional)                           |
| `line`       | `stroke`, `direction` (1: top left to bottom right, -1: bottom left to top right) |
| `text`       | `text`, `style`, `fill`, `stroke`, `autoWidth`, `runs` and `path` (optional)      |
| `image`      | `assetId`, `crop` (optional)                                                      |
| `group`      | `children`, `clip` (the bottom object serves as a clipping mask)                  |
| `adjustment` | `adjustment`: dynamic adjustment or filter (see "Adjustment layers")              |
| `symbol`     | `symbolId`: instance of a document symbol (version 7, see "Symbols")              |

Text `style`: `fontFamily`, `fontSize`, `fontWeight`, `italic`, `align` (`left`, `center`, `right`, `justify`), `lineHeight` (multiplier), `letterSpacing` (px), `underline`, `strike`, `uppercase`. Optional (version 7): `features`, the list of active OpenType features (`smcp`, `c2sc`, `kern`, `liga`, `dlig`, `onum`, `tnum`, `frac`, `ss01`), and `columns`, the columns of the block: `{ "count": 2, "gap": 16 }` (`gap` in pixels). A reader that does not know them shows the text in a single column, without these features: the document remains correct.

Text `runs`: per-character styles, sorted and non-overlapping. Each range is `{ "start": 8, "end": 12, "style": { … } }`: it covers characters `start` to `end - 1` (UTF-16 indices into `text`) and only contains what differs from the text's `style`, among `fontFamily`, `fontSize`, `fontWeight`, `italic`, `underline`, `strike`, `letterSpacing` and `color` (a solid color that replaces the fill). Alignment, line height and capitals apply to the whole text.

Path `d`: SVG path data (commands `M L H V C S Q T A Z`, absolute or relative), in the `viewBox` coordinate system (`{ "x", "y", "width", "height" }`). The path is stretched to fill the object's box. `fillRule` is `nonzero` (default) or `evenodd`.

Text `frame` (version 4): `true` for a text frame, whose height stays fixed; text that does not fit is hidden, or flows into the next frame. `next`: identifier of the next frame in a chain of linked frames. The first frame of the chain holds the text, its style and its ranges; the `text` of the following frames is ignored (empty).

Text fields (version 4): `{page}` is replaced on display by the page number, `{pages}` by the number of pages. On a master page, they display as "#"; on a page that uses it, they take that page's values.

Text `path`: curve the text follows, `{ "d", "viewBox", "offset" }`. `d` and `viewBox` are read like those of a path, stretched over the text's box. `offset` (0 to 1) places the text along the curve: its start if left-aligned, its middle if centered, its end if right-aligned. Text on a path does not wrap.

Image `crop`: part of the source image shown in the object's box, `{ "x", "y", "width", "height" }` as fractions (0 to 1) of the image. Without `crop`, the whole image fills the box.

`blendMode`: `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity` (same names as in CSS).

### Paints

Colors are in hexadecimal `#rrggbb` or `#rrggbbaa`.

```json
{ "type": "none" }
{ "type": "solid", "color": "#2ba59a" }
{ "type": "linear", "angle": 90, "stops": [{ "offset": 0, "color": "#2ba59a" }, { "offset": 1, "color": "#ffffff" }] }
{ "type": "radial", "cx": 0.5, "cy": 0.5, "r": 0.5, "stops": [ … ] }
{ "type": "conic", "angle": 0, "cx": 0.5, "cy": 0.5, "stops": [ … ] }
{ "type": "pattern", "assetId": "img_…", "scale": 1, "angle": 0 }
```

The angle of a linear gradient is in degrees (0: left to right, 90: top to bottom) and the gradient line covers the whole box, as in CSS. The center and radius of a radial gradient are fractions of the box (the radius, of its largest dimension).

A conic gradient (version 7) turns around its center: `angle` gives the direction of stop 0, and the stops' `offset` values are fractions of a full turn. A pattern (version 7) repeats the `assetId` image; `scale` multiplies the tile size and `angle` rotates it. The exported SVG approximates a conic gradient with sectors, since SVG has none.

A stroke is `{ "paint": <paint>, "width": <px> }`, centered on the path. Optional fields (version 3):

| Field          | Values                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `cap`          | `butt`, `round` (default), `square`: line ends                                                         |
| `join`         | `miter`, `round` (default), `bevel`: line joins                                                        |
| `dash`         | alternating dash / gap lengths, in multiples of the width (`[3, 2]`); absent: solid line               |
| `start`, `end` | `none`, `triangle`, `arrow`, `circle`, `square`, `bar`: arrowhead at the start and end of an open path |
| `align`        | `center` (default), `inside`, `outside`: position of the stroke relative to the path (version 7)       |
| `profile`      | variable width: multipliers of the width from the start (0) to the end (1), `[0.05, 1, 0.05]` (v. 7)   |

An object can also carry `strokes` (version 7): strokes drawn **beneath** its `stroke`, from the first to the last in the list. A reader that does not know `strokes` shows only the main stroke.

### Effects

`effects` is a list of at most one effect of each type, drawn in this order: drop shadow and outer glow beneath the object, the object itself (blurred by `blur`), then inner shadow and inner glow inside the object. Each effect has `type` and `enabled` (a disabled effect is kept with its settings). Colors with transparency (`#rrggbbaa`), distances in pixels.

```json
{ "type": "dropShadow", "enabled": true, "color": "#00000066", "x": 4, "y": 6, "blur": 10 }
{ "type": "innerShadow", "enabled": true, "color": "#00000066", "x": 2, "y": 3, "blur": 6 }
{ "type": "outerGlow", "enabled": true, "color": "#ffd166cc", "blur": 12 }
{ "type": "innerGlow", "enabled": true, "color": "#ffffffaa", "blur": 8 }
{ "type": "blur", "enabled": true, "radius": 4 }
{ "type": "bevel", "enabled": true, "style": "bevel", "angle": 135, "depth": 6, "softness": 4, "intensity": 70, "light": "#ffffff", "shadow": "#000000" }
```

The bevel (version 7) simulates relief lit from `angle` degrees: `depth` in pixels, `softness` softens the edge, `intensity` (0 to 100) balances light and shadow. `style` is `bevel` (raised outward) or `emboss` (inward).

### Layer masks

`mask` is `{ "assetId": "img_…", "enabled": true }`. The referenced image (PNG) is stretched over the object's box, like an image; only its opacity counts: where it is opaque the object is visible, where it is transparent the object is hidden. A disabled mask (`enabled: false`) is kept but has no effect.

An edited `image` object (brush, eraser, magic eraser, filters) simply points to a new PNG image in `assets`: the original image is never modified in place.

### Adjustment layers

An `adjustment` object modifies everything beneath it in the same parent (artboard or group), without touching the pixels: it can be tweaked, hidden or deleted at any time. Its `opacity` sets the strength of the effect, its `mask` limits it to an area. The `adjustment` field has a `kind` and its settings:

| `kind`               | Settings                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `brightnessContrast` | `brightness`, `contrast` (−100 to 100)                                                         |
| `levels`             | `black`, `white`, `outBlack`, `outWhite` (0 to 255), `gamma` (0.1 to 10)                       |
| `curves`             | `rgb`, `r`, `g`, `b`: `[input, output]` points from 0 to 1                                     |
| `exposure`           | `exposure` (EV, −5 to 5), `offset`, `gamma`                                                    |
| `hsl`                | `hue` (−180 to 180), `saturation`, `lightness` (−100 to 100)                                   |
| `vibrance`           | `vibrance`, `saturation` (−100 to 100)                                                         |
| `whiteBalance`       | `temperature`, `tint` (−100 to 100)                                                            |
| `colorBalance`       | `shadows`, `midtones`, `highlights`: `[cyan↔red, magenta↔green, yellow↔blue]` from −100 to 100 |
| `blackWhite`         | `red`, `green`, `blue`: share of each channel in %                                             |
| `photoFilter`        | `color`, `density` (0 to 100)                                                                  |
| `gradientMap`        | `stops`: gradient stops, from darkest to lightest                                              |
| `invert`             | (none)                                                                                         |
| `threshold`          | `level` (0 to 255)                                                                             |
| `posterize`          | `levels` (2 to 32)                                                                             |
| `gaussianBlur`       | `radius` (document px)                                                                         |
| `unsharpMask`        | `amount` (%), `radius` (px), `threshold` (0 to 255)                                            |
| `clarity`            | `amount` (−100 to 100)                                                                         |
| `noise`              | `amount` (%), `monochrome`                                                                     |
| `vignette`           | `amount` (−100 to 100), `size`, `softness` (0 to 100)                                          |
| `pixelate`           | `size` (document px)                                                                           |

Software that does not know adjustment layers can ignore them: the rest of the document remains correct, only the corrections are missing.

Since version 7, the `blendMode` of an adjustment layer is applied like that of an ordinary object.

### Symbols and saved styles (version 7)

`symbols` holds the document's symbols, by identifier:

```json
"symbols": {
  "sym_a1": {
    "id": "sym_a1",
    "name": "Puce",
    "box": { "x": 0, "y": 0, "width": 24, "height": 24 },
    "children": [ … ]
  }
}
```

A symbol's objects are expressed in its `box`. Each `symbol` object in the document maps them into its own box (position, size and rotation included), so editing the symbol updates all its instances. A reader that does not know symbols can draw the symbol's content in place of the instance, or ignore it.

`styles` is the list of saved styles. Each style carries `id`, `name` and only what it applies: `fill`, `stroke`, `strokes`, `effects`, `opacity`, `blendMode` and `text` (character settings, for text objects). Absent fields leave the object untouched. Styles change nothing in how the document is displayed: they are there for the interface.

## Versions

- **1** (Poulpe Design 0.1): initial version.
- **2** (Poulpe Design 0.2): added `path` objects. A version 1 file opens unchanged; a version 2 file does not open in Poulpe Design 0.1.
- **3** (Poulpe Design 0.3): advanced strokes (`cap`, `join`, `dash`, `start`, `end`), `effects` on all objects, `path` on text. All these fields are optional: a version 1 or 2 file opens unchanged; a version 3 file does not open in Poulpe Design 0.2.
- **4** (Poulpe Design 0.4): `adjustment` objects (adjustment layers and dynamic filters) and `mask` on all objects. A file from versions 1 to 3 opens unchanged; a version 4 file does not open in Poulpe Design 0.3.
- **5** (Poulpe Design 0.5, layout): document `layout`, artboard `master` and `masterId`, text `frame` and `next`, `{page}` and `{pages}` fields. All optional: files from versions 1 to 4 open unchanged; a version 5 file does not open in Poulpe Design 0.4.
- **7** (Poulpe Design 0.6, vector tools): `symbol` objects, document `symbols` and `styles`, `conic` and `pattern` paints, stroke `align`, `profile` and `strokes`, `bevel` effect, text `features` and `columns`. All optional: files from versions 1 to 6 open unchanged; a version 7 file does not open in Poulpe Design 0.5.
- **6** (Poulpe Design 0.5, printing): `colorMode` and `cmyk` in `layout`. Optional: files from versions 1 to 5 open unchanged; a version 6 file does not open in a version of Poulpe Design that only knows version 5.
