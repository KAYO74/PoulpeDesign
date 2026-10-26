import { expect, test, type Page } from '@playwright/test';
import { choose } from './choose';

/*
 * Version 1.2 : outil Déplacer (Ctrl depuis le centre, Alt + clic, double-clic, options de la
 * barre), duplication intelligente, poignées du plan de travail, Recadrage vectoriel et Pipette
 * de style.
 */

type AnyNode = Record<string, any>;

const doc = (page: Page): Promise<AnyNode> => page.evaluate(() => (window as any).poulpe.editor.doc);
const kids = async (page: Page): Promise<AnyNode[]> => (await doc(page)).artboards[0].children;
const selection = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.selection);
const tool = (page: Page): Promise<string> => page.evaluate(() => (window as any).poulpe.ui.get().tool);
const setTool = (page: Page, id: string) =>
  page.evaluate((id) => (window as any).poulpe.ui.set({ tool: id }), id);

/** Position à l'écran (fenêtre) d'un point du document. */
async function screen(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const v = await page.evaluate(() => (window as any).poulpe.ui.get().view);
  return [box.x + x * v.zoom + v.panX, box.y + y * v.zoom + v.panY];
}

async function drag(page: Page, a: [number, number], b: [number, number]) {
  await page.mouse.move(...(await screen(page, ...a)));
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, ...b)), { steps: 8 });
  await page.mouse.up();
}

async function click(page: Page, x: number, y: number) {
  await page.mouse.click(...(await screen(page, x, y)));
}

