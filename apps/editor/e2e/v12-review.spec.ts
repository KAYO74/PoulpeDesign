import { expect, test, type Page } from '@playwright/test';

/*
 * Version 1.2 : corrections de la relecture d'ensemble (aperçu du redressement, poignées rouges et
 * de redimensionnement, outils temporaires, lasso polygonal, baguette magique interrompue, dureté
 * au clavier AZERTY, espaces de travail de la 1.1.5, Recadrage vectoriel, barre contextuelle).
 */

type AnyNode = Record<string, any>;

const kids = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
const history = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().history);
const tool = (page: Page): Promise<string> => page.evaluate(() => (window as any).poulpe.ui.get().tool);
const setUi = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((patch) => (window as any).poulpe.ui.set(patch), patch);
const busy = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as any).poulpe.controller().busy());

/** Position à l'écran (fenêtre) d'un point du document. */
async function screen(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const p = await page.evaluate(([x, y]) => (window as any).poulpe.controller().toScreen({ x, y }), [x, y]);
  return [box.x + p.x, box.y + p.y];
}

async function drag(page: Page, a: [number, number], b: [number, number], steps = 8) {
  await page.mouse.move(...(await screen(page, ...a)));
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, ...b)), { steps });
  await page.mouse.up();
}

async function click(page: Page, x: number, y: number) {
  await page.mouse.click(...(await screen(page, x, y)));
}

/** Photo de test 400×300 : fond bleu, un carré rouge au centre. */
async function openTestPhoto(page: Page) {
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3366cc';
    g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#dd2222';
    g.fillRect(170, 120, 60, 60);
    (window as any).poulpe.photo.openPhotoDocument(c.toDataURL('image/png'), 'image/png', 400, 300, 'Test');
  });
  await page.waitForTimeout(300);
}

/** Opacité de la sélection de pixels en un point du document (0 à 255). */
async function selectedAt(page: Page, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([x, y]) => {
      const s = (window as any).poulpe.photo.getSelection();
      if (!s) return 0;
      const g = s.canvas.getContext('2d')!;
      return g.getImageData(Math.floor((x - s.x) * s.scale), Math.floor((y - s.y) * s.scale), 1, 1).data[3];
    },
    [x, y],
  );
}

/** Ajoute un rectangle au premier plan de travail et le sélectionne. */
async function addRect(page: Page, id: string, x: number, y: number, w: number, h: number) {
  await page.evaluate(
    ([id, x, y, w, h]) => {
      (window as any).poulpe.editor.apply('history.add', (d: any) => {
        d.artboards[0].children.push({
          id,
          name: id,
          type: 'rect',
          x,
          y,
          width: w,
          height: h,
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
          locked: false,
          fill: { type: 'solid', color: '#22aa66' },
          stroke: { paint: { type: 'none' }, width: 0 },
          cornerRadius: 0,
        });
        return [id];
      });
    },
    [id, x, y, w, h] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false, snapping: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('redresser : l’aperçu ne prend ni les touches ni les autres commandes', async ({ page }) => {
  await openTestPhoto(page);
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
  await page.keyboard.press('c');
  await page.getByTestId('crop-straighten').click();
  await drag(page, [50, 100], [350, 153]);
  const preview = (await kids(page))[0];
  const rotation = preview.rotation;
  expect(Math.abs(((rotation + 180) % 360) - 180 + 10)).toBeLessThan(1);
  const before = await history(page);
  // Flèches, chiffres (opacité) et Suppr attendent la fin du recadrage.
  for (const key of ['ArrowRight', '5', 'Delete']) await page.keyboard.press(key);
  let [bg] = await kids(page);
  expect(bg).toMatchObject({ id: preview.id, x: preview.x, y: preview.y, opacity: 1, rotation });
  expect(await history(page)).toEqual(before);
  // Une autre commande passe sous l'aperçu, sans l'enregistrer.
  await page.evaluate(() =>
    (window as any).poulpe.editor.apply('history.rename', (d: any) => {
      d.artboards[0].name = 'Renommé';
    }),
  );
  [bg] = await kids(page);
  expect(bg.rotation).toBe(rotation);
  expect(await history(page)).not.toContain('history.crop');
  await page.getByTestId('crop-apply').click();
  expect((await history(page)).filter((h) => h === 'history.crop')).toHaveLength(1);
  // Annuler retire le recadrage, puis le renommage.
  await page.keyboard.press('Control+z');
  expect((await kids(page))[0].rotation).toBe(0);
  expect(await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].name)).toBe('Renommé');
});

