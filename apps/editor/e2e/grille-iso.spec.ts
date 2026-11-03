import { expect, test } from '@playwright/test';

test('Affichage > Grille isométrique : la grille s’affiche et les formes s’y accrochent', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByRole('navigation', { name: 'Menu' }).getByText('Affichage', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Grille isométrique' }).click();
  const s = await page.evaluate(() => (window as any).poulpe.ui.get().settings);
  expect([s.grid, s.gridIso]).toEqual([true, true]);
  await page.screenshot({ path: 'test-results/grille-iso.png' });

  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 303, box.y + 307);
  await page.mouse.down();
  await page.mouse.move(box.x + 391, box.y + 389, { steps: 5 });
  await page.mouse.up();
  const n = await page.evaluate(() => {
    const ab = (window as any).poulpe.editor.doc.artboards[0];
    const r = ab.children[ab.children.length - 1];
    return { x: r.x, y: r.y };
  });
  // Point de la grille : x multiple de step·√3/2 et y multiple de step/2 (pas de grille ≥ 1).
  const steps = [1, 2, 5, 10, 20, 50, 100];
  const onLattice = steps.some((st) => {
    const a = (st * Math.sqrt(3)) / 2;
    const i = Math.round(n.x / a),
      j = Math.round(n.y / (st / 2));
    return Math.abs(n.x - i * a) < 1e-6 && Math.abs(n.y - (j * st) / 2) < 1e-6 && (i + j) % 2 === 0;
  });
  expect(onLattice).toBe(true);
});
