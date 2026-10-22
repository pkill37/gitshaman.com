import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { cliFixture } from './helpers/cli-fixture';
import { analyze } from '../packages/cli/src/analysis';
import { serveWorkspace } from '../packages/cli/src/server';
import { parseSharedQuiz, sharedQuizURL } from '../src/lib/quiz';

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
test('Quiz shares the editor workspace and follows the selected chapter', async ({ page }) => {
  page.setDefaultTimeout(10000);
  const quizRequests: string[] = [];
  await page.route('**/api/quiz', async (route) => {
    quizRequests.push(route.request().url());
    await route.fulfill({
      status: 500,
      body: 'Chapter practice must not request a change assessment.',
    });
  });
  const target = new URL(url);
  target.searchParams.set('view', 'quiz');
  target.searchParams.set('file', 'src/auth.ts');
  await page.goto(target.toString());
  const quiz = page.getByRole('button', { name: 'Quiz', exact: true });
  await expect(quiz).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  const panel = page.getByRole('region', { name: 'Chapter quiz' });
  await expect(panel).toContainText('Repository overview');
  await expect(panel).toContainText('This chapter has no quiz questions yet.');
  await expect(panel.getByRole('button', { name: 'Start or resume quiz' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Source map', exact: true }).click();
  await expect(panel).toContainText('Source map');
  await expect(panel).not.toContainText('Repository overview');
  await expect(quiz).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await quiz.click();
  await expect(panel).toBeHidden();
  await quiz.click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Source map');
  expect(quizRequests).toEqual([]);
});

test('shared practice works in the public Quiz component without a local source or model provider', async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import Panel from './src/features/repository/components/RepositoryQuizPanel';
createRoot(document.getElementById('root')).render(<Panel owner="example" repo="fixture" />);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outfile: '/tmp/gitshaman-quiz-fixture.js',
    jsx: 'automatic',
    platform: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const quiz = parseSharedQuiz(
    JSON.stringify({
      version: 1,
      repository: 'example/fixture',
      revision: 'a'.repeat(40),
      questions: [{ prompt: 'What prevents a duplicate?', explanation: 'A recorded event ID.' }],
    })
  );
  const requests: string[] = [];
  await page.route('https://quiz.example/**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div id="root"></div></body></html>',
    });
  });
  await page.goto(sharedQuizURL(quiz).replace('https://gitshaman.com', 'https://quiz.example'));
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
  const panel = page.getByRole('region', { name: 'Repository quiz' });
  await expect(panel).toContainText('What prevents a duplicate?');
  await expect(panel).not.toContainText('A recorded event ID.');
  await panel.getByLabel('Your reasoning').fill('My private practice reasoning');
  await panel.getByRole('button', { name: 'Show explanation' }).click();
  await expect(panel).toContainText('A recorded event ID.');
  await expect(panel).toContainText('Practice complete.');
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download for Anki' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('gitshaman-quiz-anki.txt');
  const content = fs.readFileSync((await download.path())!, 'utf8');
  expect(content).toContain('What prevents a duplicate?\tA recorded event ID.');
  expect(content).not.toContain('My private practice reasoning');
  // The regular website entry also supports importing and exporting without a shared URL.
  await page.goto('https://quiz.example/example/fixture');
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
  await expect(panel).toContainText('Practice and study offline');
  await panel.getByLabel('Import practice quiz').setInputFiles({
    name: 'practice.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(quiz)),
  });
  const importedDownloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download for Anki' }).click();
  const importedDownload = await importedDownloadPromise;
  expect(fs.readFileSync((await importedDownload.path())!, 'utf8')).toBe(content);
  expect(requests).toHaveLength(2);
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
