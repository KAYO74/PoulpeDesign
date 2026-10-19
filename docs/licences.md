# Licenses and origin of the content

Poulpe Design is built with artificial intelligence: the project's creator describes what he wants, and Claude (Anthropic) writes the code, the documentation and the images. This page says where each part comes from and under which license, so that anyone can check that nothing is taken from proprietary software such as Photoshop, Illustrator or Affinity.

Last checked: October 5, 2026, on version 1.0.

## Poulpe Design's code

All the code in the `packages/` and `apps/` folders was written for Poulpe Design and is distributed under the [MPL-2.0](../LICENSE). The check found no third-party license or copyright header, no comment flagging copied code, and no proprietary binary file (`.psd`, `.abr`, `.icc`, `.ttf` or `.otf` fonts).

- **File formats.** Opening and exporting Photoshop files (`.psd`) goes through the open-source library [ag-psd](https://github.com/Agamnentzar/ag-psd) (MIT), and opening PDF and Illustrator files goes through [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0). Print PDFs follow the public PDF/X-4 and XMP standards.
- **Print colors.** The CMYK profile is computed by Poulpe Design itself (`packages/core/src/cmyk.ts` and `icc.ts`); the official FOGRA39 profile, which cannot be redistributed, is not included, only named.
- **Magic eraser.** It rebuilds the image from the photo itself, with an algorithm written for Poulpe Design and without any AI model.
- **Image tracing.** The algorithm is written for Poulpe Design from published methods (k-means, edge following, Schneider curves). Potrace, whose GPL license is incompatible, is not used.
- **AI background removal.** The U²-Net "silueta" model (Apache-2.0 for U²-Net, MIT for the rembg project's version) is downloaded at build time, with its checksum verified, and run by ONNX Runtime (MIT) on the computer.
- **Extensions.** They run in QuickJS (MIT).
- **LUT looks.** The six looks are computed by Poulpe Design; `.cube` files are a public format.

The notices for these components ship with the app in `LICENCES-TIERS.txt`.

## Libraries used

All are under open-source licenses compatible with the MPL-2.0.

| Part                                                   | Count | Licenses                                                                                                                                                             |
| ------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface and engine (npm packages shipped in the app) | 116   | Mostly MIT, BSD-3-Clause, Apache-2.0 (pdf.js), MIT or Apache-2.0 (Tauri), MPL-2.0 or Apache-2.0 (DOMPurify), MIT and Zlib (pako), ISC, 0BSD (tslib), OFL-1.1 (fonts) |
| Desktop app (Rust libraries)                           | 533   | MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0, Unlicense, MPL-2.0, CDLA-Permissive-2.0, 0BSD, CC0                                                                     |

To run the check again: `pnpm licenses list --prod` and, in `apps/desktop/src-tauri`, `cargo metadata --format-version 1`.

## Fonts

The 7 fonts shipped with Poulpe Design are under the free [SIL Open Font License](https://openfontlicense.org) and come from [Fontsource](https://fontsource.org): Inter, Montserrat, Playfair Display, Lora, Oswald, Bricolage Grotesque and Pacifico. The templates use only these.

Arial, Georgia, Times New Roman, Courier New, Verdana and Trebuchet MS are only offered in the font list when they are already installed on the computer; they are not shipped with Poulpe Design.

## Icons, templates and illustrations

- **Icons** in the library: [Phosphor Icons](https://phosphoricons.com), MIT license, see [`packages/library/LICENSE-icons.md`](../packages/library/LICENSE-icons.md).
- **Templates, shapes, frames, illustrations and palettes**: drawn for Poulpe Design, under the MPL-2.0.
- **Logo** of Poulpe Design: drawn for Poulpe Design.

## Home page images

The screenshots in `docs/images/` are taken in Poulpe Design itself, with demo documents made for the purpose. They use only free fonts: the OFL fonts above for the interface and the designs, and DejaVu Sans Mono (free Bitstream Vera license) for the interface's numbers.

## Trademarks

Poulpe Design is affiliated with neither Adobe nor Serif. Photoshop, Illustrator, Affinity and Canva are trademarks of their owners; they are mentioned only to compare features and to name the supported file formats.
