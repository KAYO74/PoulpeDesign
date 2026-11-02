import { expect, test } from '@playwright/test';
import { writePsd } from 'ag-psd';

/* Import PSD : les calques de réglage Photoshop deviennent des réglages Poulpe. */

test('un PSD avec calques de réglage est relu en réglages Poulpe', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();

  const bytes = writePsd(
    {
      width: 8,
      height: 8,
      children: [
        {
          name: 'Balance',
          adjustment: { type: 'color balance', midtones: { cyanRed: 20, magentaGreen: 0, yellowBlue: -10 } },
        },
        { name: 'N&B', adjustment: { type: 'black & white', reds: 50, greens: 30, blues: 20 } },
        {
          name: 'Filtre',
          adjustment: { type: 'photo filter', color: { r: 255, g: 128, b: 0 }, density: 40 },
        },
        {
          name: 'Dégradé',
          adjustment: {
            type: 'gradient map',
            gradientType: 'solid',
            colorStops: [
              { color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: 50 },
              { color: { r: 255, g: 255, b: 255 }, location: 4096, midpoint: 50 },
            ],
          },
        },
      ],
    } as never,
    { generateThumbnail: false },
  );
  page.once('dialog', (d) => void d.accept());
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Fichier' }).click();
  await page.getByRole('menuitem', { name: 'Ouvrir…' }).first().click();
  await (
    await chooser
  ).setFiles({ name: 'R.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: Buffer.from(bytes) });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).poulpe.editor.doc.artboards[0].children.map((n: any) => n.adjustment?.kind),
      ),
    )
    .toEqual(['colorBalance', 'blackWhite', 'photoFilter', 'gradientMap']);
});
