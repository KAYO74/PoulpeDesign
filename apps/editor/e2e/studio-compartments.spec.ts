import { expect, test, type Page } from '@playwright/test';

/* Panneau de droite en trois compartiments (Couleur…, Calques, Historique) aux tailles réglables. */

async function open(page: Page, settings: object = {}, panels?: object) {
  await page.addInitScript(
    ([s, p]) => {
      if (!localStorage.getItem('poulpe.settings'))
        localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false, ...(s as object) }));
      if (p && !localStorage.getItem('poulpe.panels'))
        localStorage.setItem('poulpe.panels', JSON.stringify(p));
    },
    [settings, panels],
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
}

const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;

test('trois compartiments : Couleur en haut, Calques au milieu, Historique en bas', async ({ page }) => {
  await open(page);
  const top = await box(page, 'studio-studio-top');
  const mid = await box(page, 'studio-studio-bottom');
  const base = await box(page, 'studio-studio-base');
  expect(top.y).toBeLessThan(mid.y);
  expect(mid.y).toBeLessThan(base.y);
  await expect(page.getByTestId('studio-studio-bottom').getByTestId('tab-layers')).toBeVisible();
  await expect(page.getByTestId('studio-studio-bottom').getByTestId('tab-history')).toHaveCount(0);
  await expect(page.getByTestId('studio-studio-base').getByTestId('tab-history')).toBeVisible();
  // Les Calques gardent de la place, et l'Historique reste dans la fenêtre.
  expect(mid.height).toBeGreaterThan(150);
  const studio = await box(page, 'studio');
  expect(base.y + base.height).toBeLessThanOrEqual(studio.y + studio.height + 1);
});

test('le séparateur Calques / Historique règle la hauteur de l’Historique, mémorisée', async ({ page }) => {
  await open(page);
  const h0 = (await box(page, 'studio-studio-base')).height;
  const sep = await box(page, 'studio-split-base');
  const x = sep.x + sep.width / 2;
  const y = sep.y + sep.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 40, { steps: 6 });
  await page.mouse.up();
  const h1 = (await box(page, 'studio-studio-base')).height;
  expect(h1).toBeGreaterThan(h0 + 30);
  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect((await box(page, 'studio-studio-base')).height).toBeCloseTo(h1, -1);
  // Double-clic : taille d'origine.
  await page.getByTestId('studio-split-base').dblclick();
  expect((await box(page, 'studio-studio-base')).height).toBeCloseTo(h0, -1);
});

test('le séparateur du haut règle la hauteur du premier compartiment', async ({ page }) => {
  await open(page);
  const h0 = (await box(page, 'studio-studio-top')).height;
  const sep = await box(page, 'studio-split');
  const x = sep.x + sep.width / 2;
  const y = sep.y + sep.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 50, { steps: 6 });
  await page.mouse.up();
  expect((await box(page, 'studio-studio-top')).height).toBeCloseTo(h0 - 50, -1);
});

test('un rangement enregistré avant les trois compartiments sort l’Historique des onglets de Calques', async ({
  page,
}) => {
  await open(
    page,
    {},
    {
      tabs: {
        draw: {
          top: ['color', 'stroke', 'effects', 'transform', 'character'],
          bottom: ['layers', 'history', 'macros'],
        },
      },
    },
  );
  await expect(page.getByTestId('studio-studio-bottom').getByTestId('tab-history')).toHaveCount(0);
  await expect(page.getByTestId('studio-studio-base').getByTestId('tab-history')).toBeVisible();
  await expect(page.getByTestId('studio-studio-bottom').getByTestId('tab-macros')).toBeVisible();
});

test('la petite flèche reste visible quand il y a beaucoup d’onglets', async ({ page }) => {
  await open(page);
  const studio = await box(page, 'studio');
  const tabsBar = page.getByTestId('studio-studio-top').locator('.studio-tabs');
  // Les onglets de Dessin débordent du Studio : la barre défile.
  const overflow = await tabsBar.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflow).toBe(true);
  const arrow = page.getByTestId('collapse-studio-top');
  const a = (await arrow.boundingBox())!;
  expect(a.x).toBeGreaterThanOrEqual(studio.x);
  expect(a.x + a.width).toBeLessThanOrEqual(studio.x + studio.width + 1);
  // Même après avoir fait défiler les onglets jusqu'au bout, elle ne bouge pas et plie le groupe.
  await tabsBar.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  const b = (await arrow.boundingBox())!;
  expect(Math.abs(b.x - a.x)).toBeLessThan(2);
  await arrow.click();
  await expect(page.getByTestId('studio-studio-top').locator('.studio-content')).toHaveCount(0);
});

test('Persona Photo : mêmes trois compartiments, flèches visibles dans un Studio étroit', async ({
  page,
}) => {
  await open(page, {}, { studioW: 240 });
  await page.evaluate(() => (window as any).poulpe.ui.set({ persona: 'photo' }));
  for (const g of ['top', 'bottom', 'base']) {
    const arrow = page.getByTestId(`collapse-studio-${g}`);
    await expect(arrow).toBeVisible();
    const studio = await box(page, 'studio');
    const a = (await arrow.boundingBox())!;
    expect(a.x + a.width).toBeLessThanOrEqual(studio.x + studio.width + 1);
  }
  await expect(page.getByTestId('studio-studio-bottom').getByTestId('tab-channels')).toBeVisible();
  await expect(page.getByTestId('studio-studio-base').getByTestId('tab-history')).toBeVisible();
});

test('replier l’Historique rend sa place aux Calques', async ({ page }) => {
  await open(page);
  const h0 = (await box(page, 'studio-studio-bottom')).height;
  await page.getByTestId('collapse-studio-base').click();
  const h1 = (await box(page, 'studio-studio-bottom')).height;
  expect(h1).toBeGreaterThan(h0 + 25);
});
