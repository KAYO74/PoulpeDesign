# Layer management

The **Layers** panel shows the top layer first, as in Affinity and Photoshop.

## Changing the order

| Action             | Shortcut                    | Where                               |
| ------------------ | --------------------------- | ----------------------------------- |
| Bring to Front     | Ctrl+Shift+] (Cmd on macOS) | Right-click, Layer › Order, Arrange |
| Bring Forward      | Ctrl+]                      | same                                |
| Send Backward      | Ctrl+[                      | same                                |
| Send to Back       | Ctrl+Shift+[                | same                                |
| Select Layer Above | Alt+]                       | Layer › Order                       |
| Select Layer Below | Alt+[                       | Layer › Order                       |

With several layers selected, they move together and keep their order. Every order change
can be undone (Ctrl+Z) and is saved as is in the `.poulpe` file.

## Drag and drop

- Dragging a row places it at any position: a line shows where it will land.
- Dropping in the middle of a group puts the layers inside it (the group gets highlighted); dropping on an artboard puts them at its very top.
- Dropping in the middle of another layer opens a small menu: **Group**, combine the shapes (**Add**, **Subtract**, **Intersect**, **Xor**) or **Merge into one image**.
- If the dragged row is part of the selection, the whole selection follows ("3 layers" under the pointer).
- Near the edge of the panel, the list scrolls by itself.

## Merging, grouping, deleting

- Right-click › **Merge**: Add, Subtract, Intersect, Xor, Divide (the shapes and curves become a single curve), or **Merge into one image** (Ctrl+E, also in the Layer menu), which flattens shapes, texts and photos into one image, in place of the topmost layer.
- Below the list: **Group** (Ctrl+G) and **Delete** (also the Delete key), in every Persona.
- Right-click an artboard: **Add Artboard** or **Delete Artboard** (there is always at least one left).

## Selecting in the panel

- Click: one layer. Ctrl+click (Cmd on macOS): adds or removes. Shift+click: the whole range.
- Up/Down arrows: previous/next layer (Shift to extend), F2: rename, Menu key: context menu.

## Lots of layers

Beyond 150 rows, the panel only renders the visible rows (virtualized list) and each row
is only redrawn when its layer changes. Measured with 3,000 layers (Chromium, no GPU): showing
the panel took 2.3 s before, 0.16 s after; changing the selection 0.7 s before, 0.12 s after.

Code: `apps/editor/src/panels/LayersPanel.tsx`, `apps/editor/src/layers.ts`, `moveNodesTo` in
`packages/core/src/tree.ts`. Tests: `packages/core/test/calques.test.ts`, `apps/editor/e2e/layers.spec.ts`.
