import { test, expect, type Locator } from '@playwright/test';
import { routeCorpusRepository } from './helpers/corpus-routing';

async function tokenColor(lines: Locator, line: number): Promise<string> {
  return lines
    .locator('.view-line')
    .nth(line - 1)
    .locator('span[class^="mtk"]')
    .first()
    .evaluate((element) => getComputedStyle(element).color);
}

const examples = [
  {
    language: 'VHDL',
    names: ['gate.vhd', 'gate.vhdl', 'gate.vho', 'gate.VHD'],
    source: (name: string) => `-- ${name}
ENTITY gate IS
std_logic
16#FF#
"end -- text"
/* block comment
entity hidden
*/
END architecture;
clk'event
`,
  },
  {
    language: 'Verilog and SystemVerilog',
    names: ['gate.v', 'gate.vh', 'gate.sv', 'gate.svh', 'gate.V'],
    source: (name: string) => `// ${name}
module gate;
wire clk;
8'hA5;
"endmodule // text"
/* block comment
module hidden;
*/
endmodule
`,
  },
];

for (const { language, names, source } of examples) {
  test(`highlights ${language} files and headers`, async ({ page }) => {
    await routeCorpusRepository({
      page,
      owner: 'littlekernel',
      repo: 'lk',
      manifest: {
        tree: [{ name: 'rtl', type: 'd', children: names.map((name) => ({ name, type: 'f' })) }],
      },
      files: Object.fromEntries(names.map((name) => [`rtl/${name}`, source(name)])),
    });
    await page.goto('/littlekernel/lk');
    await page.locator('[data-file-path="rtl"]').click();

    for (const name of names) {
      await page.locator(`[data-file-path="rtl/${name}"]`).click();
      const lines = page.locator('.monaco-editor .view-lines').first();
      await expect(lines).toContainText(name);
      // Comments, keywords, numbers, and strings must receive distinct colors.
      await expect
        .poll(
          async () =>
            new Set(await Promise.all([1, 2, 4, 5].map((line) => tokenColor(lines, line)))).size
        )
        .toBe(4);
      // Block comments retain their color across lines and end correctly.
      expect(await tokenColor(lines, 7)).toBe(await tokenColor(lines, 1));
      expect(await tokenColor(lines, 9)).toBe(await tokenColor(lines, 2));
      if (language === 'VHDL') {
        const typeColor = await tokenColor(lines, 3);
        expect(typeColor).not.toBe(await tokenColor(lines, 2));
        const attribute = lines.locator('.view-line').nth(9).locator('span[class^="mtk"]').last();
        await expect(attribute).toHaveCSS('color', typeColor);
      }
    }
  });
}
