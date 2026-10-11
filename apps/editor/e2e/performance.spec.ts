import { expect, test, type Page } from '@playwright/test';

/*
 * Cache d'images du canevas : ce qui est affiché doit être identique, au pixel près (à l'arrondi
 * des bords lissés près), à un dessin complet sans cache.
 */

type Poulpe = {
  editor: {
    doc: { artboards: { children: { id: string }[] }[] };
    select: (ids: string[]) => void;
    begin: () => void;
    preview: (fn: (d: any) => void) => void;
    commit: (label: string) => void;
    apply: (label: string, fn: (d: any) => void) => void;
  };
  controller: () => {
    draw: () => void;
    invalidate: () => void;
    zoomToFit: () => void;
    renderIdle: () => Promise<boolean>;
    canvas: HTMLCanvasElement;
  };
  perf: {
    setPerformanceSettings: (p: Record<string, unknown>) => unknown;
    renderStats: () => { entries: number; hits: number };
  };
  loadBenchDocument: (n: number) => Promise<void>;
  ui: { get: () => { view: { zoom: number; panX: number; panY: number } } };
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.evaluate(async () => {
    const p = (window as unknown as { poulpe: Poulpe }).poulpe;
    // Dessin dans la page : les comparaisons ci-dessous sont synchrones.
    p.perf.setPerformanceSettings({ parallelDrawing: false });
    await p.loadBenchDocument(300);
    p.controller().zoomToFit();
  });
});

/** Dessine avec puis sans cache et renvoie l'écart entre les deux images. */
async function compareWithoutCache(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as { poulpe: Poulpe }).poulpe;
    const c = p.controller();
    const ctx = c.canvas.getContext('2d')!;
    const grab = () => ctx.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
    c.draw();
    const cached = grab();
    p.perf.setPerformanceSettings({ cacheMb: 0 });
    c.draw();
    const full = grab();
    p.perf.setPerformanceSettings({ cacheMb: 256 });
    // Le bord du plan de travail (une ligne de pixels lissés) est laissé de côté.
    const ab = p.editor.doc.artboards[0] as unknown as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const { zoom, panX, panY } = p.ui.get().view;
    const dpr = window.devicePixelRatio || 1;
    const x0 = Math.max(0, Math.ceil((ab.x * zoom + panX) * dpr) + 2);
    const y0 = Math.max(0, Math.ceil((ab.y * zoom + panY) * dpr) + 2);
    const x1 = Math.min(c.canvas.width, Math.floor(((ab.x + ab.width) * zoom + panX) * dpr) - 2);
    const y1 = Math.min(c.canvas.height, Math.floor(((ab.y + ab.height) * zoom + panY) * dpr) - 2);
    // Les bords lissés des formes peuvent différer de quelques niveaux (calcul du lissage dans
    // une image à part) : on compte les vrais écarts, comme un objet manquant ou décalé.
    let bad = 0,
      sum = 0,
      count = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        for (let k = 0; k < 4; k++) {
          const i = (y * c.canvas.width + x) * 4 + k;
          const d = Math.abs(full[i] - cached[i]);
          sum += d;
          count++;
          if (d > 32) bad++;
        }
    return { bad, mean: sum / Math.max(1, count), count, stats: p.perf.renderStats() };
  });
}

test('le cache affiche la même image que le dessin complet', async ({ page }) => {
  const still = await compareWithoutCache(page);
  expect(still.count).toBeGreaterThan(100000);
  expect(still.bad).toBe(0);
  expect(still.mean).toBeLessThan(0.2);

  // Pendant un déplacement : les objets sélectionnés en direct, le reste vient des images gardées.
  const moving = await page.evaluate(() => {
    const p = (window as unknown as { poulpe: Poulpe }).poulpe;
    const kids = p.editor.doc.artboards[0].children;
    const ids = [kids[40].id, kids[120].id, kids[200].id];
    p.editor.select(ids);
    p.controller().draw();
    p.editor.begin();
    p.editor.preview((d) => {
      for (const n of d.artboards[0].children) if (ids.includes(n.id)) n.x += 80;
    });
    return ids;
  });
  expect(moving).toHaveLength(3);
  const during = await compareWithoutCache(page);
  expect(during.bad).toBe(0);
  expect(during.mean).toBeLessThan(0.2);
  expect(during.stats.hits).toBeGreaterThan(0);

  // Un objet non sélectionné change (par une commande) : son image gardée est refaite.
  await page.evaluate(() => {
    const p = (window as unknown as { poulpe: Poulpe }).poulpe;
    p.editor.commit('history.move');
    p.editor.apply('history.fill', (d) => {
      d.artboards[0].children[10].fill = { type: 'solid', color: '#00ff00' };
    });
  });
  const changed = await compareWithoutCache(page);
  expect(changed.bad).toBe(0);
  expect(changed.mean).toBeLessThan(0.2);
});

test('bouger la souris sur le fond ne redessine pas le document', async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  // Coin du canevas : hors du plan de travail.
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    (window as unknown as { drawn: number }).drawn = 0;
    window.addEventListener('poulpe:drawn', () => (window as unknown as { drawn: number }).drawn++);
  });
  for (let i = 0; i < 10; i++) await page.mouse.move(box.x + 4 + i, box.y + 4 + (i % 3));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { drawn: number }).drawn)).toBe(0);
});

test('le dessin sur plusieurs cœurs donne la même image', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const p = (window as unknown as { poulpe: Poulpe }).poulpe;
    const c = p.controller();
    const ctx = c.canvas.getContext('2d')!;
    const grab = () => ctx.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
    p.perf.setPerformanceSettings({ parallelDrawing: true });
    c.draw();
    const waited = await c.renderIdle();
    c.draw();
    const parallel = grab();
    p.perf.setPerformanceSettings({ parallelDrawing: false });
    c.draw();
    const sync = grab();
    let bad = 0;
    for (let i = 0; i < sync.length; i++) if (Math.abs(sync[i] - parallel[i]) > 32) bad++;
    return { waited, bad };
  });
  expect(r.waited).toBe(true);
  expect(r.bad).toBe(0);
});
