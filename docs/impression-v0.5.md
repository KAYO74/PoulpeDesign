# Print and file opening v0.5 (part two): status and code layout

Follows [mise-en-page-v0.5.md](mise-en-page-v0.5.md). This second part completes v0.5 of the [roadmap](feuille-de-route.md): CMYK colors, PDF/X-4 for print shops, on-screen soft proofing, opening Photoshop, PDF and Illustrator files, PSD export and batch export.

## What the user sees

- **CMYK document.** Document › Document setup › Colors: "RGB (screen)" or "CMYK (print)". In CMYK, the color picker opens on the C, M, Y, K sliders and flags colors a printer cannot reproduce. A value typed in CMYK (for example 100% cyan) is kept exactly as is all the way into the PDF.
- **On-screen soft proofing** (View › CMYK soft proof, Ctrl+Y, or the button in the Layout Persona): the screen shows colors as they will come out in print, duller for bright colors.
- **PDF for print shops.** In Export › PDF: "CMYK" colors and a "PDF/X-4" checkbox. The PDF then contains only CMYK colors, the print profile (FOGRA39, coated paper), and the trim and bleed areas. If a font or a JPEG photo prevents strict compliance, a message says so.
- **Open a Photoshop file (.psd)**: layers, groups, masks, opacities, blend modes and the main adjustment layers (brightness and contrast, levels, curves, exposure, vibrance, hue and saturation, invert, posterize, threshold) remain editable. The document opens in the Photo Persona.
- **Open a PDF or an Illustrator file (.ai)**: each page becomes a Poulpe Design page, with its shapes, strokes, gradients, texts and images as editable objects. An Illustrator file is opened through its PDF part (the "Create PDF Compatible File" option, checked by default in Illustrator); otherwise a message explains what to do.
- **Export as PSD**: one Photoshop layer per object, groups and clipping masks included.
- **Batch export** (File › Batch export…): several pages, several formats (PNG, JPEG, SVG, PDF, PSD) and several sizes (1x, 2x, 3x…) at once, in a ZIP file.

## Code layout

| Where                                    | What                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/cmyk.ts`              | Print model (Neugebauer, dot gain, Yule-Nielsen, 320% ink limit), RGB ↔ CMYK, soft proofing, out of gamut, exact values. |
| `packages/core/src/icc.ts`               | CMYK ICC profile computed from the same model (embedded in PDF/X files).                                                 |
| `packages/core/src/pdfPrint.ts`          | Rewrites jsPDF's PDF: colors, gradients and images in CMYK, then PDF/X-4 (OutputIntent, XMP, TrimBox and BleedBox).      |
| `apps/editor/src/importers/psd.ts`       | Reading and writing PSD files (with the ag-psd library, MIT license).                                                    |
| `apps/editor/src/importers/pdf.ts`       | Reading PDF and AI files (with pdf.js, Apache 2.0 license), page by page, as editable objects.                           |
| `apps/editor/src/io.ts`                  | Opening by file extension, CMYK PDF and PDF/X, PSD export, batch export to ZIP.                                          |
| `apps/editor/src/panels/ColorPicker.tsx` | CMYK sliders and out-of-gamut warning.                                                                                   |
| `apps/editor/src/canvas/controller.ts`   | On-screen soft proofing.                                                                                                 |
| `apps/editor/src/components/Dialogs.tsx` | Document colors, CMYK PDF and PDF/X options, PSD export, batch export window.                                            |

The file format moves to version 6 (see [format-poulpe.md](format-poulpe.md)): `colorMode` and `cmyk` in `layout`, both optional.

## Choices and deviations

- **Approximate CMYK profile.** The official FOGRA39 profile cannot be freely redistributed; Poulpe Design computes its own with an offset printing model on coated paper, close to FOGRA39. The PDF/X declares the FOGRA39 condition, which every printer knows. For a critical color (logo, brand guidelines), it is better to type the exact CMYK value: it is kept as is.
- **No grayscale or spot colors (Pantone) yet.** They will come with swatch libraries.
- **JPEG photos.** Converted to CMYK in a PDF/X; a JPEG kept in RGB in a plain PDF is flagged.
- **Opened PDF and AI files.** Clipping areas are not carried over yet, texts are rebuilt with similar fonts, and a page that is too busy (more than 20,000 objects) or unreadable is opened as a 300 dpi image.
- **PSD.** Photoshop text layers and layer styles come in as pixels; on export, texts and shapes become pixel layers.
- **Slower soft proofing.** It recomputes every displayed image, so it is off by default.
- **pdf.js** is loaded only the first time a PDF is opened, in its "legacy" build (the modern build uses JavaScript features that WebKitGTK, the engine of the Linux app, does not have yet).

## Tests

- `packages/core/test/print.test.ts`: gray as black only, RGB → CMYK → RGB round trip, ink limit, CMYK value kept, out of gamut, soft proofing, ICC profile header, converting a hand-made PDF to CMYK and to PDF/X-4.
- `apps/editor/e2e/print.spec.ts`: PDF opened as editable objects on two pages, AI file (and an old AI without a PDF part), layered PSD opened then re-exported, CMYK PDF/X-4 with a value entered in CMYK, on-screen soft proofing, batch export to ZIP.
- Checked by hand: the ICC profile is accepted by LittleCMS, and the PDF/X-4 files pass qpdf's syntax check; `pdfinfo` recognizes them as PDF/X-4.
