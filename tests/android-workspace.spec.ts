import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { buildAndroidWorkspace } from '../scripts/android-workspace';
import { CURATED_REPOS, type CuratedRepoConfig } from '../src/lib/curated-repos';
import type { AndroidWorkspace } from '../src/lib/android/workspace';

let temporary: string;
const fixtures = new Map<string, { metadata: AndroidWorkspace; root: string }>();
test.beforeAll(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshaman-android-browser-'));
  for (const config of CURATED_REPOS.filter((entry) => entry.androidWorkspace)) {
    const root = path.join(temporary, config.owner, config.repo, config.revision);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'default.xml'),
      '<manifest><remote name="upstream" fetch="https://github.com/"/><default remote="upstream" revision="release"/><project name="example/base" path="frameworks/base"/><project name="example/core" path="system/core"/></manifest>'
    );
    const metadata = await buildAndroidWorkspace(
      { ...config, androidWorkspace: { projects: ['frameworks/base', 'system/core'] } },
      {
        corpusRoot: temporary,
        lockRoot: path.join(temporary, 'locks'),
        checkout: async (_url, _revision, dest) => {
          fs.mkdirSync(dest, { recursive: true });
          fs.writeFileSync(
            path.join(dest, 'main.ts'),
            'export function androidSharedSymbol() { return 1; }\nandroidSharedSymbol();\n'
          );
          return 'b'.repeat(40);
        },
      }
    );
    fixtures.set(config.owner, { metadata, root });
  }
});
test.afterAll(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
});

async function routeFixture(page: Page, config: CuratedRepoConfig, delayIndexes = false) {
  const { metadata, root } = fixtures.get(config.owner)!;
  await page.route(`**/repos/${config.owner}/${config.repo}/**`, async (route) => {
    if (delayIndexes && route.request().url().endsWith('.sqlite'))
      await new Promise((resolve) => setTimeout(resolve, 1200));
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const marker = `/${config.revision}/`;
    const relative = pathname.slice(pathname.indexOf(marker) + marker.length);
    const file = path.join(root, relative);
    if (relative === 'repo-manifest.json') {
      await route.fulfill({ json: { tree: metadata.manifestTree } });
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      await route.fulfill({
        body: fs.readFileSync(file),
        contentType: file.endsWith('.json')
          ? 'application/json'
          : file.endsWith('.sqlite')
            ? 'application/octet-stream'
            : 'text/plain',
      });
    } else await route.fulfill({ status: 404, body: 'Not in fixture' });
  });
}