test('lasso polygonal et baguette : changer d’outil ou interrompre ne laisse rien en plan', async ({
  page,
}) => {
  await openTestPhoto(page);
  await page.keyboard.press('l');
  await page.getByTestId('lasso-polygonal').click();
  for (const [x, y] of [
    [20, 20],
    [120, 20],
    [120, 100],
  ] as const)
    await click(page, x, y);
  expect(await busy(page)).toBe(true);
  // Un autre outil abandonne le polygone ouvert : le pinceau peint normalement.
  await page.keyboard.press('b');
  expect(await busy(page)).toBe(false);
  await drag(page, [200, 250], [300, 250]);
  expect(await history(page)).toContain('history.brush');
  // Un geste interrompu (pointercancel) l'abandonne aussi.
  await page.keyboard.press('l');
  await click(page, 20, 20);
  await click(page, 120, 20);
  await page.getByTestId('canvas').dispatchEvent('pointercancel');
  expect(await busy(page)).toBe(false);

  // Baguette magique interrompue : la sélection et la tolérance de départ reviennent.
  await setUi(page, { tool: 'marqueeRect' });
  await drag(page, [20, 20], [120, 100]);
  expect(await selectedAt(page, 60, 60)).toBe(255);
  const steps = (await history(page)).length;
  const tolerance = await page.evaluate(() => (window as any).poulpe.ui.get().tolerance);
  await setUi(page, { tool: 'magicWand' });
  await page.mouse.move(...(await screen(page, 300, 50)));
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, 340, 50)), { steps: 5 });
  expect(await selectedAt(page, 300, 50)).toBe(255);
  await page.getByTestId('canvas').dispatchEvent('pointercancel');
  await page.mouse.up();
  expect(await selectedAt(page, 60, 60)).toBe(255);
  expect(await selectedAt(page, 300, 50)).toBe(0);
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().tolerance)).toBe(tolerance);
  expect(await history(page)).toHaveLength(steps);
});

test('Maj + [ et ] : la dureté suit le caractère tapé (clavier AZERTY)', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('b');
  await setUi(page, { brushes: { brush: { size: 20, hardness: 50, opacity: 100, flow: 100 } } });
  // En AZERTY, ] est sur la touche ) (code Minus) et [ sur la touche 5 (code Digit5).
  const press = (key: string, code: string) =>
    page.evaluate(
      ([key, code]) =>
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key, code, shiftKey: true, bubbles: true }),
        ),
      [key, code],
    );
  const hardness = () => page.evaluate(() => (window as any).poulpe.ui.get().brushes.brush.hardness);
  await press(']', 'Minus');
  expect(await hardness()).toBe(60);
  await press('[', 'Digit5');
  await press('[', 'Digit5');
  expect(await hardness()).toBe(40);
});

