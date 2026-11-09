import { expect, test } from '@playwright/test';

/*
 * Moteur sans `CanvasRenderingContext2D.filter` (Safari, WebKitGTK : appli de bureau sous Linux) :
 * l'effet Flou doit quand même flouter (repli par calcul), au lieu de ne rien faire.
 */

test("l'effet Flou fonctionne quand le canevas ne sait pas filtrer", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
    delete (CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>).filter;
    if (typeof OffscreenCanvasRenderingContext2D !== 'undefined')
      delete (OffscreenCanvasRenderingContext2D.prototype as unknown as Record<string, unknown>).filter;
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(await page.evaluate(() => 'filter' in CanvasRenderingContext2D.prototype)).toBe(false);

  await page.keyboard.press('u');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 400, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => (window as any).poulpe.editor.select([]));
  const clip = { x: box.x + 270, y: box.y + 270, width: 220, height: 160 };
  const sharp = await page.screenshot({ clip });

  await page.evaluate(() => {
    (window as any).poulpe.editor.apply('test', (d: any) => {
      d.artboards[0].children[0].effects = [{ type: 'blur', enabled: true, radius: 20 }];
    });
  });
  await page.waitForTimeout(800);
  const soft = await page.screenshot({ clip });
  expect(soft.equals(sharp)).toBe(false);
});
