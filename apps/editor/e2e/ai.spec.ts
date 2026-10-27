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

test('la clé API est chiffrée dans le navigateur et reste utilisable', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  let sent = '';
  await page.route('http://localhost:11434/v1/**', async (route) => {
    sent = route.request().headers()['authorization'] ?? '';
    return route.fulfill({
      json: { data: [{ id: 'm1' }] },
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
    });
  });
  await page.goto('/');
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'preferences', prefsTab: 'ai' }));
  await choose(page.getByTestId('ai-preset'), 'ollama');
  await page.getByTestId('ai-add').click();
  await page.getByTestId('ai-key').fill('sk-secret-12345');
  await page.getByRole('button', { name: 'Enregistrer la clé' }).click();
  await expect(page.getByTestId('ai-key')).toHaveAttribute('placeholder', /enregistrée/i);

  const raw = await page.evaluate(() => localStorage.getItem('poulpe.ai.keys')!);
  expect(raw).not.toContain('sk-secret-12345');
  expect(raw).toContain('v1:');

  await page.getByTestId('ai-test').click();
  await expect(page.getByText('Connexion réussie : 1 modèle')).toBeVisible();
  expect(sent).toContain('sk-secret-12345');
});

test('une ancienne clé en clair est chiffrée au premier usage', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('poulpe.ai.keys')) return;
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
    localStorage.setItem('poulpe.ai.keys', JSON.stringify({ ollama: 'sk-old-plain' }));
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/ai/providers.ts';
    const { aiFetch } = await import(/* @vite-ignore */ path);
    await aiFetch({ url: 'http://localhost:1/x', key: { id: 'ollama', header: 'authorization' } }).catch(
      () => undefined,
    );
  });
  const raw = await page.evaluate(() => localStorage.getItem('poulpe.ai.keys')!);
  expect(raw).not.toContain('sk-old-plain');
  expect(raw).toContain('v1:');
});
