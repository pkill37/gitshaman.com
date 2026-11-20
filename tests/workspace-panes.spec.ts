import { expect, test } from '@playwright/test';
import { routeCorpusRepository } from './helpers/corpus-routing';

test('right panel rail stays available while Guide opens and closes', async ({ page }) => {
  await routeCorpusRepository({
    page,
    owner: 'python',
    repo: 'cpython',
    manifest: { tree: [{ name: 'main.c', type: 'f' }] },
    files: { 'main.c': 'int main(void) { return 0; }\n' },
  });
  await page.goto('/cpython');
  const rail = page.getByRole('navigation', { name: 'Right sidebar panels' });
  const guideButton = rail.getByRole('button', { name: 'Guide', exact: true });
  const guide = page.locator('#repository-guide-panel');
  const content = page.locator('.repository-workspace-content');
  await expect(rail).toBeVisible();
  await expect(guideButton).toHaveAttribute('aria-controls', 'repository-guide-panel');
  await expect(guideButton).toHaveAttribute('aria-pressed', 'true');
  await expect(guide).toBeVisible();
  const railBox = (await rail.boundingBox())!;
  const guideBox = (await guide.boundingBox())!;
  expect(Math.round(railBox.x)).toBe(Math.round(guideBox.x + guideBox.width));
  const contentWidth = (await content.boundingBox())!.width;

  await guideButton.click();
  await expect(guide).toBeHidden();
  await expect(guideButton).toHaveAttribute('aria-pressed', 'false');
  await expect(rail).toBeVisible();
  expect((await content.boundingBox())!.width).toBeGreaterThan(contentWidth);
  await page.reload();
  await expect(guide).toBeHidden();
  await expect(rail).toBeVisible();

  await guideButton.focus();
  await guideButton.press('Enter');
  await expect(guide).toBeVisible();
  await expect(guideButton).toHaveAttribute('aria-expanded', 'true');
  const resizer = page.getByRole('separator', { name: 'Resize guide sidebar' });
  await resizer.focus();
  await resizer.press('ArrowLeft');
  const width = await resizer.getAttribute('aria-valuenow');
  await expect(guide).toHaveCSS('width', `${width}px`);
  await page.getByRole('button', { name: 'Hide guide sidebar', exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(guideButton).toHaveAttribute('aria-pressed', 'false');
  await guideButton.click();
  await expect(guide).toHaveCSS('width', `${width}px`);
  await page.screenshot({ path: '/tmp/gitshaman-right-panel-rail.png' });
});

test('activity buttons toggle a single pane beside the editor', async ({ page }) => {
  await page.goto('/cpython', { waitUntil: 'domcontentloaded' });
  const explorer = page.getByRole('button', { name: 'File editor', exact: true });
  const search = page.getByRole('button', { name: 'File search', exact: true });
  const sidebar = page.getByRole('main').locator('.vscode-sidebar');

  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toHaveCount(0);
  await expect(sidebar).toBeVisible();
  const resizer = page.getByRole('separator', { name: 'Resize left pane' });
  await resizer.focus();
  await resizer.press('ArrowRight');
  const sharedWidth = await resizer.getAttribute('aria-valuenow');
  await expect(sidebar).toHaveCSS('width', `${sharedWidth}px`);
  await explorer.click();
  await expect(explorer).toHaveAttribute('aria-pressed', 'false');
  await expect(sidebar).toHaveCount(0);
  await explorer.click();
  await expect(sidebar).toBeVisible();
  await search.click();
  await expect(explorer).toHaveAttribute('aria-pressed', 'false');
  await expect(search).toHaveAttribute('aria-pressed', 'true');
  await expect(sidebar).toHaveCSS('width', `${sharedWidth}px`);
  await search.click();
  await expect(search).toHaveAttribute('aria-pressed', 'false');
  await expect(sidebar).toHaveCount(0);
  await expect(page.locator('.vscode-editor-container')).toBeVisible();
});
