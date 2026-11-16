import { expect, test } from '@playwright/test';
import { routeCorpusRepository } from './helpers/corpus-routing';

test('mobile exploration uses bottom history and top workspace controls @mobile', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    });
  });
  await routeCorpusRepository({
    page,
    owner: 'python',
    repo: 'cpython',
    manifest: { tree: [{ name: 'main.c', type: 'f' }] },
    files: { 'main.c': 'int mobile_exploration = 1;\n' },
  });
  await routeCorpusRepository({
    page,
    owner: 'bminor',
    repo: 'glibc',
    manifest: {
      tree: [{ name: 'nptl', type: 'd', children: [{ name: 'pthread_create.c', type: 'f' }] }],
    },
    files: { 'nptl/pthread_create.c': 'int pthread_create(void) { return 0; }\n' },
  });
  await page.goto('/cpython/');
  const history = page.getByRole('navigation', { name: 'Repository history' });
  await expect(history).toBeVisible();
  await expect(history.locator('a')).toHaveCount(1);
  await expect(page.locator('.mobile-nav-bar')).toHaveCount(0);
  const statusBar = page.getByRole('region', { name: 'Workspace status bar' });
  await expect(statusBar).toBeVisible();
  await expect(statusBar.getByRole('button', { name: 'History 1', exact: true })).toBeVisible();
  const guide = page.locator('.repository-guide-sidebar');
  await expect(guide).toBeVisible();
  await expect
    .poll(async () => Math.round((await guide.boundingBox())!.width))
    .toBe(page.viewportSize()!.width);

  await page.getByRole('button', { name: 'File editor', exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(page.getByRole('region', { name: 'Repository file tree' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle guide' }).click();
  await expect(guide).toBeVisible();
  await page
    .locator(
      '[data-guide-markdown]:visible a[data-repo-owner][data-search-pattern="pthread_create"]'
    )
    .first()
    .click();
  await expect(page).toHaveURL(/\/gnu-c-library\/\?/);
  await expect(history.locator('a')).toHaveCount(2);
  const historyBox = (await history.boundingBox())!;
  const statusBox = (await statusBar.boundingBox())!;
  expect(Math.round(historyBox.y + historyBox.height)).toBe(Math.round(statusBox.y));
  await history.locator('a').first().click();
  await expect(page).toHaveURL(/\/cpython\//);
  await expect(history.locator('a')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeVisible();
  await statusBar.getByRole('button', { name: 'History 3', exact: true }).click();
  await expect(history).toBeHidden();
  await page.reload();
  await expect(statusBar.getByRole('button', { name: 'History 3', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(history).toBeHidden();
  await statusBar.getByRole('button', { name: 'History 3', exact: true }).click();
  await expect(history.locator('#repository-history-previews')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: '/tmp/gitshaman-mobile-exploration.png' });
});
