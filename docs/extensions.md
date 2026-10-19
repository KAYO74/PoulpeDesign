# Writing a Poulpe Design extension

An extension is a JavaScript file (`.js`) that adds commands to the **Extensions** menu. You install it from Extensions > Manage Extensions… > Install from File…. Three complete examples are in [`apps/editor/src/extensions/examples/`](../apps/editor/src/extensions/examples/).

## The smallest example

```js
poulpe.extension({ id: 'com.example.square', name: 'Red Square', version: '1.0.0', author: 'Me' });

poulpe.command({
  id: 'square',
  title: { fr: 'Ajouter un carré rouge', en: 'Add a Red Square' },
  run: function () {
    var ab = poulpe.artboard();
    var id = poulpe.create({
      type: 'rect',
      x: ab.x + 20,
      y: ab.y + 20,
      width: 100,
      height: 100,
      fill: '#e03030',
    });
    poulpe.select([id]);
  },
});
```

## What an extension can do

The code runs in an isolated JavaScript interpreter (QuickJS): there is no `window`, no `document`, no `fetch` and no file access. A command is stopped after 5 seconds of computation; memory is limited to 64 MB. Everything goes through the `poulpe` object:

| Function                                                         | Purpose                                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poulpe.extension({ id, name, version, description?, author? })` | Required, once. `id`: letters, digits, dots, hyphens (for example `com.exemple.outil`).                                                           |
| `poulpe.command({ id, title, params?, needsSelection?, run })`   | Adds a command. `title`: a string, or `{ fr, en }`. `run(settings)` is called when the command is chosen.                                         |
| `poulpe.lang`                                                    | Interface language: `'fr'` or `'en'`.                                                                                                             |
| `poulpe.document()`                                              | Document name and list of artboards (`id`, `name`, `x`, `y`, `width`, `height`).                                                                  |
| `poulpe.artboard()`                                              | Active artboard, with its objects (`children`).                                                                                                   |
| `poulpe.selection()`                                             | Copies of the selected objects.                                                                                                                   |
| `poulpe.find(id)`                                                | Copy of an object, or `null`.                                                                                                                     |
| `poulpe.create(shape)  `                                         | Creates an object and returns its id (see below). `parent`: id of an artboard or a group (defaults to the active artboard).                       |
| `poulpe.update(id, changements)`                                 | Changes `x`, `y`, `width`, `height`, `rotation`, `opacity`, `name`, `visible`, `locked`, `fill`, `stroke`, `strokeWidth`, `cornerRadius`, `text`. |
| `poulpe.remove(id or [ids])`                                     | Deletes objects.                                                                                                                                  |
| `poulpe.group([ids], name?)`                                     | Groups objects and returns the group's id.                                                                                                        |
| `poulpe.select([ids])`                                           | Changes the selection.                                                                                                                            |
| `poulpe.toast(message)`                                          | Shows a short message.                                                                                                                            |
| `console.log(…)`                                                 | Writes to the developer console.                                                                                                                  |

Coordinates are in document pixels (not relative to the artboard). Colors are written `#rrggbb` or `#rrggbbaa`; `null` means "none".

All the changes made by a command form **a single history step**: Ctrl+Z undoes the whole command. If the command throws an error, nothing is changed and a message is shown.

### Shapes

`poulpe.create({ type, … })` accepts `type`: `rect`, `ellipse`, `polygon` (`sides`), `star` (`points`, `innerRatio`), `line`, `text` (`text`, `fontSize`, `fontFamily`, `fontWeight`) and `path` (`d`: SVG path data, in document coordinates; the bounding box follows the path). Common to all: `x`, `y`, `width`, `height`, `name`, `fill`, `stroke`, `strokeWidth`, `opacity`, `rotation`, `cornerRadius` (rectangle).

### Command settings

With `params`, Poulpe Design asks for the settings in a dialog before calling `run(settings)`. Each setting: `{ id, label, type, default, … }` with `type`:

- `number` (`min`, `max`, `step`),
- `text`,
- `color` (a `#rrggbb` value),
- `boolean` (checkbox),
- `select` (`options: [{ value, label }]`).

Extension commands are recorded in macros with their settings, and can be given a shortcut (Help > Keyboard Shortcuts).
