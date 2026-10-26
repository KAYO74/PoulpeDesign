import { expect, test } from '@playwright/test';
import { choose } from './choose';

/*
 * IA connectées : un modèle local (Ollama, simulé ici) ajouté dans Préférences › IA répond dans
 * l'assistant, sa réponse se place en texte, et une image générée s'ajoute au document.
 */

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('une IA locale se connecte, répond et génère une image', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  const asked: unknown[] = [];
  await page.route('http://localhost:11434/v1/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    if (url.endsWith('/models')) return json({ data: [{ id: 'llama3.2' }, { id: 'flux' }] });
    if (url.endsWith('/chat/completions')) {
      asked.push(route.request().postDataJSON());
      return json({ choices: [{ message: { content: 'Bonjour Poulpe !' } }] });
    }
    if (url.endsWith('/images/generations')) return json({ data: [{ b64_json: PNG }] });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');

  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'preferences', prefsTab: 'ai' }));
  await choose(page.getByTestId('ai-preset'), 'ollama');
  await page.getByTestId('ai-add').click();
  await page.getByTestId('ai-test').click();
  await expect(page.getByText('Connexion réussie : 2 modèles')).toBeVisible();
  await expect(page.getByTestId('ai-model')).toHaveValue('flux');
  await page.getByTestId('ai-model').fill('llama3.2');
  await page.getByLabel('Modèle d’images').fill('flux');
  await page.keyboard.press('Escape');

  // La clé n'est jamais enregistrée avec la liste des IA.
  const saved = await page.evaluate(() => localStorage.getItem('poulpe.ai')!);
  expect(saved).toContain('localhost:11434');

  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'ai' }));
  await page.getByTestId('ai-input').fill('Salut');
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-log')).toContainText('Bonjour Poulpe !');
  expect((asked[0] as { model: string }).model).toBe('llama3.2');
  await page.getByTestId('ai-insert').click();
  const kinds = () =>
    page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children.map((n: any) => n.type));
  await expect.poll(kinds).toEqual(['text']);

  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'aiImage' }));
  await page.getByTestId('ai-prompt').fill('un poulpe rose');
  await page.getByTestId('ai-generate').click();
  await expect.poll(kinds).toEqual(['text', 'image']);
});
