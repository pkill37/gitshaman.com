import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { CURATED_REPOS } from '@/lib/curated-repos';
import { CODE_INDEX_FILE_NAME } from '@/lib/code-index';
import { CODE_INDEX_BROWSER_CACHE_NAME } from '@/lib/repo-static';
import { buildCodeIndex } from '../scripts/code-index-builder';

type SqlJsResponse = {
  url: string;
  status: number;
};

const LITTLE_KERNEL_REPO = CURATED_REPOS.find(
  (repo) => repo.owner === 'littlekernel' && repo.repo === 'lk'
);

if (!LITTLE_KERNEL_REPO) {
  throw new Error('Missing curated Little Kernel repo config');
}
const LITTLE_KERNEL = LITTLE_KERNEL_REPO;

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const LITTLE_KERNEL_REPO_ROOT = path.resolve(
  TEST_DIR,
  '..',
  'repos',
  LITTLE_KERNEL.owner,
  LITTLE_KERNEL.repo
);
const LITTLE_KERNEL_REVISION_ROOT = path.join(LITTLE_KERNEL_REPO_ROOT, LITTLE_KERNEL.revision);

type ManifestTreeNode = {
  name: string;
  type: 'd' | 'f' | 'directory' | 'file';
  children?: ManifestTreeNode[];
};

function normalizeManifestTree(nodes: ManifestTreeNode[]): Parameters<typeof buildCodeIndex>[1] {
  return nodes.map((node) => ({
    name: node.name,
    path: node.name,
    type: node.type === 'd' || node.type === 'directory' ? 'directory' : 'file',
    children: node.children ? normalizeManifestTree(node.children) : undefined,
  }));
}

function ensureLittleKernelCodeIndex(): void {
  const manifestPath = path.join(LITTLE_KERNEL_REVISION_ROOT, 'repo-manifest.json');
  const codeIndexPath = path.join(LITTLE_KERNEL_REVISION_ROOT, CODE_INDEX_FILE_NAME);

  if (fs.existsSync(codeIndexPath)) {
    return;
  }

  if (!fs.existsSync(manifestPath)) {
    test.skip(true, 'Little Kernel corpus is not available locally');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    tree: ManifestTreeNode[];
  };
  buildCodeIndex(
    LITTLE_KERNEL_REVISION_ROOT,
    normalizeManifestTree(manifest.tree),
    `${LITTLE_KERNEL.owner}/${LITTLE_KERNEL.repo}@${LITTLE_KERNEL.revision}`,
    {
      log: () => {},
      warn: () => {},
    }
  );
}

async function startCorpusServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname;
    const repoPrefix = '/repos/littlekernel/lk/';

    if (!pathname.startsWith(repoPrefix)) {
      response.writeHead(404, {
        'access-control-allow-origin': '*',
        'content-type': 'text/plain; charset=utf-8',
      });
      response.end('not found');
      return;
    }

    const repoRelativePath = pathname.slice(repoPrefix.length);
    const absolutePath = path.join(LITTLE_KERNEL_REPO_ROOT, repoRelativePath);

    if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
      response.writeHead(404, {
        'access-control-allow-origin': '*',
        'content-type': 'text/plain; charset=utf-8',
      });
      response.end('not found');
      return;
    }

    const contentType = absolutePath.endsWith('.sqlite')
      ? 'application/octet-stream'
      : absolutePath.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8';

    response.writeHead(200, {
      'access-control-allow-origin': '*',
      'content-type': contentType,
    });
    fs.createReadStream(absolutePath).pipe(response);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start corpus server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function waitForDebugLog(page: Page, label: string, timeout = 30000): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(
          (targetLabel) =>
            (window.__explorarDebugLogs ?? []).some((entry) => entry.label === targetLabel),
          label
        ),
      { timeout, message: `Expected browser debug log ${label}` }
    )
    .toBeTruthy();
}

async function waitForDebugEntry(
  page: Page,
  predicate: (entry: { label: string; payload?: unknown }) => boolean,
  message: string,
  timeout = 30000
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((predicateSource) => {
          const fn = new Function('entry', `return (${predicateSource})(entry);`) as (entry: {
            label: string;
            payload?: unknown;
          }) => boolean;
          return (window.__explorarDebugLogs ?? []).some((entry) => fn(entry));
        }, predicate.toString()),
      { timeout, message }
    )
    .toBeTruthy();
}

