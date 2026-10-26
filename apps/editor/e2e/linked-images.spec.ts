import { expect, test } from '@playwright/test';

/* Objets dynamiques liés : une image placée avec un lien suit son fichier quand il change. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('studio').getByTestId('tab-layers').click();
  // Faux disque : un fichier « photo.png » dont on peut changer le contenu et la date.
  await page.evaluate(async () => {
    const png = async (color: string, w: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = 10;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, 10);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const disk = { bytes: await png('#ff0000', 20), modified: 1000, other: await png('#0000ff', 40) };
    (window as any).disk = disk;
    (window as any).poulpe.links.setLinkFs({
      modified: async (path: string) => (path === '/photos/photo.png' ? disk.modified : null),
      readFile: async () => disk.bytes,
    });
  });
});

const image = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const d = (window as any).poulpe.editor.doc;
    const n = d.artboards[0].children[0];
    return { link: n.link, width: d.assets[n.assetId].width, box: n.width };
  });

test('place une image liée, la met à jour quand le fichier change, puis l’incorpore', async ({ page }) => {
  await page.evaluate(() => (window as any).poulpe.links.placeLinkedPath('/photos/photo.png'));
  await expect
    .poll(async () => (await image(page)).link)
    .toEqual({ path: '/photos/photo.png', modified: 1000 });
  const first = await image(page);
  expect(first.width).toBe(20);
  const id = await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].id);
  await expect(page.getByTestId(`layer-link-${id}`)).toBeVisible();

  // Fichier inchangé : rien à faire. Fichier modifié : l'image est relue, la boîte ne bouge pas.
  expect(await page.evaluate(() => (window as any).poulpe.links.updateLinkedImages())).toBe(0);
  await page.evaluate(() => {
    const disk = (window as any).disk;
    disk.bytes = disk.other;
    disk.modified = 2000;
  });
  expect(await page.evaluate(() => (window as any).poulpe.links.updateLinkedImages())).toBe(1);
  const second = await image(page);
  expect(second).toMatchObject({ width: 40, box: first.box, link: { modified: 2000 } });

  // Calque › Objet dynamique › Incorporer l'image liée.
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Objet dynamique' }).hover();
  await page
    .getByRole('menu', { name: 'Objet dynamique' })
    .getByRole('menuitem', { name: 'Incorporer l’image liée' })
    .click();
  expect((await image(page)).link).toBeUndefined();
  await expect(page.getByTestId(`layer-link-${id}`)).toHaveCount(0);
});

test('un fichier lié introuvable garde l’image incorporée', async ({ page }) => {
  await page.evaluate(() => (window as any).poulpe.links.placeLinkedPath('/photos/photo.png'));
  await expect.poll(async () => (await image(page)).link?.path).toBe('/photos/photo.png');
  await page.evaluate(() =>
    (window as any).poulpe.editor.apply('test', (d: any) => {
      d.artboards[0].children[0].link.path = '/photos/disparue.png';
    }),
  );
  expect(await page.evaluate(() => (window as any).poulpe.links.updateLinkedImages(true))).toBe(0);
  await expect(page.getByText('1 image(s) liée(s) introuvable(s)', { exact: false })).toBeVisible();
  expect((await image(page)).width).toBe(20);
});
