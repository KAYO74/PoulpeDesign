# Floating panels

As in Photoshop, Poulpe Design's tool windows can be undocked, moved and resized.

## For the user

- **Undock a Studio group** (Color, Stroke… or Layers, History): drag its tab bar out of the Studio, or double-click the bar (next to the tabs).
- **Undock a single panel** (Layers, Brush, History…): drag its tab out of the group, or double-click the tab. It becomes its own window; dropped back on the Studio or on its group, it returns to its place.
- **Undock the tools column**: drag the small handle at the top of the column, or double-click it.
- **Move** a floating window: drag it by its title bar.
- **Resize**: drag an edge or a corner. The floating tools palette rearranges itself into several columns when you widen it.
- **Re-dock**: drop the window back on the Studio (or against its edge); the area lights up on hover. The dock button or a double-click on the title bar does the same.
- **Docked panels**: drag the inner edge of the Studio and the Library to change their width; the divider between the Studio's two groups sets their height. Double-click a divider: default size.
- **View › Reset panels** restores the original layout (tools on the right, Studio docked).

The layout is remembered from one session to the next.

## For the code

- `apps/editor/src/panels/panelLayout.ts`: the `panels` store (key `poulpe.panels` in local storage), kept separate from the settings so that a drag does not redraw the whole editor; drag, resize and dock functions.
- `apps/editor/src/panels/FloatingFrame.tsx`: floating window with its eight handles.
- The detachable panels are `tools`, `studio-top`, `studio-bottom` and `tab:<onglet>` (a single panel, for example `tab:layers`); the same identifier is used in all three Personas.

## Interface size

**Preferences › Display › Interface size** (from 80% to 200%) scales the whole desktop app window: menus, panels, texts and icons. The document stays sharp (`renderDpr` in `apps/editor/src/uiScale.ts`). In the browser, its own zoom (Ctrl + / Ctrl −) does the same.

- Tests: `apps/editor/e2e/panels.spec.ts`.

## Custom workspaces

As in Affinity, you can create your own workspace alongside the Draw, Photo and Layout Personas.

- Menu next to the three Personas (or **View › Workspaces**), then **New workspace…**.
- Choose a name, a type (**Vector**, **Pixel** or **Presentation**), the visible tools and the Studio panels.
- The workspace saves the current panel layout (docked or floating, positions, sizes, sides). While it is open, every layout change is remembered in it.
- Going back to a built-in Persona restores the layout it had before. **Edit "name"…** changes the name, type, tools or panels, or deletes the workspace.

Code: `apps/editor/src/workspaces.ts` (key `poulpe.workspaces`), `components/WorkspaceMenu.tsx`, the `WorkspaceDialog` dialog in `components/dialogs/WorkspaceDialog.tsx`. Shortcuts for hidden tools stay active.

## Customizable tools column

- **View › Tools column** (or Preferences › Display): left or right side, **Automatic** layout (as before: two columns when there are many tools), **Single column** along the edge, or **Two columns**. **Lock the tools column** keeps it docked: it can no longer be undocked as a floating palette.
- **All lined up vertically** (default) or **Grouped**, as in Photoshop and Affinity: one button per tool family, showing the last tool chosen. The button's small triangle, a right-click or a long press opens the group's other tools. Also in Preferences › Display; each workspace remembers the choice.
- In a custom workspace, you pick your tools from **all** of Poulpe's tools, sorted by family (selection, vector, pixel, text and navigation), and you can mix vector and pixel. Choosing a pixel tool switches the document to Photo mode, choosing a vector tool brings it back to Draw, without leaving the workspace. The workspace also remembers the column layout and lock.

Code: `apps/editor/src/toolCatalog.ts` (tools per Persona, catalog, `toolPersona`), `pickTool` in `components/ToolColumn.tsx`, settings `toolsColumns`, `toolsLayout` and `toolsLocked` (`smallGroups` arranges a custom column in groups).