/** Ajoute un rectangle au premier plan de travail et le sélectionne. */
async function addRect(page: Page, name: string, x: number, y: number, w: number, h: number, extra = {}) {
  return page.evaluate(
    ([name, x, y, w, h, extra]) => {
      const { editor } = (window as any).poulpe;
      const id = `r_${name}`;
      editor.apply('history.add', (d: any) => {
        d.artboards[0].children.push({
          id,
          name,
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
          ...(extra as object),
        });
        return [id];
      });
      return id;
    },
    [name, x, y, w, h, extra] as const,
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

test('outil Déplacer : Ctrl part du centre, Alt + clic, Alt + glisser, double-clic', async ({ page }) => {
  await addRect(page, 'A', 100, 100, 400, 400);
  const b = await addRect(page, 'B', 200, 200, 200, 200);

  // Ctrl + poignée droite : la largeur change des deux côtés.
  await page.keyboard.down('Control');
  await drag(page, [400, 300], [450, 300]);
  await page.keyboard.up('Control');
  let B = (await kids(page))[1];
  expect(B.width).toBeCloseTo(300, 0);
  expect(B.x).toBeCloseTo(150, 0);
  // Alt marche toujours.
  await page.keyboard.down('Alt');
  await drag(page, [450, 300], [400, 300]);
  await page.keyboard.up('Alt');
  B = (await kids(page))[1];
  expect(B.width).toBeCloseTo(200, 0);
  expect(B.x).toBeCloseTo(200, 0);

  // Alt + clic : l'objet de dessous, puis de nouveau celui du dessus.
  await page.keyboard.down('Alt');
  await click(page, 300, 300);
  expect(await selection(page)).toEqual(['r_A']);
  await click(page, 300, 300);
  expect(await selection(page)).toEqual([b]);
  // Alt + glisser duplique toujours.
  await drag(page, [300, 300], [350, 300]);
  await page.keyboard.up('Alt');
  expect(await kids(page)).toHaveLength(3);
  const history = await page.evaluate(() => (window as any).poulpe.editor.getState().history);
  expect(history.at(-1)).toBe('history.duplicate');
  // Ctrl+J répète le décalage de la copie faite en glissant.
  await page.keyboard.press('Control+j');
  const four = await kids(page);
  expect(four).toHaveLength(4);
  expect(four[2].x).toBeCloseTo(250, 0);
  expect(four[3].x).toBeCloseTo(300, 0);

  // Double-clic sur une forme : outil Nœud.
  await page.mouse.dblclick(...(await screen(page, 450, 450)));
  expect(await tool(page)).toBe('direct');
  expect(await selection(page)).toEqual(['r_A']);

  // Double-clic sur un texte : il s'édite toujours.
  await page.keyboard.press('t');
  await click(page, 700, 900);
  await page.keyboard.type('Bonjour');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const text = (await kids(page)).find((n) => n.type === 'text')!;
  await page.mouse.dblclick(...(await screen(page, text.x + text.width / 2, text.y + text.height / 2)));
  await expect.poll(() => page.evaluate(() => (window as any).poulpe.ui.get().editingTextId)).toBe(text.id);
});

test('outil Déplacer : sélection auto, alignement, groupes, point d’origine, séparément', async ({
  page,
}) => {
  await addRect(page, 'a', 100, 100, 100, 100);
  await addRect(page, 'b', 300, 150, 100, 100);
  await page.keyboard.press('Control+a');
  await page.getByTestId('move-group').click();
  let list = await kids(page);
  expect(list).toHaveLength(1);
  const groupId = list[0].id;

  // Sélection auto Objet : le clic choisit le rectangle dans le groupe.
  await page.keyboard.press('Escape');
  await choose(page.getByTestId('move-autoselect'), 'object');
  await click(page, 150, 150);
  expect(await selection(page)).toEqual(['r_a']);
  // Calque : le groupe.
  await choose(page.getByTestId('move-autoselect'), 'layer');
  await page.keyboard.press('Escape');
  await click(page, 150, 150);
  expect(await selection(page)).toEqual([groupId]);

  // Dissocier, puis aligner à gauche.
  await page.getByTestId('move-ungroup').click();
  expect(await kids(page)).toHaveLength(2);
  await page.keyboard.press('Control+a');
  await page.getByTestId('move-align-left').click();
  list = await kids(page);
  expect(list[0].x).toBeCloseTo(list[1].x, 3);

  // Transformer séparément : chaque objet grandit autour de son centre.
  await page.getByTestId('move-separately').click();
  const before = await kids(page);
  const right = Math.max(...before.map((n) => n.x + n.width));
  const bottom = Math.max(...before.map((n) => n.y + n.height));
  await drag(page, [right, bottom], [right + 50, bottom]);
  const after = await kids(page);
  for (let i = 0; i < 2; i++) {
    expect(after[i].width).toBeCloseTo(150, 0);
    expect(after[i].x + after[i].width / 2).toBeCloseTo(before[i].x + before[i].width / 2, 0);
  }
  await page.getByTestId('move-separately').click();

  // Point d'origine : glissé sur le coin haut gauche, il sert à Ctrl et à la rotation.
  await addRect(page, 'c', 600, 600, 100, 100);
  const a = (await kids(page))[2];
  await page.getByTestId('move-origin').click();
  await drag(page, [a.x + a.width / 2, a.y + a.height / 2], [a.x + 2, a.y + 2]);
  await page.keyboard.down('Control');
  await drag(page, [a.x + a.width, a.y + a.height / 2], [a.x + a.width + 60, a.y + a.height / 2]);
  await page.keyboard.up('Control');
  await page.screenshot({ path: 'test-results/outil-deplacer-origine.png' });
  const r = (await kids(page))[2];
  expect(r.x).toBeCloseTo(a.x, 0);
  expect(r.width).toBeCloseTo(a.width + 60, 0);
  // Rotation de 90° autour du coin (Maj : par pas de 15°).
  const zoom = await page.evaluate(() => (window as any).poulpe.ui.get().view.zoom);
  const handle: [number, number] = [r.x + r.width / 2, r.y - 22 / zoom];
  const target: [number, number] = [r.x + 22 / zoom, r.y + r.width / 2];
  await page.keyboard.down('Shift');
  await drag(page, handle, target);
  await page.keyboard.up('Shift');
  const turned = (await kids(page))[2];
  expect(Math.round(turned.rotation)).toBe(90);
  // Le coin haut gauche n'a pas bougé : le centre a tourné autour de lui.
  expect(turned.x + turned.width / 2).toBeCloseTo(r.x - r.height / 2, 0);
  expect(turned.y + turned.height / 2).toBeCloseTo(r.y + r.width / 2, 0);
});

test('double-clic dans un groupe : l’objet, puis l’outil Nœud', async ({ page }) => {
  await addRect(page, 'a', 100, 100, 100, 100);
  await addRect(page, 'b', 300, 150, 100, 100);
  await page.keyboard.press('Control+a');
  await page.getByTestId('move-group').click();
  await page.keyboard.press('Escape');
  const groupId = (await kids(page))[0].id;
  // Sélection auto Calque : le clic prend le groupe, le double-clic l'objet dedans.
  await page.mouse.dblclick(...(await screen(page, 150, 150)));
  expect(await selection(page)).toEqual(['r_a']);
  expect(await tool(page)).toBe('select');
  await page.mouse.dblclick(...(await screen(page, 150, 150)));
  expect(await tool(page)).toBe('direct');
  expect(await selection(page)).toEqual(['r_a']);
  expect((await kids(page))[0].id).toBe(groupId);
});

test('duplication intelligente : Ctrl+J répète le déplacement de la copie', async ({ page }) => {
  await addRect(page, 'r', 100, 100, 100, 100);
  await page.keyboard.press('Control+j');
  let list = await kids(page);
  expect(list).toHaveLength(2);
  expect(list[1].x).toBeCloseTo(120, 3);
  // La copie est déplacée de (+80, -20) : elle est à (+100, 0) de l'original.
  await drag(page, [170, 170], [250, 150]);
  list = await kids(page);
  expect(list[1].x).toBeCloseTo(200, 0);
  expect(list[1].y).toBeCloseTo(100, 0);
  await page.keyboard.press('Control+j');
  await page.keyboard.press('Control+j');
  list = await kids(page);
  expect(list).toHaveLength(4);
  expect(list[2].x).toBeCloseTo(300, 0);
  expect(list[3].x).toBeCloseTo(400, 0);
  expect(list[3].y).toBeCloseTo(100, 0);
  // Une autre sélection : Ctrl+J revient à la copie décalée.
  await click(page, 150, 150);
  await page.keyboard.press('Control+j');
  list = await kids(page);
  expect(list[1].x).toBeCloseTo(120, 0);

  // Copie tournée autour du point d'origine : les copies suivantes restent sur le même cercle.
  await addRect(page, 's', 300, 500, 100, 100);
  await page.keyboard.press('Control+j');
  await page.getByTestId('move-origin').click();
  await drag(page, [370, 570], [322, 618]);
  const zoom = await page.evaluate(() => (window as any).poulpe.ui.get().view.zoom);
  const off = 22 / zoom;
  await page.keyboard.down('Shift');
  await drag(page, [370, 520 - off], [420 + off, 670]);
  await page.keyboard.up('Shift');
  const center = async () => {
    const id = (await selection(page))[0];
    const n = (await kids(page)).find((k) => k.id === id)!;
    return { x: n.x + n.width / 2, y: n.y + n.height / 2, rotation: n.rotation };
  };
  let c = await center();
  expect(Math.round(c.rotation)).toBe(90);
  expect(Math.hypot(c.x - 320, c.y - 620)).toBeCloseTo(Math.hypot(50, 50), 0);
  for (const [x, y] of [
    [270, 670],
    [270, 570],
  ]) {
    await page.keyboard.press('Control+j');
    c = await center();
    expect(c.x).toBeCloseTo(x, 0);
    expect(c.y).toBeCloseTo(y, 0);
  }
});

test('outil Plan de travail : poignées du plan de travail actif', async ({ page }) => {
  await page.getByTestId('tool-artboard').click();
  const ab = (await doc(page)).artboards[0];
  const [x1, y1] = [ab.x + ab.width, ab.y + ab.height];
  await drag(page, [x1, y1], [x1 + 100, y1 + 50]);
  let now = (await doc(page)).artboards[0];
  expect(now.width).toBe(ab.width + 100);
  expect(now.height).toBe(ab.height + 50);
  expect(now.x).toBe(ab.x);
  await page.screenshot({ path: 'test-results/plan-de-travail-poignees.png' });
  // Maj : les proportions sont gardées.
  await page.keyboard.down('Shift');
  const mid = now.y + now.height / 2;
  await drag(page, [now.x + now.width, mid], [now.x + now.width + 200, mid]);
  await page.keyboard.up('Shift');
  const prev = now;
  now = (await doc(page)).artboards[0];
  expect(now.width).toBeCloseTo(prev.width + 200, -1);
  expect(now.height / now.width).toBeCloseTo(prev.height / prev.width, 2);
  // La barre garde les formats.
  await expect(page.getByRole('button', { name: 'Format', exact: true })).toBeVisible();
  // Glisser dans le plan de travail le déplace toujours.
  await drag(page, [200, 200], [300, 200]);
  expect((await doc(page)).artboards[0].x).toBeCloseTo(ab.x + 100, 0);
});

test('Recadrage vectoriel : poignées, contenu déplacé, export, réinitialiser', async ({ page }) => {
  await addRect(page, 'img', 100, 100, 400, 400);
  await setTool(page, 'vectorCrop');
  // Poignée droite vers la gauche : le cadre rétrécit, l'objet reste entier.
  await drag(page, [500, 300], [400, 300]);
  let g = (await kids(page))[0];
  expect(g.type).toBe('group');
  expect(g.vectorCrop).toBe(true);
  expect(g.children[0].width).toBeCloseTo(300, 0);
  expect(g.children[1]).toMatchObject({ id: 'r_img', width: 400 });
  expect(await selection(page)).toEqual([g.id]);
  // Glisser dedans déplace le contenu sous le cadre.
  await drag(page, [250, 300], [200, 300]);
  g = (await kids(page))[0];
  expect(g.children[1].x).toBeCloseTo(50, 0);
  expect(g.children[0].x).toBeCloseTo(100, 0);
  // L'export SVG découpe le contenu.
  const svg = await page.evaluate(() => {
    const p = (window as any).poulpe;
    return p.core.artboardToSvg(p.editor.doc, p.editor.doc.artboards[0]);
  });
  expect(svg).toContain('clipPath');
  await page.screenshot({ path: 'test-results/recadrage-vectoriel.png' });
  // Entrée termine : retour à l'outil Déplacer.
  await page.keyboard.press('Enter');
  expect(await tool(page)).toBe('select');
  expect(await selection(page)).toEqual([g.id]);
  // Réinitialiser : l'objet retrouve sa forme entière.
  await setTool(page, 'vectorCrop');
  await page.getByTestId('vcrop-reset').click();
  const list = await kids(page);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: 'r_img', width: 400 });
  expect(list[0].x).toBeCloseTo(50, 0);
});

