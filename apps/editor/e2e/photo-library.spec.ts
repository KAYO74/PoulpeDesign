import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { choose } from './choose';

/* Bibliothèque photo : import, note, drapeau, couleur, mots-clés, filtres, infos EXIF, ouverture. */

const DNG = readFileSync(new URL('./fixtures/test.dng', import.meta.url));
// Image PNG de 1 × 1 pixel rouge.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
});

test('importe, classe, filtre et retrouve les photos', async ({ page }) => {
  await page.getByTestId('persona-library').click();
  const lib = page.getByTestId('photo-library');
  await expect(lib).toBeVisible();
  await expect(lib.getByText('Aucune photo pour l’instant.')).toBeVisible();

  await page.getByTestId('plib-files').setInputFiles([
    { name: 'plage.png', mimeType: 'image/png', buffer: PNG },
    { name: 'photo.dng', mimeType: 'image/x-adobe-dng', buffer: DNG },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
  ]);
  const cards = lib.getByRole('option');
  await expect(cards).toHaveCount(2);
  await expect(page.getByText('1 fichier(s) ignoré(s)', { exact: false })).toBeVisible();

  // Infos de prise de vue lues dans le RAW.
  await lib.getByRole('option', { name: 'photo.dng' }).click();
  const info = page.getByTestId('plib-info');
  await expect(info).toContainText('Poulpe Test RAW');
  await expect(info.getByTestId('plib-open')).toHaveText('Développer le RAW');

  // Raccourcis de Lightroom sur la photo choisie.
  await lib.getByRole('option', { name: 'plage.png' }).click();
  await page.keyboard.press('3');
  await page.keyboard.press('p');
  await page.keyboard.press('6');
  await expect(info.getByRole('button', { name: '3 étoile(s)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(info.getByRole('button', { name: '4 étoile(s)' })).toHaveAttribute('aria-pressed', 'false');
  await expect(info.getByRole('button', { name: 'Retenir (P)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(info.getByRole('button', { name: 'Rouge (6)' })).toHaveAttribute('aria-pressed', 'true');
  const kw = info.getByRole('textbox', { name: 'Ajouter un mot-clé' });
  await kw.fill('vacances');
  await kw.press('Enter');
  await expect(info.getByRole('button', { name: 'Retirer « vacances »' })).toBeVisible();

  // Filtres.
  await choose(page.getByTestId('plib-min-rating'), '3');
  await expect(cards).toHaveCount(1);
  await choose(page.getByTestId('plib-min-rating'), '0');
  await choose(page.getByTestId('plib-flag'), 'none');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAccessibleName('photo.dng');
  await choose(page.getByTestId('plib-flag'), 'all');
  await lib
    .getByRole('button', { name: /vacances/ })
    .first()
    .click();
  await expect(cards).toHaveCount(1);
  await lib.getByRole('button', { name: /Toutes les photos/ }).click();
  await lib.getByRole('searchbox').fill('poulpe test');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAccessibleName('photo.dng');
  await lib.getByRole('searchbox').fill('');

  // La bibliothèque est retrouvée après un nouveau lancement.
  await page.reload();
  await page.getByTestId('persona-library').click();
  await expect(cards).toHaveCount(2);
  await lib.getByRole('option', { name: 'plage.png' }).click();
  await expect(info.getByRole('button', { name: '3 étoile(s)' })).toHaveAttribute('aria-pressed', 'true');

  // Double-clic : la photo s'ouvre en Persona Photo.
  await lib.getByRole('option', { name: 'plage.png' }).dblclick();
  await expect(lib).toBeHidden();
  await expect(page.getByTestId('persona-photo')).toHaveAttribute('aria-pressed', 'true');
  const size = await page.evaluate(() => {
    const d = (window as any).poulpe.editor.doc;
    return [d.artboards[0].width, d.artboards[0].height];
  });
  expect(size).toEqual([1, 1]);
});

test('retire une photo et ferme la bibliothèque avec Échap', async ({ page }) => {
  await page.keyboard.press('Control+Alt+B');
  const lib = page.getByTestId('photo-library');
  await expect(lib).toBeVisible();
  await page.getByTestId('plib-files').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(lib.getByRole('option')).toHaveCount(1);
  page.once('dialog', (d) => void d.accept());
  await lib.getByRole('option').click();
  await page.keyboard.press('Delete');
  await expect(lib.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(lib).toBeHidden();
});

test('ouvre un dossier du disque sans copier les photos', async ({ page }) => {
  // Faux sélecteur de dossier : un dossier « voyage » avec une photo et un sous-dossier.
  await page.addInitScript((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = (name: string) => ({
      kind: 'file',
      name,
      getFile: async () => new File([bytes], name, { type: 'image/png', lastModified: 1_700_000_000_000 }),
    });
    const dir = (name: string, entries: unknown[]): unknown => ({
      kind: 'directory',
      name,
      values: async function* () {
        yield* entries as never[];
      },
    });
    (window as any).showDirectoryPicker = async () =>
      dir('voyage', [file('a.png'), file('notes.txt'), dir('jour2', [file('b.png')])]);
  }, PNG.toString('base64'));
  await page.reload();
  await page.getByTestId('persona-library').click();
  const lib = page.getByTestId('photo-library');
  await page.getByTestId('plib-open-folder').click();
  await expect(lib.getByRole('option')).toHaveCount(2);
  await expect(lib.getByRole('button', { name: /^jour2/ })).toBeVisible();
  // La photo est relue dans son dossier à l'ouverture.
  await lib.getByRole('option', { name: 'b.png' }).dblclick();
  await expect(lib).toBeHidden();
  await expect(page.getByTestId('persona-photo')).toHaveAttribute('aria-pressed', 'true');
});
