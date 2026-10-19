# Layout v0.5 (part one): status and code organization

October 5, 2026

This first part of v0.5 gives Poulpe Design what makes Affinity Publisher a page layout program: multi-page documents, master pages, page numbers, text that flows from one frame to the next, and a print-ready PDF.

## What the user sees

- **Layout Persona.** The third button at the top left (next to Draw) opens the Layout Persona. The Pages panel replaces the Library, and the toolbar offers the layout actions (add page, new master page, document setup, text frame, link, unlink, page number). Boolean operations stay in the Draw Persona. A multi-page document opens directly in the Layout Persona.
- **New print document.** In "New document", the print sizes (A4, A5, A3, Letter, business card…) are at 300 ppi, and you choose the number of pages and facing pages.
- **Pages panel.** Master pages at the top, pages below (as spreads if the document uses facing pages), with their thumbnail, their number and the letter of their master page. A click shows the page, a drag moves it, a master page dragged onto a page is applied to it. At the bottom: the active page's master page, add, duplicate, delete, and rearrange. Pages arrange themselves automatically, in a column or as spreads.
- **Master pages.** Whatever is placed on a master page (banner, logo, page number) appears beneath the content of every page that uses it, on screen, in the thumbnails and in all exports.
- **Page numbers.** Text > Insert page number: while typing, the `{page}` field is inserted at the cursor; otherwise, a centered number is placed at the bottom of the active page (handy on a master page). On the master page it shows "#"; on the pages, their number. The first number is set in the document setup.
- **Text frames.** In the Layout Persona, the Text tool draws frames: their height stays fixed and overflowing text is hidden. The "Frame" checkbox in the context toolbar turns any text block into a frame. A red "+" square at the bottom right indicates overflowing text.
- **Linked frames.** Click the "+" square, then click another text (or an empty spot, to create a new frame of the same size): the text flows into the next frame, even on another page. You can also select two texts and choose Text > Link text frames. The text is edited as one piece: a click in any frame of the chain places the cursor there, and the arrow keys move from one frame to the next. Deleting a frame closes the chain without losing the text; "Take frame out of chain" detaches it.
- **Document setup** (Document > Document setup…): resolution (72 to 600 ppi), facing pages, first page number, margins (top, bottom, inside, outside) shown in purple, and bleed shown as red dashed lines. Lengths are set in millimeters.
- **Print PDF.** The PDF is at the actual page size (an A4 page at 300 ppi is 210 × 297 mm), all pages or a range ("1-3, 5"), without the master pages. You can include the bleed and crop marks; the TrimBox and BleedBox tell the printer where to cut.

## Code organization

| Where                                    | What                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/pages.ts`             | Pages and master pages: numbering, fields, margins, arrangement in a column or as spreads, adding, duplicating, moving, units. |
| `packages/core/src/flow.ts`              | `{page}` / `{pages}` fields and linked text frames: frame chain, text distribution (indices stay those of the whole text).     |
| `packages/core/src/tree.ts`              | Deleting a frame closes its chain; copying frames together keeps their links.                                                  |
| `packages/core/src/svg.ts`               | SVG (and therefore PDF) export with master page, fields, linked frames and bleed.                                              |
| `packages/render/src/index.ts`           | Rendering of the master page beneath the page, fields and linked frames (cached as long as the document does not change).      |
| `apps/editor/src/layoutActions.ts`       | What the layout commands do to the document.                                                                                   |
| `apps/editor/src/panels/PagesPanel.tsx`  | Pages panel.                                                                                                                   |
| `apps/editor/src/canvas/textParts.ts`    | Editing a text spread over several frames (cursor, click, arrow keys).                                                         |
| `apps/editor/src/canvas/controller.ts`   | Frame outlines, overflow indicator, choosing the next frame, margins and bleed.                                                |
| `apps/editor/src/io.ts`                  | Actual-size PDF, bleed, crop marks, TrimBox and BleedBox, page range.                                                          |
| `apps/editor/src/components/Dialogs.tsx` | Document setup, PDF options, pages and facing pages in "New document".                                                         |

The file format moves to version 5 (see [format-poulpe.md](format-poulpe.md)), right after version 4 for photo retouching. All new fields are optional: files from versions 1 to 4 open unchanged.

## Choices and deviations

- **A page is an artboard.** Pages keep everything artboards can do (tools, layers, exports); a master page is an artboard marked `master`, placed to the left of the pages. Master pages are simple (one page, no master spread) and do not nest.
- **The bleed is a single margin shared by all four sides.** With facing pages, it is not drawn on the binding side, but the PDF exports it on all four sides of each page (which is what most printers ask for with separate pages).
- **Crop marks** in registration color (100% of each ink), 3 pt from the bleed, 12 pt long.
- **CMYK in part two.** Color management (CMYK, ICC profile, soft proofing), PDF/X, opening PSD, PDF and AI files, PSD export and batch export are described in [impression-v0.5.md](impression-v0.5.md).
- **No paragraph styles, columns or text wrap yet**: they are on the v0.3.x list (advanced text).

## Tests

- `packages/core/test/v05.test.ts`: numbering, arrangement in a column and as spreads, moving and duplicating pages (links included), margins with facing pages, units, fields, text distributed over three frames, chain closed after deletion, v5 format and migration, master page and bleed in the SVG.
- `apps/editor/e2e/layout.spec.ts`: multi-page A4 document, Pages panel (duplicate, add, delete, undo), master page with page number and actual-size PDF, text flowing from one frame to the next through the overflow indicator, document setup and PDF with bleed and crop marks.
