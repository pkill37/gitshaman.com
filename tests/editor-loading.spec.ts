import { test, expect } from '@playwright/test';
import { routeCorpusRepository } from './helpers/corpus-routing';
import { expectDebugLog, resetDebugLogs } from './helpers/debug-logs';
import { openGuideFile } from './helpers/page-actions';

const TEST_FILE_PATH = 'top/main.c';
const TEST_FILE_CONTENT = `#include <lk/main.h>

int main(void) {
  return 0;
}
`;
const TEST_MANIFEST = {
  tree: [
    {
      name: 'top',
      type: 'd',
      children: [{ name: 'main.c', type: 'f' }],
    },
  ],
};

test.describe('Editor Loading', () => {
  test('opens root and nested files from a lazily loaded repository sidebar', async ({ page }) => {
    const owner = 'sidebar-test';
    const repo = 'runtime-repo';
    const files = {
      'main.c': 'int root_file = 42;\n',
      'src/main.c': 'int nested_file = 24;\n',
    };
    await page.route(`**/repos/${owner}/${repo}/**`, (route) =>
      route.fulfill({ status: 404, body: 'No staged corpus' })
    );
    await page.route(`https://api.github.com/repos/${owner}/${repo}/contents**`, (route) => {
      const nested = new URL(route.request().url()).pathname.endsWith('/contents/src');
      return route.fulfill({
        json: nested
          ? [{ name: 'main.c', path: 'src/main.c', type: 'file', size: 24 }]
          : [
              { name: 'main.c', path: 'main.c', type: 'file', size: 22 },
              { name: 'src', path: 'src', type: 'dir' },
            ],
      });
    });
    await page.route(`https://raw.githubusercontent.com/${owner}/${repo}/main/**`, (route) => {
      const path = new URL(route.request().url()).pathname.split('/').slice(4).join('/');
      return route.fulfill({
        contentType: 'text/plain',
        body: files[path as keyof typeof files],
      });
    });

    await page.goto(`/${owner}/${repo}/?ref=main`);
    await openGuideFile(page, 'main.c');
    await expect(page.getByRole('code').getByText('int root_file = 42;')).toBeVisible();
    await openGuideFile(page, 'src/main.c');
    await expect(page.getByRole('code').getByText('int nested_file = 24;')).toBeVisible();
    await page.locator('[data-file-path="main.c"]').click();
    await expect(page.getByRole('code').getByText('int root_file = 42;')).toBeVisible();
  });

  for (const target of ['blob/main/main.c', '?ref=main&file=main.c', 'blob/main/src/main.c']) {
    test(`opens runtime URL target ${target} and follows homepage navigation`, async ({ page }) => {
      const owner = 'navigation-test';
      const repo = 'runtime-repo';
      await page.route(`**/repos/${owner}/${repo}/**`, (route) =>
        route.fulfill({ status: 404, body: 'No staged corpus' })
      );
      await page.route(`https://api.github.com/repos/${owner}/${repo}/contents**`, (route) =>
        route.fulfill({ json: [{ name: 'main.c', path: 'main.c', type: 'file', size: 22 }] })
      );
      await page.route(`https://raw.githubusercontent.com/${owner}/${repo}/main/**`, (route) =>
        route.fulfill({ contentType: 'text/plain', body: 'int url_target = 42;\n' })
      );

      const path = `/${owner}/${repo}/${target}`;
      await page.goto(`/?github_path=${encodeURIComponent(path)}`);
      await expect(page.getByRole('code').getByText('int url_target = 42;')).toBeVisible();

      // Next observes native history changes as same-page client navigation.
      await page.evaluate(() => window.history.pushState(null, '', '/'));
      await expect(
        page.getByRole('heading', { name: /Meet git.*Understand code faster/i })
      ).toBeVisible();
      await expect(page.getByRole('code').getByText('int url_target = 42;')).toHaveCount(0);
      await page.goBack();
      await expect(page.getByRole('code').getByText('int url_target = 42;')).toBeVisible();
      await page.goForward();
      await expect(
        page.getByRole('heading', { name: /Meet git.*Understand code faster/i })
      ).toBeVisible();
    });
  }

  test('renders Monaco after a successful cross-origin static file fetch', async ({ page }) => {
    await routeCorpusRepository({
      page,
      owner: 'littlekernel',
      repo: 'lk',
      manifest: TEST_MANIFEST,
      files: {
        [TEST_FILE_PATH]: TEST_FILE_CONTENT,
      },
    });

    const response = await page.goto('/littlekernel/lk', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    await resetDebugLogs(page);
    await openGuideFile(page, TEST_FILE_PATH);

    await expectDebugLog(
      page,
      (entry) =>
        entry.label === '[explorar:file-load] success' &&
        entry.payload?.filePath === TEST_FILE_PATH,
      `Expected successful file load for ${TEST_FILE_PATH}`
    );
    await expectDebugLog(
      page,
      (entry) =>
        entry.label === '[explorar:file-fetch]' &&
        entry.payload?.source === 'local-filesystem' &&
        typeof entry.payload?.requestUrl === 'string' &&
        entry.payload.requestUrl.includes('/repos/littlekernel/lk/') &&
        entry.payload.requestUrl.endsWith(`/${TEST_FILE_PATH}`),
      `Expected local staged corpus fetch for ${TEST_FILE_PATH}`
    );

    await expect(page.getByRole('code').getByText('#include <lk/main.h>')).toBeVisible({
      timeout: 30000,
    });
  });

  test('can switch dev corpus fetches to the configured R2 bucket source', async ({ page }) => {
    await routeCorpusRepository({
      page,
      owner: 'littlekernel',
      repo: 'lk',
      manifest: TEST_MANIFEST,
      files: {
        [TEST_FILE_PATH]: TEST_FILE_CONTENT,
      },
    });

    const response = await page.goto('/littlekernel/lk', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    await page.getByLabel('Storage source').selectOption('r2-bucket');
    await resetDebugLogs(page);
    await openGuideFile(page, TEST_FILE_PATH);

    await expectDebugLog(
      page,
      (entry) =>
        entry.label === '[explorar:file-fetch]' &&
        entry.payload?.source === 'r2-bucket' &&
        typeof entry.payload?.requestUrl === 'string' &&
        entry.payload.requestUrl.includes(
          'pub-fed8a8778c5340c9a70aec8e22b8296d.r2.dev/repos/littlekernel/lk/'
        ),
      `Expected R2 bucket fetch for ${TEST_FILE_PATH}`
    );
  });

  test('failed loads surface an error instead of leaving the editor stuck on loading', async ({
    page,
  }) => {
    await routeCorpusRepository({
      page,
      owner: 'littlekernel',
      repo: 'lk',
      manifest: TEST_MANIFEST,
      files: {},
    });

    const response = await page.goto('/littlekernel/lk', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    await resetDebugLogs(page);
    await openGuideFile(page, TEST_FILE_PATH);

    await expectDebugLog(
      page,
      (entry) =>
        entry.label === '[explorar:file-load] error' && entry.payload?.filePath === TEST_FILE_PATH,
      `Expected failed file load log for ${TEST_FILE_PATH}`
    );

    await expect(page.getByText('Loading top/main.c...')).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Failed to load file')).toBeVisible({ timeout: 30000 });
  });
});
