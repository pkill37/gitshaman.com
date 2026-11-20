import { test, expect } from '@playwright/test';
import { routeCorpusRepository } from './helpers/corpus-routing';

test('highlights nested Makefiles, NT makefil0 files, and .mk includes', async ({ page }) => {
  const source =
    '# build rules\nCC := cc\n.PHONY: all\nall: main.o\n\t$(CC) -o $@ $<\ninclude config.mk\n!IFDEF DEBUG\n!ENDIF\n';
  const names = ['Makefile', 'makefil0', 'rules.mk'];
  await routeCorpusRepository({
    page,
    owner: 'littlekernel',
    repo: 'lk',
    manifest: {
      tree: [{ name: 'build', type: 'd', children: names.map((name) => ({ name, type: 'f' })) }],
    },
    files: Object.fromEntries(names.map((name) => [`build/${name}`, source])),
  });
  await page.goto('/littlekernel/lk');
  await page.locator('[data-file-path="build"]').click();

  for (const name of names) {
    await page.locator(`[data-file-path="build/${name}"]`).click();
    const lines = page.locator('.monaco-editor .view-lines').first();
    await expect(lines).toContainText('include config.mk');
    // Verify real tokenizer output, including the return from a tabbed recipe
    // to a Make directive on the next line.
    const firstToken = (line: number) =>
      lines
        .locator('.view-line')
        .nth(line - 1)
        .locator('span[class^="mtk"]')
        .first();
    await expect
      .poll(async () => {
        const colors = await Promise.all(
          [1, 3, 6].map((line) =>
            firstToken(line).evaluate((element) => getComputedStyle(element).color)
          )
        );
        return new Set(colors).size;
      })
      .toBe(3);
    await expect(firstToken(7)).toHaveCSS(
      'color',
      await firstToken(6).evaluate((element) => getComputedStyle(element).color)
    );
    const recipe = lines.locator('.view-line').filter({ hasText: '$(CC)' });
    await expect.poll(() => recipe.locator('span[class^="mtk"]').count()).toBeGreaterThan(1);
  }
});
