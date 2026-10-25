import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { routeCorpusRepository } from './helpers/corpus-routing';

type DebugEntry = {
  label: string;
  payload?: Record<string, unknown>;
  timestamp: string;
};

const REPO_ROUTE_PATTERN = '**/repos/littlekernel/lk/**';
const GITHUB_CONTENTS_PATTERN = 'https://api.github.com/repos/littlekernel/lk/contents/**';

const XREF_MANIFEST = {
  tree: [
    {
      name: 'top',
      type: 'd',
      children: [
        { name: 'main.c', type: 'f' },
        { name: 'test.c', type: 'f' },
      ],
    },
    {
      name: 'lib',
      type: 'd',
      children: [
        { name: 'math.c', type: 'f' },
        { name: 'math.h', type: 'f' },
      ],
    },
  ],
};

const XREF_FILES: Record<string, string> = {
  'top/main.c': `#include "lib/math.h"

int main(void) {
  return add(1, 2);
}
`,
  'top/test.c': `#include "lib/math.h"

int test_value(void) {
  return add(2, 3);
}
`,
  'lib/math.h': `int add(int left, int right);
`,
  'lib/math.c': `#include "lib/math.h"

int add(int left, int right) {
  return left + right;
}
`,
};

async function resetDebugLogs(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__explorarDebugLogs = [];
  });
}

async function readDebugLogs(page: Page): Promise<DebugEntry[]> {
  return page.evaluate(
    () =>
      (window.__explorarDebugLogs ?? []) as Array<{
        label: string;
        payload?: Record<string, unknown>;
        timestamp: string;
      }>
  );
}

async function expectDebugLog(
  page: Page,
  predicate: (entry: DebugEntry) => boolean,
  message: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        const logs = await readDebugLogs(page);
        return logs.some(predicate);
      },
      { timeout: 15000, message }
    )
    .toBeTruthy();
}

async function openFileFromTree(page: Page, filePath: string): Promise<void> {
  const segments = filePath.split('/');
  for (let index = 0; index < segments.length - 1; index += 1) {
    const directoryPath = segments.slice(0, index + 1).join('/');
    const directoryItem = page.locator(`[data-file-path="${directoryPath}"]`);
    await expect(directoryItem).toBeVisible();
    await directoryItem.click();
  }

  const fileItem = page.locator(`[data-file-path="${filePath}"]`);
  await expect(fileItem).toBeVisible();
  await fileItem.click();
}

async function focusEditorSymbol(page: Page, symbol: string): Promise<void> {
  const editor = page.locator('.vscode-editor').first();
  await expect(editor).toBeVisible({ timeout: 30000 });

  const focused = await page.evaluate(async (targetSymbol) => {
    const targetWindow = window as Window & {
      __explorarTestApi?: {
        focusSymbol: (symbol: string) => Promise<boolean>;
      };
    };

    return (await targetWindow.__explorarTestApi?.focusSymbol(targetSymbol)) ?? false;
  }, symbol);

  expect(focused).toBeTruthy();
}

async function showReferencesAtCursor(page: Page): Promise<void> {
  const actionRan = await page.evaluate(async () => {
    const targetWindow = window as Window & {
      __explorarTestApi?: {
        showReferencesAtCursor: () => Promise<boolean>;
      };
    };

    return (await targetWindow.__explorarTestApi?.showReferencesAtCursor()) ?? false;
  });

  expect(actionRan).toBeTruthy();
}

async function goToDefinitionAtCursor(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const targetWindow = window as Window & {
            __explorarTestApi?: {
              goToDefinitionAtCursor: () => Promise<boolean>;
            };
          };

          return (await targetWindow.__explorarTestApi?.goToDefinitionAtCursor()) ?? false;
        }),
      { timeout: 15000 }
    )
    .toBeTruthy();
}

function attachBrowserFailureCollectors(page: Page): {
  consoleFailures: string[];
  pageFailures: string[];
} {
  const consoleFailures: string[] = [];
  const pageFailures: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    const text = message.text();
    if (
      text.includes('Canceled: Canceled') ||
      text.includes('Model not found') ||
      text.includes('unhandledRejection') ||
      text.includes('Unhandled Promise Rejection')
    ) {
      consoleFailures.push(`${message.type()}: ${text}`);
    }
  });

  page.on('pageerror', (error: Error) => {
    const text = error.message || String(error);
    if (
      text.includes('Canceled: Canceled') ||
      text.includes('Model not found') ||
      text.includes('unhandledRejection') ||
      text.includes('Unhandled Promise Rejection')
    ) {
      pageFailures.push(text);
    }
  });

  return { consoleFailures, pageFailures };
}

