# Canva side v0.2: status and code layout

October 5, 2026

v0.2 adds to Poulpe Design what you need to make a nice visual in a few clicks, without starting from a blank page: templates, a library of free elements, ready-made styles, and resizing a design to another format.

## What the user sees

- **Welcome screen.** At launch, the "Welcome to Poulpe Design" window offers templates (filterable by format), blank formats by use (social media, print, screen), a custom size and opening a file. The "Show at startup" checkbox turns it off. It also opens from File > New.
- **Library panel** (toolbar button, View > Library, or Ctrl+Shift+L). It docks on the side opposite the Studio and so follows the chosen layout. Three tabs:
  - **Templates**: 19 templates, with search and a category filter. A template fills the active artboard if it is empty; otherwise it lands in a new artboard to the right.
  - **Elements**: 3 text styles (title, subtitle, body), 33 shapes, 7 photo frames, 12 illustrations and 172 icons in 10 categories, with search in French and English (accent-insensitive). A click adds the element at the center of the view; drag and drop places it where you drop it. Shapes and icons take the current fill color.
  - **Styles**: 18 palettes and 8 font pairings. A palette applies to the selection, or to the whole artboard (background included) when nothing is selected; clicking again offers another distribution of the same colors. The "+" button adds the palette to the swatches. A font pairing puts the heading font on large texts and the body font on the others.
- **Photo frames.** An image dropped on a frame, or imported while a frame is selected, fills it and is cropped to cover it. You then crop it like any image (double-click).
- **Formats.** 20 formats, including 10 for social media (Instagram square and portrait, story, Facebook, LinkedIn, X, Pinterest, YouTube), 7 for print (A3, A4, A5, Letter, business card, postcard, invitation) and 3 for screen.
- **Resize design** (Document > Resize design…, or the button in the Library panel): pick a format or a size, as a copy next to the original (default) or in place.

## Code layout

| Where                                    | What                                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/path.ts`              | Parsing SVG paths (`d`), converting arcs to Bézier curves, bounding box.                                                                                                      |
| `packages/core/src/resize.ts`            | `resizeArtboard`: "smart" resizing of an artboard.                                                                                                                            |
| `packages/core/src/recolor.ts`           | Contrast, lightness, `designColors` and `applyPalette`.                                                                                                                       |
| `packages/core/src/factory.ts`           | Formats (`FORMAT_PRESETS`, with a category), `createPath`.                                                                                                                    |
| `packages/library/`                      | Library content: templates, shapes, frames, illustrations, icons, palettes, fonts. Everything is described in code (a small language in `src/dsl.ts`), in French and English. |
| `apps/editor/src/libraryActions.ts`      | What the library buttons do to the document.                                                                                                                                  |
| `apps/editor/src/panels/Library.tsx`     | The Library panel.                                                                                                                                                            |
| `apps/editor/src/components/Thumb.tsx`   | Previews of templates and elements, drawn by the rendering engine itself.                                                                                                     |
| `apps/editor/src/components/Dialogs.tsx` | Welcome screen and resize window.                                                                                                                                             |

The new `path` object type (a free shape described by an SVG path) moves the file format to version 2; see [format-poulpe.md](format-poulpe.md). v0.1 files open unchanged.

### Resizing a design

Each axis is handled separately, with `k` being the smaller of the two scale ratios (so text is never distorted):

1. An object that covers almost a whole side (90% or more, except text) is stretched along that axis: backgrounds, banners. An image keeps its proportions and is cropped to cover.
2. An object that touches an edge (within 2%) or overflows it stays pinned to that edge: logos in a corner, badges.
3. An object placed on another one (contained in a larger object that is neither text nor a background) follows that object and keeps its relative position: text on a banner.
4. The other objects form a block, scaled down or up by `k`, whose center keeps its relative place on the page. This way they keep their layout relative to each other.

Stroke widths and corner radii are multiplied by `k`.

### Palettes

The design's colors are sorted from darkest to lightest, and each one takes the palette color at the same relative position. Dark text on a light background therefore stays dark on a light background, which preserves contrast. The original opacity is kept.

## Content licenses

- Templates, shapes, frames, illustrations, palettes and pairings: made for Poulpe Design, under MPL-2.0 like the rest of the code.
- Icons: [Phosphor Icons](https://phosphoricons.com), MIT license, see [`packages/library/LICENSE-icons.md`](../packages/library/LICENSE-icons.md). The paths are extracted from `@phosphor-icons/core` by `pnpm --filter @poulpe/library icons` (list and French keywords in `scripts/icons-list.json`).
- Fonts: only those already shipped with Poulpe Design (OFL license).

## Known limitations

- **No built-in free photos yet.** v0.2 lets you import your own photos and put them in frames, but does not ship a CC0 image bank. The candidate sources (Openverse, Wikimedia Commons, Unsplash, Pexels) require either network access from the app or checking licenses image by image. This is postponed to a later version.
- Templates and elements are fixed in the code: you cannot save your own templates yet.
- Resizing follows simple rules: a very busy design may need touch-ups afterwards.

## Tests

- `packages/core/test/v02.test.ts`: paths, migration from version 1, formats, resizing, palettes.
- `packages/library/test/library.test.ts`: unique identifiers, every template builds in both languages, icons and search.
- `apps/editor/e2e/library.spec.ts`: welcome screen, templates, elements, photo frame, drag and drop, palettes and fonts, resizing, panel in English.
