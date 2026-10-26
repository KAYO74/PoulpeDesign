import { expect, test, type Page } from '@playwright/test';

/* Filtres en direct d'un calque : posés depuis le menu Filtres, modifiables, sans toucher au calque. */

const shape = (page: Page) =>
  page.evaluate(() => {
    const n = (window as any).poulpe.editor.doc.artboards[0].children[0];
    return { type: n.type, filters: n.filters ?? [] };
  });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 400, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId('studio').getByTestId('tab-layers').click();
});

test('ajoute un flou en direct à une forme, le règle puis le modifie depuis Calques', async ({ page }) => {
  await page.getByRole('button', { name: 'Filtres' }).click();
  await page.getByRole('menuitem', { name: 'Filtres en direct du calque' }).hover();
  await page
    .getByRole('menu', { name: 'Filtres en direct du calque' })
    .getByRole('menuitem', { name: 'Flou gaussien' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Aperçu dans le document pendant le réglage.
  await expect.poll(async () => (await shape(page)).filters.length).toBe(1);
  const radius = dialog.getByRole('textbox');
  await radius.fill('12');
  await radius.press('Enter');
  await page.getByTestId('livefilter-apply').click();
  await expect(dialog).toBeHidden();
  let s = await shape(page);
  expect(s.type).toBe('rect');
  expect(s.filters).toMatchObject([{ enabled: true, adjustment: { kind: 'gaussianBlur', radius: 12 } }]);

  // Une seule étape d'historique : Annuler retire le filtre.
  await page.keyboard.press('Control+z');
  expect((await shape(page)).filters).toHaveLength(0);
  await page.keyboard.press('Control+Shift+z');
  const id = (await shape(page)).filters[0].id;

  // Dans le panneau Calques : désactiver, régler à nouveau (double-clic), supprimer.
  await page.getByTestId(`livefilter-eye-${id}`).click();
  expect((await shape(page)).filters[0].enabled).toBe(false);
  await page.getByTestId(`livefilter-eye-${id}`).click();
  await page.getByTestId(`livefilter-${id}`).dblclick();
  await radius.fill('30');
  await radius.press('Enter');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  s = await shape(page);
  expect(s.filters[0].adjustment.radius).toBe(12);
  await page.getByTestId(`livefilter-remove-${id}`).click();
  expect((await shape(page)).filters).toHaveLength(0);
});

test("le flou en direct déborde de la forme à l'écran", async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  // Bande juste à gauche du rectangle.
  const clip = { x: box.x + 284, y: box.y + 330, width: 14, height: 40 };
  await page.mouse.move(box.x + 10, box.y + 10);
  const before = await page.screenshot({ clip });
  await page.evaluate(() => {
    const ed = (window as any).poulpe.editor;
    ed.apply('test', (d: any) => {
      d.artboards[0].children[0].filters = [
        { id: 'f1', enabled: true, adjustment: { kind: 'gaussianBlur', radius: 30 } },
      ];
    });
  });
  await expect(page.getByTestId('livefilter-f1')).toBeVisible();
  await expect.poll(async () => (await page.screenshot({ clip })).equals(before)).toBe(false);
});