for (const config of CURATED_REPOS.filter((entry) => entry.androidWorkspace)) {
  test(`${config.displayName} opens platform source, searches projects and preserves manifest links`, async ({
    page,
  }) => {
    await routeFixture(page, config);
    await page.goto(`/${config.slug}?file=frameworks/base/main.ts&line=2`);
    const controls = page.getByRole('region', { name: 'Android workspace' });
    await expect(controls.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(controls).toContainText('Core projects indexed (2)');
    await expect(page.locator('.android-file-provenance')).toContainText('frameworks/base');
    await expect(page.getByRole('link', { name: 'Upstream source' })).toHaveAttribute(
      'href',
      `https://github.com/example/base/blob/${'b'.repeat(40)}/main.ts#L2`
    );
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    const invoke = async (action: 'goToDefinitionAtCursor' | 'showReferencesAtCursor') =>
      page.evaluate(async (action) => {
        const api = (
          window as Window & {
            __explorarTestApi?: {
              focusSymbol(symbol: string): Promise<boolean>;
              goToDefinitionAtCursor(): Promise<boolean>;
              showReferencesAtCursor(): Promise<boolean>;
            };
          }
        ).__explorarTestApi;
        if (!api || !(await api.focusSymbol('androidSharedSymbol'))) return false;
        return api[action]();
      }, action);
    expect(await invoke('goToDefinitionAtCursor')).toBe(true);
    await expect(page.getByText('Definitions of', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Repository file search results' })
    ).toContainText('system/core');
    expect(await invoke('showReferencesAtCursor')).toBe(true);
    await expect(page.getByText('References to', { exact: false })).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search all files' }).fill('androidSharedSymbol');
    const results = page.getByRole('region', { name: 'Repository file search results' });
    await expect(results).toContainText('frameworks/base');
    await expect(results).toContainText('system/core');
    await controls.getByLabel('Search Android project').selectOption('system/core');
    await expect(results).not.toContainText('frameworks/base');
    await expect(results).toContainText('system/core');
    await controls.getByRole('button', { name: 'Manifest', exact: true }).click();
    await page.getByRole('button', { name: 'File editor', exact: true }).click();
    await page.getByText('default.xml', { exact: true }).first().click();
    await expect(page.locator('.android-file-provenance')).toContainText('Manifest');
  });
}

test('switching Android distributions discards an in-flight search', async ({ page }) => {
  const lineage = CURATED_REPOS.find((entry) => entry.owner === 'LineageOS')!;
  const graphene = CURATED_REPOS.find((entry) => entry.owner === 'GrapheneOS')!;
  await routeFixture(page, lineage, true);
  await routeFixture(page, graphene);
  await page.goto(`/${lineage.slug}`);
  await expect(page.getByRole('region', { name: 'Android workspace' })).toContainText(
    'Core projects indexed (2)'
  );
  await page.getByRole('button', { name: 'File search', exact: true }).click();
  const requested = page.waitForRequest(
    (request) => request.url().includes('/LineageOS/') && request.url().endsWith('.sqlite')
  );
  await page.getByRole('searchbox', { name: 'Search all files' }).fill('androidSharedSymbol');
  await requested;
  await expect(page.getByRole('navigation', { name: 'AOSP repository family' })).toHaveCount(0);
  await page.goto(`/${graphene.slug}`);
  await expect(page).toHaveURL(new RegExp(graphene.slug));
  await expect(page.getByRole('region', { name: 'Android workspace' })).toContainText(
    'Core projects indexed (2)'
  );
  await page.getByRole('button', { name: 'File search', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search all files' })).toHaveValue('');
  await expect(
    page.getByRole('region', { name: 'Repository file search results' })
  ).not.toContainText('androidSharedSymbol');
});

for (const config of CURATED_REPOS.filter((entry) => entry.androidWorkspace)) {
  test(`real ${config.displayName} snapshot opens a pinned Android file`, async ({ page }) => {
    test.skip(!process.env.ANDROID_REAL_CORPUS, 'Requires prepared Android corpus snapshots');
    const workspace = JSON.parse(
      fs.readFileSync(
        path.join('repos', config.owner, config.repo, config.revision, 'android/workspace.json'),
        'utf8'
      )
    ) as AndroidWorkspace;
    const project = workspace.projects.find((entry) => entry.path === 'frameworks/base')!;
    const file = 'frameworks/base/core/java/android/app/Activity.java';
    await page.goto(`/${config.slug}?file=${file}&line=26`);
    await expect(page.getByRole('region', { name: 'Android workspace' })).toContainText(
      `Core projects indexed (${workspace.projects.length})`
    );
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(page.locator('.android-file-provenance')).toContainText(
      project.commit.slice(0, 12)
    );
    await expect(page.getByRole('link', { name: 'Upstream source' })).toHaveAttribute(
      'href',
      `${project.url}/blob/${project.commit}/core/java/android/app/Activity.java#L26`
    );
    await expect(page.getByText('Failed to load file', { exact: false })).toHaveCount(0);
  });
}

for (const savedTheme of ['light', 'dark'] as const) {
  test(`restores the saved ${savedTheme} workspace theme without hydration errors`, async ({
    page,
  }) => {
    const config = CURATED_REPOS.find((entry) => entry.owner === 'GrapheneOS')!;
    await routeFixture(page, config);
    await page.addInitScript((theme) => {
      localStorage.setItem('repository-workspace-explorer-theme', theme);
    }, savedTheme);
    const hydrationErrors: string[] = [];
    page.on('pageerror', (error) => {
      if (/hydrat|server rendered/i.test(error.message)) hydrationErrors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat|server rendered/i.test(message.text())) {
        hydrationErrors.push(message.text());
      }
    });
    await page.goto(`/${config.slug}`);
    await expect(page.locator(`main.vscode-theme-${savedTheme}:visible`)).toBeVisible();
    await expect(
      page.locator(`.vscode-container.vscode-theme-${savedTheme}:visible`)
    ).toBeVisible();
    const nextTheme = savedTheme === 'light' ? 'dark' : 'light';
    await page.getByRole('button', { name: `Use ${nextTheme} theme` }).click();
    await expect(page.locator(`main.vscode-theme-${nextTheme}:visible`)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('repository-workspace-explorer-theme')))
      .toBe(nextTheme);
    expect(hydrationErrors).toEqual([]);
  });
}
