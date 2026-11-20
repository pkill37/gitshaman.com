import { test, expect } from '@playwright/test';
import { routeCorpusRepository } from './helpers/corpus-routing';

function samplePdf(): Buffer {
  const stream = 'BT /F1 24 Tf 40 100 Td (PDF preview works) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 6\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

test('opens PDFs in the editor pane, preserves bytes, and releases previews on navigation', async ({
  page,
}) => {
  await routeCorpusRepository({
    page,
    owner: 'littlekernel',
    repo: 'lk',
    manifest: {
      tree: ['manual.PDF', 'broken.pdf', 'main.tcl'].map((name) => ({ name, type: 'f' })),
    },
    files: { 'broken.pdf': 'not a PDF', 'main.tcl': 'puts "hello"' },
  });
  const pdf = samplePdf();
  await page.route('**/repos/littlekernel/lk/**/manual.PDF', (route) =>
    route.fulfill({
      body: pdf,
      contentType: 'application/pdf',
      headers: { 'access-control-allow-origin': '*' },
    })
  );
  await page.goto('/littlekernel/lk');
  await page.locator('[data-file-path="manual.PDF"]').click();
  const preview = page.getByTitle('PDF preview: manual.PDF');
  await expect(preview).toBeVisible();
  const url = (await preview.getAttribute('src'))!;
  expect(url).toMatch(/^blob:/);
  expect(
    await page.evaluate(async (url) => {
      const response = await fetch(url);
      return Array.from(new Uint8Array(await response.arrayBuffer()));
    }, url)
  ).toEqual(Array.from(pdf));
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute(
    'download',
    'manual.PDF'
  );
  await expect(page.locator('.monaco-editor')).toHaveCount(0);

  await page.locator('[data-file-path="main.tcl"]').click();
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('puts');
  expect(
    await page.evaluate(
      (url) =>
        fetch(url).then(
          () => false,
          () => true
        ),
      url
    )
  ).toBe(true);

  await page.locator('[data-file-path="broken.pdf"]').click();
  await expect(page.locator('.vscode-pdf-preview').getByRole('alert')).toContainText(
    'This file is not a valid PDF.'
  );
  await expect(page.locator('iframe[title^="PDF preview:"]')).toHaveCount(0);

  await page.locator('[data-file-path="manual.PDF"]').click();
  await expect(preview).toBeVisible();
});
