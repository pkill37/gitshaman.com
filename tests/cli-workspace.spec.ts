import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { cliFixture } from './helpers/cli-fixture';
import { analyze } from '../packages/cli/src/analysis';
import { serveWorkspace } from '../packages/cli/src/server';

let root: string;
let server: http.Server;
let url: string;
test.beforeAll(async () => {
  root = cliFixture();
  fs.appendFileSync(
    path.join(root, 'src/token.ts'),
    '\nexport interface TokenOptions {\n  value: string;\n}\n'
  );
  await analyze(root, { noEmbed: true });
  const workspace = await serveWorkspace(root, path.resolve('packages/cli/dist/workspace'));
  server = workspace.server;
  url = workspace.url;
});
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
test('shared repository interface, local search, entities, theme, and stale state', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const external: string[] = [];
  const wasmResponses: Array<{ status: number; contentType: string }> = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/sqljs/sql-wasm-browser.wasm') {
      wasmResponses.push({
        status: response.status(),
        contentType: response.headers()['content-type'],
      });
    }
  });
  page.on('request', (request) => {
    if (!request.url().startsWith(new URL(url).origin) && /^https?:/.test(request.url()))
      external.push(request.url());
  });
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'File editor', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'Entities', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'File search', exact: true }).click();
  await expect
    .poll(() => wasmResponses)
    .toEqual([{ status: 200, contentType: 'application/wasm' }]);
  await page.getByRole('searchbox', { name: 'Search all files' }).fill('auth');
  const results = page.getByRole('region', { name: 'Repository file search results' });
  await expect(results).toContainText('auth.ts');
  await results.getByText('auth.ts', { exact: true }).first().click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await expect(page.locator('.monaco-editor').first()).toContainText('authenticate');
  await page.getByRole('tab', { name: 'Source map', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search entities' }).fill('TokenOptions');
  const entity = page.locator('.explorar-entity-card').filter({ hasText: 'TokenOptions' }).first();
  await expect(entity).toBeVisible();
  await entity.click();
  await expect(page.locator('.monaco-editor').first()).toContainText('token.length');
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect(page.locator('main.vscode-theme-light')).toBeVisible();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Repository discussion' })).toBeVisible();
  fs.appendFileSync(path.join(root, 'src/auth.ts'), '\nexport const changed = true;');
  await expect(page.getByRole('status')).toContainText('Source changed since analysis', {
    timeout: 20000,
  });
  await page.reload();
  await expect(page.locator('.monaco-editor').first()).toContainText('token.length');
  await expect(page.locator('main.vscode-theme-light')).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('file URLs retain focus and authorization across reloads', async ({ page }) => {
  const target = new URL(url);
  target.searchParams.set('file', 'src/token.ts');
  target.searchParams.set('line', '2');
  await page.goto(target.toString());
  await expect(page.locator('.monaco-editor').first()).toContainText('token.length');
  await expect(page).toHaveURL(/\?file=src%2Ftoken.ts&line=2$/);
  await page.reload();
  await expect(page.locator('.monaco-editor').first()).toContainText('token.length');
  await page.getByRole('button', { name: 'File editor', exact: true }).click();
  await page.getByRole('button', { name: 'File editor', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Repository file tree' })).toBeVisible();
});

test('Find References opens the shared file-search view', async ({ page }) => {
  const target = new URL(url);
  target.searchParams.set('file', 'src/auth.ts');
  await page.goto(target.toString());
  await expect(page.locator('.monaco-editor').first()).toContainText('authenticate');
  const focused = await page.evaluate(async () => {
    const api = (
      window as Window & {
        __explorarTestApi?: { focusSymbol: (symbol: string) => Promise<boolean> };
      }
    ).__explorarTestApi;
    return api?.focusSymbol('authenticate');
  });
  expect(focused).toBe(true);
  await page.keyboard.press('Shift+F12');
  await expect(page.getByRole('button', { name: 'File search', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('searchbox', { name: 'Search all files' })).toHaveValue(
    'authenticate'
  );
  const results = page.getByRole('region', { name: 'Repository file search results' });
  await expect(results.locator('.vscode-tree-search-row').first()).toContainText('authenticate');
  await expect(page.getByRole('complementary', { name: 'Cross references' })).toHaveCount(0);
});
