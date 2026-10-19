import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Version 1.2.9 : partager des pinceaux (fichier .poulpebrushes) et les installer comme des extensions. */

const presets = (page: Page): Promise<{ name: string; tip?: string; angle?: number }[]> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('poulpe.brushPresets') ?? '[]'));
const tips = (page: Page): Promise<number> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('poulpe.brushTips') ?? '[]').length);

/** Une petite forme : un disque noir sur fond transparent (data URL PNG). */
const dot = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d')!;
    g.beginPath();
    g.arc(8, 8, 6, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL('image/png');
  });

async function chooseFile(page: Page, click: () => Promise<void>, file: { name: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await click();
  await (await chooser).setFiles({ ...file, mimeType: 'application/octet-stream' });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
    // Enregistrement par téléchargement (pas de fenêtre système dans les tests).
    delete (window as any).showSaveFilePicker;
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('un paquet de pinceaux s’installe et se retire depuis les extensions', async ({ page }) => {
  const data = await dot(page);
  const pack = {
    format: 'poulpe-brushes',
    version: 1,
    name: 'Points',
    author: 'Test',
    tips: [{ id: 'tip-a1', name: 'Point', data, w: 16, h: 16 }],
    presets: [
      {
        id: 'x',
        name: 'Pointillé',
        size: 30,
        hardness: 100,
        opacity: 100,
        flow: 100,
        tip: 'tip-a1',
        spacing: 120,
      },
    ],
  };
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'extensions' }));
  await chooseFile(page, () => page.getByTestId('ext-brushes-install').click(), {
    name: 'points.poulpebrushes',
    buffer: Buffer.from(JSON.stringify(pack)),
  });
  await expect(page.getByTestId('brush-pack-Points')).toBeVisible();
  const list = await presets(page);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ name: 'Pointillé', spacing: 120 });
  expect(list[0].tip).toMatch(/^tip-/);
  expect(await tips(page)).toBe(1);

  await page.getByTestId('brush-pack-Points').getByRole('button').click();
  await expect(page.getByTestId('brush-pack-Points')).toHaveCount(0);
  expect(await presets(page)).toHaveLength(0);
  expect(await tips(page)).toBe(0);
});

test('« Partager mes pinceaux » enregistre un fichier qui se réinstalle', async ({ page }) => {
  const data = await dot(page);
  await page.evaluate((data) => {
    localStorage.setItem(
      'poulpe.brushTips',
      JSON.stringify([{ id: 'tip-b2', name: 'Point', data, w: 16, h: 16 }]),
    );
    localStorage.setItem(
      'poulpe.brushPresets',
      JSON.stringify([
        {
          id: 'user-1',
          name: 'Mon point',
          size: 12,
          hardness: 100,
          opacity: 100,
          flow: 100,
          tip: 'tip-b2',
          angle: 30,
        },
      ]),
    );
  }, data);
  await page.reload();
  await page.getByTestId('persona-photo').click();
  await page.keyboard.press('b');
  await page.getByTestId('studio').getByTestId('tab-brush').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('brushes-share').click();
  const file = await (await download).path();
  const shared = JSON.parse(readFileSync(file!, 'utf8'));
  expect(shared).toMatchObject({ format: 'poulpe-brushes', name: 'Mes pinceaux' });
  expect(shared.presets[0]).toMatchObject({ name: 'Mon point', tip: 'tip-b2', angle: 30 });
  expect(shared.tips[0]).toMatchObject({ id: 'tip-b2', data });

  // Réinstallé (chez un autre) : le pinceau arrive avec sa forme.
  await page.evaluate(() => {
    localStorage.removeItem('poulpe.brushTips');
    localStorage.removeItem('poulpe.brushPresets');
  });
  await page.reload();
  await page.getByTestId('persona-photo').click();
  await page.keyboard.press('b');
  await page.getByTestId('studio').getByTestId('tab-brush').click();
  await chooseFile(page, () => page.getByTestId('brushes-install').click(), {
    name: 'Mes pinceaux.poulpebrushes',
    buffer: readFileSync(file!),
  });
  await expect.poll(async () => (await presets(page)).map((p) => p.name)).toEqual(['Mon point']);
  expect(await tips(page)).toBe(1);
});

test('installe les formes d’un fichier Affinity (.afbrushes)', async ({ page }) => {
  const png = Buffer.from((await dot(page)).split(',')[1], 'base64');
  const af = Buffer.concat([
    Buffer.from('AFBRUSH-HEADER-0000'),
    png,
    Buffer.from('junk'),
    png,
    Buffer.from('end'),
  ]);
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'extensions' }));
  await chooseFile(page, () => page.getByTestId('ext-brushes-install').click(), {
    name: 'Encre.afbrushes',
    buffer: af,
  });
  await expect(page.getByTestId('brush-pack-Encre')).toBeVisible();
  expect((await presets(page)).map((p) => p.name)).toEqual(['Encre 1', 'Encre 2']);
});