test('outils temporaires : Main maintenue garde la plume, la touche relâchée en plein geste revient', async ({
  page,
}) => {
  await page.keyboard.press('p');
  expect(await tool(page)).toBe('pen');
  await click(page, 200, 200);
  await click(page, 400, 200);
  // H maintenue : on fait défiler la vue sans quitter le tracé en cours.
  const pan0 = await page.evaluate(() => (window as any).poulpe.ui.get().view.panX);
  await page.keyboard.down('h');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 600, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(box.x + 650, box.y + 500, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('h');
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().view.panX)).toBeCloseTo(pan0 + 50, 0);
  expect(await tool(page)).toBe('pen');
  expect(await busy(page)).toBe(true);
  await click(page, 400, 350);
  await page.keyboard.press('Enter');
  const path = (await kids(page)).at(-1)!;
  expect(path.type).toBe('path');
  expect(path.d.match(/[MLC]/g)).toHaveLength(3);

  // V maintenue, relâchée pendant le glissement : l'outil d'avant revient à la fin du geste.
  await addRect(page, 'r', 100, 400, 100, 100);
  await setUi(page, { tool: 'ellipse' });
  await page.keyboard.down('v');
  expect(await tool(page)).toBe('select');
  await page.mouse.move(...(await screen(page, 150, 450)));
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, 200, 450)), { steps: 5 });
  await page.keyboard.up('v');
  await page.mouse.up();
  await expect.poll(() => tool(page)).toBe('ellipse');
  expect((await kids(page)).find((n) => n.id === 'r')!.x).toBeCloseTo(150, 0);
});

test('Recadrage vectoriel : ni cadre photo, ni cadre peint, Réinitialiser depuis le contenu', async ({
  page,
}) => {
  await addRect(page, 'img', 100, 100, 400, 400);
  await setUi(page, { tool: 'vectorCrop' });
  await drag(page, [500, 300], [400, 300]);
  await page.keyboard.press('Enter');
  const g = (await kids(page))[0];
  expect(g.vectorCrop).toBe(true);
  // Une image glissée ou placée ne remplace pas le contenu d'un objet recadré.
  expect(
    await page.evaluate(() => (window as any).poulpe.library.frameTarget((window as any).poulpe.editor.doc)),
  ).toBeNull();
  expect(
    await page.evaluate(() =>
      (window as any).poulpe.library.frameTarget((window as any).poulpe.editor.doc, { x: 250, y: 300 }),
    ),
  ).toBeNull();
  // La pipette (couleur) peint le contenu, jamais le cadre invisible.
  await setUi(page, { tool: 'eyedropper' });
  await click(page, 700, 700);
  const after = (await kids(page))[0];
  expect(after.children[0].fill.type).toBe('none');
  expect(after.children[0].stroke.paint.type).toBe('none');
  expect(after.children[1].fill.color).not.toBe('#22aa66');
  // Le contenu sélectionné : Réinitialiser défait le recadrage.
  await page.evaluate(() => (window as any).poulpe.editor.select(['img']));
  await setUi(page, { tool: 'vectorCrop' });
  await expect(page.getByTestId('vcrop-reset')).toBeEnabled();
  await page.getByTestId('vcrop-reset').click();
  const list = await kids(page);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: 'img', width: 400 });
});

test('Persona Photo : le double-clic de l’outil Déplacer ne passe pas à l’outil Nœud', async ({ page }) => {
  await openTestPhoto(page);
  await setUi(page, { tool: 'select' });
  await page.mouse.dblclick(...(await screen(page, 200, 150)));
  expect(await tool(page)).toBe('select');
});

test('un espace de travail de la 1.1.5 garde son Lasso polygonal', async ({ page }) => {
  await page.getByTestId('workspace-menu').click();
  await page.getByTestId('workspace-new').click();
  await page.getByTestId('workspace-name').fill('Ancien');
  await page.getByTestId('workspace-base-photo').click();
  await page.getByTestId('workspace-tool-heal').click();
  await page.getByTestId('workspace-save').click();
  // Enregistré par la 1.1.5 : « polyLasso » à la place du lasso.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('poulpe.workspaces')!);
    const w = s.list.find((w: any) => w.name === 'Ancien');
    w.tools = w.tools.map((id: string) => (id === 'lasso' ? 'polyLasso' : id));
    localStorage.setItem('poulpe.workspaces', JSON.stringify(s));
  });
  await page.reload();
  await page.getByTestId('workspace-menu').click();
  await page.getByTestId('workspace-Ancien').click();
  await page.getByTestId('tool-lasso').click();
  expect(await tool(page)).toBe('lasso');
  await expect(page.getByTestId('lasso-polygonal')).toHaveAttribute('aria-pressed', 'true');
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('poulpe.workspaces')!).list.find((w: any) => w.name === 'Ancien').tools,
  );
  expect(saved).toContain('lasso');
  expect(saved).not.toContain('polyLasso');
});

