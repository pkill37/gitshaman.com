import { expect, test, type Page } from '@playwright/test';
import {
  expectBothCorpusSourcesWereHit,
  routeCorpusRepository,
  type RoutedCorpusRequests,
} from './helpers/corpus-routing';
import { readDebugLogs, resetDebugLogs } from './helpers/debug-logs';
import { openGuideFile } from './helpers/page-actions';

const OWNER = 'littlekernel';
const REPO = 'lk';
const TEST_FILE_PATH = 'top/main.c';
const STORAGE_KEY = 'repository-workspace-explorer-corpus-source-mode';

const TEST_MANIFEST = {
  tree: [
    {
      name: 'top',
      type: 'd',
      children: [{ name: 'main.c', type: 'f' }],
    },
  ],
};

const LOCAL_FILE_CONTENT = `#include <lk/main.h>

void local_entity_marker(void) {
}
`;

const R2_FILE_CONTENT = `#include <lk/main.h>

void r2_entity_marker(void) {
}
`;

function storageSourceSelector(page: Page) {
  return page.getByRole('main').getByRole('combobox', { name: 'Storage source' });
}

function storageSourceStatus(page: Page, title: string) {
  return page.getByRole('main').locator(`.cursor-statusbar-item[title="${title}"]`);
}

async function expectFileFetchFromSource(
  page: Page,
  source: 'local-filesystem' | 'r2-bucket',
  urlPredicate: (url: string) => boolean
): Promise<void> {
  await expect
    .poll(
      async () => {
        const logs = await readDebugLogs(page);
        return logs.some((entry) => {
          const payload = entry.payload as Record<string, unknown> | undefined;
          return (
            entry.label === '[explorar:file-fetch]' &&
            payload?.source === source &&
            typeof payload.requestUrl === 'string' &&
            urlPredicate(payload.requestUrl)
          );
        });
      },
      { timeout: 30000, message: `Expected ${source} file fetch` }
    )
    .toBeTruthy();
}

async function expectFileLoadPreview(page: Page, previewText: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const logs = await readDebugLogs(page);
        return logs.some((entry) => {
          const payload = entry.payload as Record<string, unknown> | undefined;
          return (
            entry.label === '[explorar:file-load] success' &&
            typeof payload?.preview === 'string' &&
            payload.preview.includes(previewText)
          );
        });
      },
      { timeout: 30000, message: `Expected loaded file preview to include ${previewText}` }
    )
    .toBeTruthy();
}

async function setupRepositoryRoutes(page: Page): Promise<RoutedCorpusRequests> {
  return routeCorpusRepository({
    page,
    owner: OWNER,
    repo: REPO,
    localManifest: TEST_MANIFEST,
    r2Manifest: TEST_MANIFEST,
    localFiles: {
      [TEST_FILE_PATH]: LOCAL_FILE_CONTENT,
    },
    r2Files: {
      [TEST_FILE_PATH]: R2_FILE_CONTENT,
    },
  });
}

test.describe('repository source mode browser behavior', () => {
  test('defaults to local staged corpus in dev and uses local URLs', async ({ page }) => {
    const requests = await setupRepositoryRoutes(page);

    const response = await page.goto('/littlekernel/lk', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    await expect(storageSourceSelector(page)).toHaveValue('local-filesystem');
    await expect(storageSourceStatus(page, 'Storage source: Local staged corpus')).toBeVisible();

    requests.local = [];
    requests.r2 = [];
    requests.all = [];
    await resetDebugLogs(page);
    await openGuideFile(page, TEST_FILE_PATH);

    await expectFileFetchFromSource(
      page,
      'local-filesystem',
      (url) => url.includes(`/repos/${OWNER}/${REPO}/`) && url.endsWith(`/${TEST_FILE_PATH}`)
    );
    await expect(page.getByRole('code').getByText('local_entity_marker')).toBeVisible({
      timeout: 30000,
    });
    expect(requests.local.some((url) => url.endsWith(`/${TEST_FILE_PATH}`))).toBeTruthy();
    expect(requests.r2.some((url) => url.endsWith(`/${TEST_FILE_PATH}`))).toBeFalsy();
  });

  test('switches file tree, editor, status bar, and persistence between local and R2', async ({
    page,
  }) => {
    const requests = await setupRepositoryRoutes(page);

    const response = await page.goto('/littlekernel/lk', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    await expect(storageSourceSelector(page)).toHaveValue('local-filesystem');

    await storageSourceSelector(page).selectOption('r2-bucket');
    await expect(storageSourceSelector(page)).toHaveValue('r2-bucket');
    await expect(storageSourceStatus(page, 'Storage source: R2')).toBeVisible();
    await resetDebugLogs(page);
    await openGuideFile(page, TEST_FILE_PATH);

    await expectFileFetchFromSource(
      page,
      'r2-bucket',
      (url) =>
        url.includes(`pub-fed8a8778c5340c9a70aec8e22b8296d.r2.dev/repos/${OWNER}/${REPO}/`) &&
        url.endsWith(`/${TEST_FILE_PATH}`)
    );
    await expectFileLoadPreview(page, 'r2_entity_marker');
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
      .toBe('r2-bucket');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(storageSourceSelector(page)).toHaveValue('r2-bucket');

    await storageSourceSelector(page).selectOption('local-filesystem');
    await expect(storageSourceSelector(page)).toHaveValue('local-filesystem');
    await page.getByRole('button', { name: 'Close all files' }).click();
    await resetDebugLogs(page);
    await openGuideFile(page, TEST_FILE_PATH);
    await expectFileFetchFromSource(
      page,
      'local-filesystem',
      (url) => url.includes(`/repos/${OWNER}/${REPO}/`) && url.endsWith(`/${TEST_FILE_PATH}`)
    );
    await expectFileLoadPreview(page, 'local_entity_marker');

    expectBothCorpusSourcesWereHit(requests);
  });

  test('extracts entities from the active source mode without reusing another source cache', async ({
    page,
  }) => {
    await setupRepositoryRoutes(page);

    const response = await page.goto('/littlekernel/lk', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    await expect(storageSourceSelector(page)).toHaveValue('local-filesystem');

    await page.getByRole('button', { name: 'Entities' }).click();
    await expect(page.getByText('local_entity_marker')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('r2_entity_marker')).not.toBeVisible();

    await page.getByRole('button', { name: 'File editor' }).click();
    await storageSourceSelector(page).selectOption('r2-bucket');
    await expect(storageSourceStatus(page, 'Storage source: R2')).toBeVisible();
    await page.getByRole('button', { name: 'Entities' }).click();

    await expect(page.getByText('r2_entity_marker')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('local_entity_marker')).not.toBeVisible();
  });
});
