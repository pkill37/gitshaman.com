import { expect, test } from '@playwright/test';

test('waits for the actual default branch before loading the root directory', async ({ page }) => {
  const revisions: Array<string | null> = [];
  let releaseMetadata!: () => void;
  const metadataReady = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });
  await page.route('https://api.github.com/repos/guide-test/default-branch', async (route) => {
    await metadataReady;
    await route.fulfill({ json: { default_branch: 'master' } });
  });
  await page.route('https://api.github.com/repos/guide-test/default-branch/contents**', (route) => {
    const ref = new URL(route.request().url()).searchParams.get('ref');
    revisions.push(ref);
    return ref === 'master'
      ? route.fulfill({ json: [{ name: 'README.md', path: 'README.md', type: 'file', size: 40 }] })
      : route.fulfill({ status: 404, json: { message: 'No commit found for the ref main' } });
  });
  await page.route(
    'https://raw.githubusercontent.com/guide-test/default-branch/master/README.md',
    (route) => route.fulfill({ body: '# Default branch resolved correctly' })
  );
  await page.goto('/guide-test/default-branch/');
  await expect(page.getByText('Resolving repository revision…', { exact: true })).toBeVisible();
  expect(revisions).toEqual([]);
  releaseMetadata();
  await expect(
    page.getByText('# Default branch resolved correctly', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Repository file tree' })).toContainText(
    'README.md'
  );
  expect(revisions.length).toBeGreaterThan(0);
  expect(revisions.every((ref) => ref === 'master')).toBe(true);
});

test('builds a source-backed guide and scopes it to a workspace', async ({ page }) => {
  const base = 'https://api.github.com/repos/guide-test/monorepo';
  await page.route(`${base}/contents**`, (route) => {
    const path = new URL(route.request().url()).pathname.split('/contents')[1];
    const entries =
      path === '/packages'
        ? [{ name: 'web', path: 'packages/web', type: 'dir' }]
        : path === '/packages/web'
          ? [{ name: 'package.json', path: 'packages/web/package.json', type: 'file', size: 80 }]
          : [
              { name: 'README.md', path: 'README.md', type: 'file', size: 80 },
              { name: 'package.json', path: 'package.json', type: 'file', size: 100 },
              { name: 'packages', path: 'packages', type: 'dir' },
            ];
    return route.fulfill({ json: entries });
  });
  await page.route('https://raw.githubusercontent.com/guide-test/monorepo/main/**', (route) => {
    const url = route.request().url();
    return route.fulfill({
      body: url.endsWith('/README.md')
        ? '# Fixture project\nA source-backed project overview.'
        : JSON.stringify(
            url.includes('/packages/web/')
              ? { description: 'Web workspace', scripts: { test: 'vitest run' } }
              : {
                  description: 'Root workspace',
                  workspaces: ['packages/*'],
                  scripts: { build: 'tsc -b' },
                }
          ),
    });
  });
  await page.goto('/guide-test/monorepo/?ref=main');
  await expect(page.getByText('Root workspace', { exact: true })).toBeVisible();
  await expect(page.getByText(/A source-backed project overview/)).toBeVisible();
  await page.getByRole('tab', { name: 'Build and test', exact: true }).click();
  await expect(page.getByText('tsc -b', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Repository overview', exact: true }).click();
  await page.getByRole('combobox', { name: 'Explore a workspace' }).selectOption('packages/web');
  await expect(page.getByText('Web workspace', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Build and test', exact: true }).click();
  await expect(page.getByText('vitest run', { exact: true })).toBeVisible();
  await expect(page.getByText('tsc -b', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Repository overview', exact: true }).click();
  await page.getByRole('button', { name: 'Back to repository overview' }).click();
  await expect(page.getByText('Root workspace', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open full README' }).click();
  await expect(page.getByRole('code').getByText('A source-backed project overview.')).toBeVisible();
});

test('preserves direct file targets and replaces guidance when navigating repositories', async ({
  page,
}) => {
  await page.route('https://api.github.com/repos/guide-test/*/contents**', (route) =>
    route.fulfill({
      json: [
        { name: 'package.json', path: 'package.json', type: 'file', size: 100 },
        { name: 'main.c', path: 'main.c', type: 'file', size: 30 },
      ],
    })
  );
  await page.route('https://raw.githubusercontent.com/guide-test/**', (route) =>
    route.fulfill({
      body: route.request().url().endsWith('/main.c')
        ? 'int guide_target = 42;\n'
        : JSON.stringify({
            description: route.request().url().includes('/first/')
              ? 'First repository description'
              : 'Second repository description',
          }),
    })
  );
  await page.goto('/guide-test/first/blob/release/main.c');
  await expect(page.getByRole('code').getByText('int guide_target = 42;')).toBeVisible();
  await expect(page.getByText('First repository description', { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.history.pushState(null, '', '/?github_path=%2Fguide-test%2Fsecond%2Ftree%2Frelease')
  );
  await expect(page.getByText('Second repository description', { exact: true })).toBeVisible();
  await expect(page.getByText('First repository description', { exact: true })).toHaveCount(0);
});

test('keeps a useful guide when a repository has no documentation', async ({ page }) => {
  await page.route('https://api.github.com/repos/guide-test/sparse/contents**', (route) =>
    route.fulfill({ json: [{ name: 'src', path: 'src', type: 'dir' }] })
  );
  await page.goto('/guide-test/sparse/?ref=release');
  await expect(page.getByText('No README was discovered here.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Source map', exact: true }).click();
  await expect(page.getByRole('button', { name: 'src', exact: true })).toBeVisible();
});

test('retries failed guide requests without losing the repository workspace', async ({ page }) => {
  let unavailable = true;
  await page.route('https://api.github.com/repos/guide-test/retry/contents**', (route) =>
    unavailable
      ? route.fulfill({ status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: '{}' })
      : route.fulfill({ json: [] })
  );
  await page.goto('/guide-test/retry/?ref=main');
  await expect(page.getByRole('button', { name: 'Retry guide loading' })).toBeVisible();
  unavailable = false;
  await page.getByRole('button', { name: 'Retry guide loading' }).click();
  await expect(page.getByText('No README was discovered here.', { exact: false })).toBeVisible();
});