test('Pipette de style : prendre, appliquer selon les options, décharger', async ({ page }) => {
  await addRect(page, 'src', 100, 100, 100, 100, {
    fill: { type: 'solid', color: '#ff0000' },
    stroke: { paint: { type: 'solid', color: '#0000ff' }, width: 6 },
    opacity: 0.5,
  });
  await addRect(page, 'dst', 300, 100, 100, 100);
  // I passe de la pipette à la pipette de style.
  await page.keyboard.press('i');
  expect(await tool(page)).toBe('eyedropper');
  await page.keyboard.press('i');
  expect(await tool(page)).toBe('stylePicker');
  await click(page, 150, 150);
  await expect(page.getByTestId('sp-loaded')).toBeVisible();
  await page.getByTestId('sp-effects').uncheck();
  await page.screenshot({ path: 'test-results/pipette-de-style.png' });
  await click(page, 350, 150);
  let dst = (await kids(page))[1];
  expect(dst.fill).toEqual({ type: 'solid', color: '#ff0000' });
  expect(dst.stroke.width).toBe(6);
  expect(dst.opacity).toBe(1);
  await page.getByTestId('sp-effects').check();
  await click(page, 350, 150);
  dst = (await kids(page))[1];
  expect(dst.opacity).toBe(0.5);
  // Décharger : le clic suivant prend un nouveau style.
  await page.getByTestId('sp-unload').click();
  await expect(page.getByTestId('sp-loaded')).toBeHidden();
  await click(page, 350, 150);
  await expect(page.getByTestId('sp-loaded')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sp-loaded')).toBeHidden();
});

test('Recadrage vectoriel : pipette sur le vide, dissocier, objet d’un cadre d’image', async ({ page }) => {
  await addRect(page, 'img', 100, 100, 400, 400, { fill: { type: 'solid', color: '#ff0000' } });
  await addRect(page, 'dst', 700, 100, 100, 100);
  await page.evaluate(() => (window as any).poulpe.editor.select(['r_img']));
  await setTool(page, 'vectorCrop');
  await drag(page, [500, 300], [400, 300]);
  // Le contenu glisse à droite : le cadre a une bande vide à gauche (100 à 200).
  await drag(page, [250, 300], [350, 300]);
  let g = (await kids(page))[0];
  expect(g.children[1].x).toBeCloseTo(200, 0);

  // Pipette de style : le cadre invisible n'est ni pris ni modifié.
  await setTool(page, 'stylePicker');
  await click(page, 150, 300);
  await expect(page.getByTestId('sp-loaded')).toBeHidden();
  await click(page, 750, 150);
  await expect(page.getByTestId('sp-loaded')).toBeVisible();
  await click(page, 150, 300);
  g = (await kids(page))[0];
  expect(g.children[0].fill.type).toBe('none');
  expect(g.children[1].fill.color).toBe('#ff0000');

  // Dissocier : le cadre invisible disparaît avec le recadrage.
  await setTool(page, 'select');
  await page.evaluate((id) => (window as any).poulpe.editor.select([id]), g.id);
  await page.getByTestId('move-ungroup').click();
  const list = await kids(page);
  expect(list.map((n) => n.id)).toEqual(['r_img', 'r_dst']);
  expect(await selection(page)).toEqual(['r_img']);

  // L'objet d'un cadre d'image : on recadre le cadre entier, qui reste un cadre d'image.
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    const common = (id: string) => ({
      id,
      name: id,
      x: 100,
      y: 600,
      width: 300,
      height: 200,
      rotation: 0,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      locked: false,
    });
    const rect = (id: string, color: string) => ({
      ...common(id),
      type: 'rect',
      fill: { type: 'solid', color },
      stroke: { paint: { type: 'none' }, width: 0 },
      cornerRadius: 0,
    });
    editor.apply('history.add', (d: any) => {
      d.artboards[0].children.push({
        ...common('pf'),
        type: 'group',
        clip: true,
        picture: { fit: 'fill' },
        children: [rect('pf_frame', '#eeeeee'), rect('pf_img', '#3366ff')],
      });
      return ['pf_img'];
    });
  });
  await setTool(page, 'vectorCrop');
  await drag(page, [400, 700], [350, 700]);
  const crop = (await kids(page)).at(-1)!;
  expect(crop.vectorCrop).toBe(true);
  expect(crop.children[0].width).toBeCloseTo(250, 0);
  expect(crop.children[1]).toMatchObject({ id: 'pf', picture: { fit: 'fill' } });
  expect(crop.children[1].children.map((n: AnyNode) => n.id)).toEqual(['pf_frame', 'pf_img']);
});
