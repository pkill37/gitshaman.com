import { test, expect } from '@playwright/test';
import { routeCorpusRepository } from './helpers/corpus-routing';

test('highlights Tcl files with lowercase and uppercase extensions', async ({ page }) => {
  const names = ['build.tcl', 'setup.TCL'];
  const source = '# Tcl script\nif {$enabled} {\nputs "building"\nset count 42\n}\n';
  await routeCorpusRepository({
    page,
    owner: 'littlekernel',
    repo: 'lk',
    manifest: {
      tree: [{ name: 'scripts', type: 'd', children: names.map((name) => ({ name, type: 'f' })) }],
    },
    files: Object.fromEntries(names.map((name) => [`scripts/${name}`, source])),
  });
  await page.goto('/littlekernel/lk');
  await page.locator('[data-file-path="scripts"]').click();

  for (const name of names) {
    await page.locator(`[data-file-path="scripts/${name}"]`).click();
    const lines = page.locator('.monaco-editor .view-lines').first();
    await expect(lines).toContainText('set count 42');
    const colorOf = async (line: number, text: string) =>
      lines
        .locator('.view-line')
        .nth(line - 1)
        .locator('span[class^="mtk"]')
        .filter({ hasText: text })
        .first()
        .evaluate((element) => getComputedStyle(element).color);

    // Verify actual rendered tokens instead of only checking the language mapping.
    await expect
      .poll(async () => {
        const colors = await Promise.all([
          colorOf(1, '# Tcl script'),
          colorOf(2, 'if'),
          colorOf(3, 'building'),
          colorOf(4, '42'),
        ]);
        return new Set(colors).size;
      })
      .toBe(4);
  }
});
