import { expect, test, type Page } from '@playwright/test';

/** Noms des calques du premier plan de travail, du dessous vers le dessus. */
const names = (page: Page) =>
  page.evaluate(() =>
    (window as any).poulpe.editor.doc.artboards[0].children.map((n: { name: string }) => n.name),
  );

/** Crée des rectangles nommés (le premier est tout en dessous). */
async function makeLayers(page: Page, list: string[]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 380, { steps: 4 });
  await page.mouse.up();
  await page.evaluate((list) => {
    const ed = (window as any).poulpe.editor;
    ed.apply('test', (d: any) => {
      const base = d.artboards[0].children[0];
      d.artboards[0].children = list.map((name: string, i: number) => ({
        ...JSON.parse(JSON.stringify(base)),
        id: `t${i}`,
        name,
        x: base.x + (i % 40) * 4,
      }));
    });
    ed.select([]);
  }, list);
  await page.keyboard.press('v');
}

const row = (page: Page, name: string) =>
  page
    .getByTestId('layer-tree')
    .locator('.layer', { has: page.locator('.layer-name', { hasText: new RegExp(`^${name}$`) }) });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await page.evaluate(
    () => ((window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined),
  );
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('studio').getByTestId('tab-layers').click();
});

test('change l’ordre au menu contextuel, au clavier et au menu, puis annule', async ({ page }) => {
  await makeLayers(page, ['A', 'B', 'C', 'D']);
  // Le panneau montre le calque du dessus en premier.
  const order = await page
    .getByTestId('layer-tree')
    .locator('[role=treeitem][aria-level="1"] .layer-name')
    .allTextContents();
  expect(order).toEqual(['D', 'C', 'B', 'A']);

  // Clic droit > Premier plan.
  await row(page, 'A').click({ button: 'right' });
  await page.getByTestId('layer-menu').getByText('Premier plan').click();
  expect(await names(page)).toEqual(['B', 'C', 'D', 'A']);

  // Ctrl+[ : reculer d'un niveau ; Ctrl+Maj+[ : arrière-plan.
  await page.keyboard.press('Control+BracketLeft');
  expect(await names(page)).toEqual(['B', 'C', 'A', 'D']);
  await page.keyboard.press('Control+Shift+BracketLeft');
  expect(await names(page)).toEqual(['A', 'B', 'C', 'D']);

  // Menu Calque > Ordre > Avancer.
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ordre' }).click();
  await page.getByRole('menuitem', { name: /^Avancer/ }).click();
  expect(await names(page)).toEqual(['B', 'A', 'C', 'D']);

  // Annuler / rétablir.
  await page.keyboard.press('Control+z');
  expect(await names(page)).toEqual(['A', 'B', 'C', 'D']);
  await page.keyboard.press('Control+Shift+z');
  expect(await names(page)).toEqual(['B', 'A', 'C', 'D']);
});

test('multi-sélection et glisser-déposer de plusieurs calques', async ({ page }) => {
  await makeLayers(page, ['A', 'B', 'C', 'D', 'E']);
  // Maj+clic : plage ; Ctrl+clic : ajoute.
  await row(page, 'D').click();
  await row(page, 'C').click({ modifiers: ['Shift'] });
  await row(page, 'A').click({ modifiers: ['Control'] });
  const sel = await page.evaluate(() => (window as any).poulpe.editor.selection.slice().sort());
  expect(sel).toEqual(['t0', 't2', 't3']);
  await expect(page.getByTestId('layer-tree').locator('.layer.sel')).toHaveCount(3);

  // On glisse la sélection au-dessus de E (tout en haut).
  const target = row(page, 'E');
  const tb = (await target.boundingBox())!;
  await row(page, 'C').dragTo(target, { targetPosition: { x: tb.width / 2, y: 3 } });
  expect(await names(page)).toEqual(['B', 'E', 'A', 'C', 'D']);

  // Puis tout en dessous de B.
  const b = row(page, 'B');
  const bb = (await b.boundingBox())!;
  await row(page, 'D').dragTo(b, { targetPosition: { x: bb.width / 2, y: bb.height - 3 } });
  expect(await names(page)).toEqual(['A', 'C', 'D', 'B', 'E']);
  await page.keyboard.press('Control+z');
  expect(await names(page)).toEqual(['B', 'E', 'A', 'C', 'D']);
});

test('navigue au clavier dans les calques', async ({ page }) => {
  await makeLayers(page, ['A', 'B', 'C']);
  await row(page, 'C').click();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => (window as any).poulpe.editor.selection)).toEqual(['t1']);
  // Alt+] : calque au-dessus, partout dans l'appli.
  await page.keyboard.press('Alt+BracketRight');
  expect(await page.evaluate(() => (window as any).poulpe.editor.selection)).toEqual(['t2']);
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Haut');
  await page.keyboard.press('Enter');
  expect(await names(page)).toEqual(['A', 'B', 'Haut']);
});

test('reste fluide avec 3 000 calques', async ({ page }) => {
  await makeLayers(
    page,
    Array.from({ length: 3000 }, (_, i) => `Calque ${i}`),
  );
  const tree = page.getByTestId('layer-tree');
  // Seules les lignes visibles sont dans la page.
  const shown = await tree.locator('[role=treeitem]').count();
  expect(shown).toBeLessThan(150);
  await expect(row(page, 'Calque 2999')).toBeVisible();

  // Défilement jusqu'en bas : le calque du dessous apparaît.
  await tree.evaluate((el) => {
    let p = el.parentElement;
    while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
    p!.scrollTop = p!.scrollHeight;
  });
  await expect(row(page, 'Calque 0')).toBeVisible();

  // Envoyer au premier plan reste rapide.
  await row(page, 'Calque 0').click();
  const ms = await page.evaluate(async () => {
    const t0 = performance.now();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: ']',
        code: 'BracketRight',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  });
  expect((await names(page)).at(-1)).toBe('Calque 0');
  expect(ms).toBeLessThan(1000);
});
