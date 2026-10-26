import { expect, test } from '@playwright/test';

/* Ouverture d'un PDF : ses textes deviennent des textes modifiables, à leur place. */

const PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Contents 4 0 R
  /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << >> stream
BT /F1 24 Tf 1 0 0 1 50 200 Tm (Bonjour PDF) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj
trailer << /Root 1 0 R >>
%%EOF`;

test("les textes d'un PDF ouvert sont importés", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: true })),
  );
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'lettre.pdf'));
    const el = document.querySelector('[role="dialog"]')!;
    for (const type of ['dragover', 'drop'])
      el.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 400,
          dataTransfer: dt,
        }),
      );
  }, PDF);
  const texts = () =>
    page.evaluate(() =>
      (window as any).poulpe.editor.doc.artboards[0].children
        .filter((n: any) => n.type === 'text')
        .map((n: any) => ({ text: n.text, x: Math.round(n.x), bold: n.style.fontWeight })),
    );
  await expect.poll(texts).toEqual([{ text: 'Bonjour PDF', x: 50, bold: 700 }]);
});
