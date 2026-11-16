import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { routeCorpusRepository } from './helpers/corpus-routing';

import {
  CURATED_REPOS,
  getCuratedRepoPath,
  getCuratedRepoRouteParams,
  resolveCuratedRepoRoute,
} from '@/lib/curated-repos';

test.describe('curated repo routes', () => {
  test('export both canonical and legacy static-export params for every curated repo', () => {
    const params = getCuratedRepoRouteParams();

    expect(params).toHaveLength(CURATED_REPOS.length * 2);

    for (const repo of CURATED_REPOS) {
      expect(params).toContainEqual({ repoPath: [repo.slug] });
      expect(params).toContainEqual({ repoPath: [repo.owner, repo.repo] });
    }
  });

  test('resolve canonical and legacy route segments to the same curated repo', () => {
    const repo = CURATED_REPOS.find(
      (entry) => entry.owner === 'littlekernel' && entry.repo === 'lk'
    );
    expect(repo).toBeTruthy();
    if (!repo) {
      return;
    }

    const canonical = resolveCuratedRepoRoute([repo.slug]);
    expect(canonical).toEqual({
      config: repo,
      canonicalPath: getCuratedRepoPath(repo.owner, repo.repo),
      isLegacyPath: false,
    });

    const legacy = resolveCuratedRepoRoute([repo.owner, repo.repo]);
    expect(legacy).toEqual({
      config: repo,
      canonicalPath: getCuratedRepoPath(repo.owner, repo.repo),
      isLegacyPath: true,
    });
  });

  test('rejects invalid route segment shapes', () => {
    expect(resolveCuratedRepoRoute([])).toBeNull();
    expect(resolveCuratedRepoRoute(['too', 'many', 'segments'])).toBeNull();
    expect(resolveCuratedRepoRoute(['not-a-curated-slug'])).toBeNull();
    expect(resolveCuratedRepoRoute(['unknown', 'repo'])).toBeNull();
  });
});

test('GCC exposes its pinned guide and compiler entry point', async ({ page }) => {
  const gcc = CURATED_REPOS.find((repo) => repo.slug === 'gcc-compiler');
  if (!gcc) throw new Error('Missing curated GCC repository');

  // CI has no downloaded corpus. Serve the pinned source locally so this route
  // test does not depend on a deployed R2 object or GitHub availability.
  const requests = await routeCorpusRepository({
    page,
    owner: gcc.owner,
    repo: gcc.repo,
    manifest: {
      tree: [{ name: 'gcc', type: 'd', children: [{ name: 'main.cc', type: 'f' }] }],
    },
    files: {
      'gcc/main.cc': await readFile(
        new URL('./fixtures/gcc-15.2.0-main.cc', import.meta.url),
        'utf8'
      ),
    },
  });

  await page.goto('/gcc-compiler?file=gcc/main.cc&line=34');
  await expect(page.locator('[data-guide-markdown]').first()).toContainText(
    'The program named gcc is a driver.',
    { timeout: 30000 }
  );
  await expect(
    page.getByRole('code').getByText('main (int argc, char **argv)', { exact: true })
  ).toBeVisible({
    timeout: 30000,
  });
  expect(requests.local).toContainEqual(
    expect.stringContaining(`/repos/${gcc.owner}/${gcc.repo}/${gcc.revision}/gcc/main.cc`)
  );
});