test.describe('References in file search and definition jumps', () => {
  test('uses file search for references and preserves cross-file definition jumps', async ({
    page,
  }) => {
    const failures = attachBrowserFailureCollectors(page);
    await routeCorpusRepository({
      page,
      owner: 'littlekernel',
      repo: 'lk',
      manifest: XREF_MANIFEST,
      files: XREF_FILES,
      routePattern: REPO_ROUTE_PATTERN,
      githubContentsPattern: GITHUB_CONTENTS_PATTERN,
    });

    const response = await page.goto('/littlekernel/lk', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    await resetDebugLogs(page);
    await openFileFromTree(page, 'top/main.c');

    await expectDebugLog(
      page,
      (entry) =>
        entry.label === '[explorar:file-load] success' && entry.payload?.filePath === 'top/main.c',
      'Expected main.c to load'
    );

    await expect(page.getByRole('code').getByText('return add(1, 2);')).toBeVisible({
      timeout: 30000,
    });

    await focusEditorSymbol(page, 'add');
    await showReferencesAtCursor(page);

    await expectDebugLog(
      page,
      (entry) =>
        entry.label === '[explorar:xref] search-opened' &&
        entry.payload?.currentFilePath === 'top/main.c' &&
        entry.payload?.symbolName === 'add',
      'Expected file search to show references for add()'
    );

    const results = page.getByRole('region', { name: 'Repository file search results' });
    await expect(page.getByRole('button', { name: 'File search', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByRole('searchbox', { name: 'Search all files' })).toHaveValue('add');
    await expect(page.getByRole('complementary', { name: 'Cross references' })).toHaveCount(0);
    await expect(results).toContainText('main.c');
    await expect(results).toContainText('test.c');

    const testReference = results
      .locator('.vscode-tree-search-row')
      .filter({ hasText: 'return add(2, 3);' });
    await expect(testReference).toBeVisible();
    await testReference.click();
    await expect(page.getByRole('code').getByText('return add(2, 3);')).toBeVisible({
      timeout: 30000,
    });
    await expect(results).toBeVisible();
    await expect(testReference).toHaveAttribute('aria-current', 'location');

    await page.getByRole('searchbox', { name: 'Search all files' }).fill('another query');
    await expect(page.locator('.vscode-reference-search-context')).toHaveCount(0);
    await focusEditorSymbol(page, 'add');
    await showReferencesAtCursor(page);
    await expect(results).toContainText('test.c');
    await page.getByRole('button', { name: 'Search files', exact: true }).click();
    await expect(page.locator('.vscode-reference-search-context')).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Search all files' })).toHaveValue('add');

    await expect(page.locator('.vscode-editor').first()).toBeVisible({ timeout: 30000 });
    await focusEditorSymbol(page, 'add');
    await goToDefinitionAtCursor(page);
    const headerDefinition = results
      .locator('.vscode-tree-search-group')
      .filter({ has: page.getByRole('button', { name: 'math.h lib', exact: true }) })
      .getByRole('button', {
        name: /function int add\(int left, int right\); · indexed · high/,
      });
    await expect(headerDefinition).toBeVisible({ timeout: 15000 });
    await headerDefinition.click();
    await expect(page.getByRole('code').getByText('int add(int left, int right);')).toBeVisible({
      timeout: 30000,
    });

    await expect.poll(() => failures.consoleFailures, { timeout: 5000 }).toEqual([]);
    await expect.poll(() => failures.pageFailures, { timeout: 5000 }).toEqual([]);
  });

  test('editing search ignores an unfinished reference lookup', async ({ page }) => {
    await routeCorpusRepository({
      page,
      owner: 'littlekernel',
      repo: 'lk',
      manifest: XREF_MANIFEST,
      files: XREF_FILES,
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/repos/littlekernel/lk/**/lib/math.c', async (route) => {
      await gate;
      await route.fallback();
    });
    try {
      await page.goto('/littlekernel/lk', { waitUntil: 'domcontentloaded' });
      await openFileFromTree(page, 'top/main.c');
      await expect(page.getByRole('code').getByText('return add(1, 2);')).toBeVisible({
        timeout: 30000,
      });
      await focusEditorSymbol(page, 'add');
      await page.evaluate(() => {
        const api = (
          window as Window & {
            __explorarTestApi?: { showReferencesAtCursor: () => Promise<boolean> };
          }
        ).__explorarTestApi;
        void api?.showReferencesAtCursor();
      });
      await expect(page.locator('.vscode-reference-search-context')).toBeVisible();
      const search = page.getByRole('searchbox', { name: 'Search all files' });
      await search.fill('main.c');
      release();
      await expectDebugLog(
        page,
        (entry) => entry.label === '[explorar:xref] search-opened',
        'Expected the delayed reference lookup to finish'
      );
      await expect(page.locator('.vscode-reference-search-context')).toHaveCount(0);
      await expect(search).toHaveValue('main.c');
    } finally {
      release();
    }
  });
});