test('la molette fait défiler la barre contextuelle qui déborde', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openTestPhoto(page);
  await page.keyboard.press('b');
  const bar = page.locator('.contextbar');
  const overflow = await bar.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflow).toBe(true);
  const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => bar.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test('les formes paramétriques se convertissent en courbes', async ({ page }) => {
  await setUi(page, { tool: 'triangle' });
  await drag(page, [200, 200], [400, 360]);
  expect((await kids(page))[0].shape.kind).toBe('triangle');
  expect(await page.evaluate(() => (window as any).poulpe.vector.canConvertToCurves())).toBe(true);
  await page.evaluate(() => (window as any).poulpe.vector.convertToCurves());
  await expect.poll(async () => (await kids(page))[0].shape).toBeUndefined();
  expect((await kids(page))[0].type).toBe('path');
});

test('retirer un masque garde les images des motifs', async ({ page }) => {
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const pattern = (assetId: string) => ({ type: 'pattern', assetId, scale: 1, angle: 0 });
    editor.apply('history.add', (d: any) => {
      for (const id of ['pat', 'line', 'bg', 'msk'])
        d.assets[id] = { id, mime: 'image/png', width: 1, height: 1, data: png };
      d.artboards[0].background = pattern('bg');
      d.artboards[0].children.push({
        id: 'r',
        name: 'r',
        type: 'rect',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
        fill: pattern('pat'),
        stroke: { paint: pattern('line'), width: 4 },
        cornerRadius: 0,
        mask: { assetId: 'msk', enabled: true },
      });
      return ['r'];
    });
  });
  await page.evaluate(() => (window as any).poulpe.photo.removeMask());
  const assets = Object.keys(await page.evaluate(() => (window as any).poulpe.editor.doc.assets));
  expect(assets).toEqual(expect.arrayContaining(['pat', 'line', 'bg']));
  expect(assets).not.toContain('msk');
});

test('correctif : l’aperçu d’une grande zone suit le pointeur', async ({ page }) => {
  // Grande photo (2400 × 1800) et zone de 1200 pixels : l'aperçu est calculé en réduction.
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 1800;
    const g = c.getContext('2d')!;
    for (let y = 0; y < 1800; y += 60)
      for (let x = 0; x < 2400; x += 60) {
        g.fillStyle = (x + y) % 120 ? '#3366cc' : '#4477dd';
        g.fillRect(x, y, 60, 60);
      }
    (window as any).poulpe.photo.openPhotoDocument(
      c.toDataURL('image/png'),
      'image/png',
      2400,
      1800,
      'Grande',
    );
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
  await setUi(page, { tool: 'patch' });
  const pts: [number, number][] = [
    [300, 300],
    [1500, 300],
    [1500, 1500],
    [300, 1500],
    [300, 320],
  ];
  await page.mouse.move(...(await screen(page, ...pts[0])));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...(await screen(page, ...p)), { steps: 6 });
  await page.mouse.up();
  // Écart le plus long entre deux images pendant le glissement.
  await page.evaluate(() => {
    const w = window as any;
    w.__gap = 0;
    let last = performance.now();
    const tick = (t: number) => {
      w.__gap = Math.max(w.__gap, t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(...(await screen(page, 900, 900)));
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(...(await screen(page, 900 + i * 40, 900)));
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(200);
  const gap = await page.evaluate(() => {
    const w = window as any;
    w.__stop = true;
    return w.__gap;
  });
  await page.mouse.up();
  expect(gap).toBeLessThan(700);
  expect(await history(page)).toContain('history.patch');
});
