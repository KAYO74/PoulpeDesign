import { expect, test, type Page } from '@playwright/test';

/*
 * Glisser-déposer de fichiers dans la fenêtre : une image ou un SVG se place là où on le lâche,
 * et sur l'écran d'accueil, ouvre un document.
 */

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#e91e63"/></svg>';

/** Lâche des fichiers sur l'élément `selector`, au point (x, y) de la page. */
const drop = (
  page: Page,
  selector: string,
  x: number,
  y: number,
  files: { name: string; b64?: string; text?: string }[],
) =>
  page.evaluate(
    ({ selector, x, y, files }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const body = f.text ?? Uint8Array.from(atob(f.b64!), (c) => c.charCodeAt(0));
        dt.items.add(new File([body], f.name));
      }
      const el = document.querySelector(selector)!;
      for (const type of ['dragover', 'drop'])
        el.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }),
        );
    },
    { selector, x, y, files },
  );

const kids = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children.map((n: any) => n.type));

test('une image et un SVG lâchés sur le document y sont placés', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await drop(page, '[data-testid="canvas"]', box.x + box.width / 2, box.y + box.height / 2, [
    { name: 'point.png', b64: PNG },
    { name: 'forme.svg', text: SVG },
    { name: 'notes.txt', text: 'x' },
  ]);
  await expect.poll(() => kids(page)).toHaveLength(2);
  expect((await kids(page))[0]).toBe('image');
  await expect(page.getByText('Format non pris en charge : notes.txt')).toBeVisible();
});

test("un SVG lâché sur l'écran d'accueil ouvre un document à sa taille", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: true })),
  );
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await drop(page, '[role="dialog"]', 400, 400, [{ name: 'logo.svg', text: SVG }]);
  await expect(page.getByRole('dialog')).toBeHidden();
  const ab = await page.evaluate(() => {
    const d = (window as any).poulpe.editor.doc;
    return {
      name: d.name,
      w: d.artboards[0].width,
      h: d.artboards[0].height,
      n: d.artboards[0].children.length,
    };
  });
  expect(ab).toEqual({ name: 'logo', w: 300, h: 200, n: 1 });
});
