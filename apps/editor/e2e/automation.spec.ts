import { expect, test, type Page } from '@playwright/test';

/* v1.0 : macros, raccourcis personnalisables et extensions. */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);

async function drawRect(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 80, box.y + y + 50, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('v');
}

async function menu(page: Page, top: string, item: string | RegExp) {
  await page.getByRole('navigation', { name: 'Menu' }).getByText(top, { exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('enregistre une macro puis la rejoue sur un autre objet', async ({ page }) => {
  await drawRect(page, 300, 250);
  await page.getByTestId('tab-macros').click();
  await page.getByTestId('macro-record').click();
  await expect(page.getByTestId('macro-recording')).toBeVisible();
  // Rotation d'un quart de tour (menu), puis déplacement de 10 pixels à droite (clavier).
  await menu(page, 'Disposition', /Faire pivoter.*droite|Pivoter.*droite/);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByTestId('macro-recording')).toContainText('2');
  await page.getByTestId('macro-stop').click();
  // La macro est gardée, avec ses deux étapes.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('poulpe.macros') ?? '[]'));
  expect(saved).toHaveLength(1);
  expect(saved[0].steps.map((s: AnyNode) => s.kind)).toEqual(['command', 'nudge']);

  await drawRect(page, 600, 450);
  const before = (await nodes(page))[1];
  await page.getByTestId('macro-play-Macro 1').click();
  await expect.poll(async () => (await nodes(page))[1].rotation).toBe(90);
  const after = (await nodes(page))[1];
  expect(after.x - before.x).toBeCloseTo(10, 0);
  // La macro apparaît aussi dans le menu Extensions, et a sa place dans les raccourcis.
  await page.getByRole('navigation', { name: 'Menu' }).getByText('Extensions', { exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Macros' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('change le raccourci d’une commande', async ({ page }) => {
  await drawRect(page, 300, 250);
  await menu(page, 'Aide', 'Raccourcis clavier');
  await page.getByPlaceholder('Rechercher une commande').fill('Grouper');
  await page.getByTestId('shortcut-layer.group').click();
  await page.keyboard.press('Control+Alt+K');
  await expect(page.getByTestId('shortcut-layer.group')).toHaveText('Ctrl+Alt+K');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select(editor.doc.artboards[0].children.map((n: AnyNode) => n.id));
  });
  // L'ancien raccourci ne fait plus rien, le nouveau groupe.
  await page.keyboard.press('Control+g');
  expect((await nodes(page))[0].type).toBe('rect');
  await page.keyboard.press('Control+Alt+k');
  expect((await nodes(page))[0].type).toBe('group');
  // Le menu affiche le nouveau raccourci.
  await page.getByRole('navigation', { name: 'Menu' }).getByText('Calque', { exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Grouper.*Ctrl\+Alt\+K/ })).toBeVisible();
});

test('installe une extension d’exemple et lance sa commande', async ({ page }) => {
  await menu(page, 'Extensions', 'Gérer les extensions…');
  await page.getByTestId('ext-example-org.poulpe.grid').click();
  await expect(page.getByTestId('ext-review')).toContainText('Grille de formes');
  await page.getByTestId('ext-install').click();
  await expect(page.getByTestId('ext-org.poulpe.grid')).toBeVisible();
  await page.locator('.modal footer .btn.primary').click();
  await menu(page, 'Extensions', 'Grille de formes…');
  await page.getByTestId('param-cols').fill('3');
  await page.getByTestId('param-cols').press('Enter');
  await page.getByTestId('param-rows').fill('2');
  await page.getByTestId('param-rows').press('Enter');
  await page.getByTestId('ext-run').click();
  const list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].type).toBe('group');
  expect(list[0].children).toHaveLength(6);
  // Une seule étape d'historique, annulable.
  const history = await page.evaluate(() => (window as any).poulpe.editor.getState().history);
  expect(history[history.length - 1]).toBe('Grille de formes…');
  await page.keyboard.press('Control+z');
  expect(await nodes(page)).toHaveLength(0);
  // L'extension reste installée au prochain lancement.
  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect
    .poll(async () => {
      await page.getByRole('navigation', { name: 'Menu' }).getByText('Extensions', { exact: true }).click();
      const n = await page.getByRole('menuitem', { name: 'Grille de formes…' }).count();
      await page.keyboard.press('Escape');
      return n;
    })
    .toBe(1);
});

test('une extension est isolée : ni page, ni réseau, ni boucle sans fin', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const host = await import('/src/extensions/host.ts' as string);
    const out: Record<string, string> = {};
    const tryInstall = async (name: string, body: string) => {
      try {
        await host.installExtension(
          `poulpe.extension({ id: 'test.${name}', name: '${name}', version: '1' });\n${body}`,
        );
        out[name] = 'ok';
      } catch (e) {
        out[name] = String((e as Error).message);
      }
    };
    await tryInstall(
      'window',
      'if (typeof window !== "undefined" || typeof fetch !== "undefined" || typeof __TAURI_INTERNALS__ !== "undefined") throw new Error("fuite");',
    );
    await tryInstall('loop', 'while (true) {}');
    return out;
  });
  expect(result.window).toBe('ok');
  expect(result.loop).toMatch(/interrupted/i);
});

test('les extensions d’exemple Rosace et Couleurs au hasard fonctionnent', async ({ page }) => {
  await drawRect(page, 300, 250);
  const out = await page.evaluate(async () => {
    const host = await import('/src/extensions/host.ts' as string);
    const rosette = (await import('/src/extensions/examples/rosette.js?raw' as string)).default;
    const shuffle = (await import('/src/extensions/examples/shuffle.js?raw' as string)).default;
    await host.installExtension(rosette);
    await host.installExtension(shuffle);
    const { editor } = (window as any).poulpe;
    const rect = editor.doc.artboards[0].children[0];
    const before = rect.fill.color;
    editor.select([rect.id]);
    const shuffled = host.runExtensionCommand('org.poulpe.shuffle', 'shuffle', {});
    const after = editor.doc.artboards[0].children[0].fill.color;
    const drew = host.runExtensionCommand('org.poulpe.rosette', 'draw', {
      petals: 5,
      depth: 50,
      color: '#ff0000',
      width: 3,
    });
    const path = editor.doc.artboards[0].children[1];
    return { shuffled, changed: before !== after, drew, type: path?.type, stroke: path?.stroke.paint.color };
  });
  expect(out).toEqual({ shuffled: true, changed: true, drew: true, type: 'path', stroke: '#ff0000' });
});