test.describe('SQL.js browser runtime', () => {
  test.beforeAll(() => {
    ensureLittleKernelCodeIndex();
  });

  test('loads the Little Kernel search index with the published wasm asset', async ({ page }) => {
    const pageErrors: string[] = [];
    const sqlJsResponses: SqlJsResponse[] = [];
    const corpusServer = await startCorpusServer();

    try {
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      page.on('response', (response) => {
        const url = response.url();
        if (url.includes('/sqljs/')) {
          sqlJsResponses.push({ url, status: response.status() });
        }
      });

      await page.addInitScript(
        ({ baseUrl }) => {
          const originalFetch = window.fetch.bind(window);
          const corpusPathPrefix = '/repos/littlekernel/lk/';

          function rewriteCorpusUrl(requestUrl: string): string | null {
            if (requestUrl.startsWith(corpusPathPrefix)) {
              return `${baseUrl}${requestUrl}`;
            }

            try {
              const parsedUrl = new URL(requestUrl);
              if (parsedUrl.pathname.startsWith(corpusPathPrefix)) {
                return `${baseUrl}${parsedUrl.pathname}${parsedUrl.search}`;
              }
            } catch {
              return null;
            }

            return null;
          }

          window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const requestUrl =
              typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            const localUrl = rewriteCorpusUrl(requestUrl);
            if (localUrl) {
              if (typeof input === 'string' || input instanceof URL) {
                return originalFetch(localUrl, init);
              }
              return originalFetch(
                localUrl,
                init ?? {
                  method: input.method,
                  headers: input.headers,
                }
              );
            }

            return originalFetch(input, init);
          };
        },
        { baseUrl: corpusServer.baseUrl }
      );

      const response = await page.goto('/little-kernel/');
      expect(response?.status()).toBe(200);

      await page.getByRole('button', { name: 'File search' }).click();
      await page.locator('.vscode-tree-search-input').fill('main');

      await waitForDebugLog(page, '[explorar:code-index-static] success');
      await expect(page.locator('.vscode-tree-search-index-badge')).toHaveText('ready');
      await expect(page.locator('.vscode-tree-search-group-header').first()).toBeVisible();
      await waitForDebugEntry(
        page,
        (entry) => {
          const payload = entry.payload as Record<string, unknown> | undefined;
          return (
            entry.label === '[explorar:code-index-static] success' &&
            payload?.sourceMode === 'local-filesystem' &&
            typeof payload?.url === 'string' &&
            payload.url.startsWith('/repos/littlekernel/lk/') &&
            payload.url.endsWith('/code-index.sqlite')
          );
        },
        'Expected search index to load from the local staged corpus by default'
      );

      await expect
        .poll(
          async () => sqlJsResponses.some((entry) => entry.url.endsWith('/sql-wasm-browser.wasm')),
          {
            timeout: 30000,
            message: 'Expected sql-wasm-browser.wasm to be requested by the browser runtime',
          }
        )
        .toBeTruthy();

      expect(sqlJsResponses.filter((entry) => entry.status >= 400)).toEqual([]);
      expect(pageErrors).toEqual([]);

      await expect
        .poll(
          async () =>
            page.evaluate(async (cacheName) => {
              const cache = await caches.open(cacheName);
              const keys = await cache.keys();
              return keys.map((request) => request.url);
            }, CODE_INDEX_BROWSER_CACHE_NAME),
          {
            timeout: 30000,
            message: 'Expected code-index.sqlite to be stored in browser cache',
          }
        )
        .toContainEqual(
          expect.stringMatching(
            /^http:\/\/localhost:\d+\/repos\/littlekernel\/lk\/.+\/code-index\.sqlite\?__explorar_source=local-filesystem$/
          )
        );

      // A reload must search the persisted index even when its network URL is unavailable.
      await page.route('**/code-index.sqlite', (route) => route.abort());
      await page.reload();
      await page.getByRole('button', { name: 'File search' }).click();
      await page.locator('.vscode-tree-search-input').fill('main');
      await expect(page.getByText('Cached index ready', { exact: true })).toBeVisible();
      await expect(page.locator('.vscode-tree-search-group-header').first()).toBeVisible();
      await page.unroute('**/code-index.sqlite');

      await page.getByLabel('Storage source').selectOption('r2-bucket');
      await waitForDebugEntry(
        page,
        (entry) => {
          const payload = entry.payload as Record<string, unknown> | undefined;
          return (
            entry.label === '[explorar:code-index-static] success' &&
            payload?.sourceMode === 'r2-bucket' &&
            typeof payload?.url === 'string' &&
            payload.url.includes(
              'pub-fed8a8778c5340c9a70aec8e22b8296d.r2.dev/repos/littlekernel/lk/'
            ) &&
            payload.url.endsWith('/code-index.sqlite')
          );
        },
        'Expected search index to load from the R2 bucket after switching source'
      );

      await expect
        .poll(
          async () =>
            page.evaluate(async (cacheName) => {
              const cache = await caches.open(cacheName);
              const keys = await cache.keys();
              return keys.map((request) => request.url);
            }, CODE_INDEX_BROWSER_CACHE_NAME),
          {
            timeout: 30000,
            message: 'Expected local and R2 code indexes to use separate browser cache keys',
          }
        )
        .toEqual(
          expect.arrayContaining([
            expect.stringMatching(
              /^http:\/\/localhost:\d+\/repos\/littlekernel\/lk\/.+\/code-index\.sqlite\?__explorar_source=local-filesystem$/
            ),
            expect.stringMatching(
              /^https:\/\/pub-fed8a8778c5340c9a70aec8e22b8296d\.r2\.dev\/repos\/littlekernel\/lk\/.+\/code-index\.sqlite\?__explorar_source=r2-bucket$/
            ),
          ])
        );

      const wasmResponse = await page.request.get('/sqljs/sql-wasm-browser.wasm');
      expect(wasmResponse.status()).toBe(200);
    } finally {
      await corpusServer.close();
    }
  });
});
