import type { Locator } from '@playwright/test';

/** Choisit une valeur (ou un libellé) dans une liste déroulante de l'app (fields.tsx › Select). */
export async function choose(select: Locator, value: string | { label: string }): Promise<void> {
  await select.click();
  const menu = select.page().getByRole('menu');
  const item =
    typeof value === 'string'
      ? menu.locator(`[role="menuitemradio"][data-value="${value}"]`)
      : menu.getByRole('menuitemradio', { name: value.label, exact: true });
  await item.click();
}
