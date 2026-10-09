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

test.describe('Monaco xref and jumps', () => {
  test('supports xref navigation and cross-file definition jumps without runtime cancellations', async ({
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
        entry.label === '[explorar:xref] panel-opened' &&
        entry.payload?.currentFilePath === 'top/main.c' &&
        entry.payload?.symbolName === 'add',
      'Expected xref panel to open for add()'
    );

    await expect(page.locator('.explorar-xref-panel')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.explorar-xref-panel')).toContainText('main.c');
    await expect(page.locator('.explorar-xref-panel')).toContainText('test.c');

    const testReference = page.locator('.explorar-xref-row:has-text("return add(2, 3);")');
    await expect(testReference).toBeVisible();
    await testReference.click();

    await expect(page.getByRole('code').getByText('return add(2, 3);')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('.explorar-xref-panel')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.explorar-xref-panel-subtitle')).toContainText('test.c:4');

    await page.getByRole('button', { name: 'Close cross references' }).click();
    await expect(page.locator('.explorar-xref-panel')).toBeHidden({ timeout: 15000 });

    await expect(page.locator('.vscode-editor').first()).toBeVisible({ timeout: 30000 });
    await focusEditorSymbol(page, 'add');
    await goToDefinitionAtCursor(page);
    const headerDefinition = page.getByRole('button', {
      name: /L1 function int add\(int left, int right\); lib\/math\.h · indexed · high/,
    });
    await expect(headerDefinition).toBeVisible({ timeout: 15000 });
    await headerDefinition.click();
    await expect(page.getByRole('code').getByText('int add(int left, int right);')).toBeVisible({
      timeout: 30000,
    });

    await expect.poll(() => failures.consoleFailures, { timeout: 5000 }).toEqual([]);
    await expect.poll(() => failures.pageFailures, { timeout: 5000 }).toEqual([]);
  });
});
