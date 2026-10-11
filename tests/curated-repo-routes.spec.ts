import { expect, test } from '@playwright/test';

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
