import type { Page, Route } from '@playwright/test';

type CorpusFileMap = Record<string, string>;

type CorpusSource = 'local' | 'r2';

interface RouteCorpusRepositoryOptions {
  page: Page;
  owner: string;
  repo: string;
  manifest?: unknown;
  files?: CorpusFileMap;
  localManifest?: unknown;
  localFiles?: CorpusFileMap;
  r2Manifest?: unknown;
  r2Files?: CorpusFileMap;
  routePattern?: string;
  r2RoutePattern?: string;
  githubContentsPattern?: string;
}

export interface RoutedCorpusRequests {
  local: string[];
  r2: string[];
  all: string[];
}

function normalizePath(pathname: string): string {
  return pathname.replace(/^\/+/, '');
}

export async function routeCorpusRepository({
  page,
  owner,
  repo,
  manifest,
  files,
  localManifest,
  localFiles,
  r2Manifest,
  r2Files,
  routePattern = `**/repos/${owner}/${repo}/**`,
  r2RoutePattern = `https://pub-fed8a8778c5340c9a70aec8e22b8296d.r2.dev/repos/${owner}/${repo}/**`,
  githubContentsPattern = `https://api.github.com/repos/${owner}/${repo}/contents/**`,
}: RouteCorpusRepositoryOptions): Promise<RoutedCorpusRequests> {
  const requests: RoutedCorpusRequests = {
    local: [],
    r2: [],
    all: [],
  };

  const fulfillCorpusRoute = async (route: Route, source: CorpusSource) => {
    const url = route.request().url();
    requests[source].push(url);
    requests.all.push(url);
    const activeManifest = source === 'r2' ? (r2Manifest ?? manifest) : (localManifest ?? manifest);
    const activeFiles = source === 'r2' ? (r2Files ?? files ?? {}) : (localFiles ?? files ?? {});

    if (url.endsWith('/repo-manifest.json') || url.endsWith('/.repo-manifest.json')) {
      if (activeManifest !== undefined) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          headers: {
            'access-control-allow-origin': '*',
          },
          body: JSON.stringify(activeManifest),
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'text/plain; charset=utf-8',
          headers: {
            'access-control-allow-origin': '*',
          },
          body: 'manifest not found',
        });
      }
      return;
    }

    const matchedFilePath = Object.keys(activeFiles).find((filePath) =>
      url.endsWith(`/${normalizePath(filePath)}`)
    );

    if (matchedFilePath) {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        headers: {
          'access-control-allow-origin': '*',
        },
        body: activeFiles[matchedFilePath],
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'text/plain; charset=utf-8',
      headers: {
        'access-control-allow-origin': '*',
      },
      body: 'not found',
    });
  };

  await page.route(routePattern, async (route) => fulfillCorpusRoute(route, 'local'));
  await page.route(r2RoutePattern, async (route) => fulfillCorpusRoute(route, 'r2'));

  await page.route(githubContentsPattern, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ message: 'Not Found' }),
    });
  });

  return requests;
}

export function expectBothCorpusSourcesWereHit(requests: RoutedCorpusRequests): void {
  if (requests.local.length === 0 || requests.r2.length === 0) {
    throw new Error(
      `Expected both local and R2 corpus requests, got local=${requests.local.length}, r2=${requests.r2.length}`
    );
  }
}
