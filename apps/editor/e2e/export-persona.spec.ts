import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

/* Persona Export : des tranches (calques, plans de travail) exportées en plusieurs formats d'un clic. */

test('crée la tranche d’une forme, choisit ses formats et exporte un ZIP', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
    // Téléchargement classique plutôt que la fenêtre d'enregistrement du navigateur.
    delete (window as any).showSaveFilePicker;
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 380, { steps: 4 });
  await page.mouse.up();

  await page.getByTestId('persona-export').click();
  const panel = page.getByTestId('slices-panel');
  await expect(panel).toBeVisible();
  await panel.getByTestId('slices-from-selection').click();
  await panel.getByTestId('slices-from-artboards').click();
  const slices = await page.evaluate(() => (window as any).poulpe.editor.doc.slices);
  expect(slices).toHaveLength(2);
  expect(slices[0].layerId).toBeTruthy();
  const first = panel.getByTestId(`slice-${slices[0].id}`);
  await first.getByRole('button', { name: 'PNG 2x' }).click();
  await first.getByRole('button', { name: 'SVG' }).click();
  await first.getByRole('textbox').fill('bouton');
  await first.getByRole('textbox').press('Enter');
  await expect(panel.getByTestId('slices-export')).toHaveText('Exporter les tranches (4 fichiers)');

  const download = page.waitForEvent('download');
  await panel.getByTestId('slices-export').click();
  const zip = unzipSync(readFileSync((await (await download).path())!));
  const names = Object.keys(zip).sort();
  expect(names).toHaveLength(4);
  expect(names).toContain('bouton.png');
  expect(names).toContain('bouton@2x.png');
  expect(names).toContain('bouton.svg');
  // La tranche du calque fait la taille du calque (100 × 80), le double en 2x.
  const size = (b: Uint8Array) => [
    new DataView(b.buffer, b.byteOffset).getUint32(16),
    new DataView(b.buffer, b.byteOffset).getUint32(20),
  ];
  const w = (await page.evaluate(
    () => (window as any).poulpe.editor.doc.artboards[0].children[0].width,
  )) as number;
  expect(size(zip['bouton@2x.png'])[0]).toBe(Math.round(size(zip['bouton.png'])[0] * 2));
  expect(Math.abs(size(zip['bouton.png'])[0] - w)).toBeLessThanOrEqual(1);
});
