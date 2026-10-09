import { expect, test } from '@playwright/test';

import {
  buildCuratedRepoUrlForSource,
  getDefaultCuratedRepoSourceMode,
  isLocalFilesystemCorpusAvailable,
  normalizeCuratedRepoSourceMode,
} from '@/lib/curated-content-url';
import {
  buildCodeIndexBrowserCacheKey,
  getTreeStructureFromStatic,
  readFileFromStatic,
} from '@/lib/repo-static';
import { fetchRepositoryFile } from '@/lib/github-api';

const OWNER = 'littlekernel';
const REPO = 'lk';
const BRANCH = 'source-routing-test';
const R2_BASE_URL = 'https://r2.example.test';

async function withR2BaseUrl<T>(run: () => T | Promise<T>): Promise<T> {
  const previousPublicBaseUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  const previousLegacyBaseUrl = process.env.NEXT_PUBLIC_CURATED_CONTENT_BASE_URL;
  process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL = R2_BASE_URL;
  delete process.env.NEXT_PUBLIC_CURATED_CONTENT_BASE_URL;

  try {
    return await run();
  } finally {
    if (previousPublicBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL = previousPublicBaseUrl;
    }

    if (previousLegacyBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_CURATED_CONTENT_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_CURATED_CONTENT_BASE_URL = previousLegacyBaseUrl;
    }
  }
}

async function withoutR2BaseUrl<T>(run: () => T | Promise<T>): Promise<T> {
  const previousPublicBaseUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  const previousLegacyBaseUrl = process.env.NEXT_PUBLIC_CURATED_CONTENT_BASE_URL;
  delete process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  delete process.env.NEXT_PUBLIC_CURATED_CONTENT_BASE_URL;

  try {
    return await run();
  } finally {
    if (previousPublicBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL = previousPublicBaseUrl;
    }

    if (previousLegacyBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_CURATED_CONTENT_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_CURATED_CONTENT_BASE_URL = previousLegacyBaseUrl;
    }
  }
}

async function withNodeEnv<T>(
  nodeEnv: 'development' | 'production' | 'test',
  run: () => T | Promise<T>
): Promise<T> {
  const previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, 'NODE_ENV', nodeEnv);

  try {
    return await run();
  } finally {
    if (previousNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, 'NODE_ENV');
    } else {
      Reflect.set(process.env, 'NODE_ENV', previousNodeEnv);
    }
  }
}

async function withMockedFetch<T>(
  handler: (url: string) => Response | Promise<Response>,
  run: (calls: string[]) => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test.describe('curated repo source routing', () => {
  test('builds local staged and R2 URLs from the selected source mode', () => {
    return withR2BaseUrl(() => {
      expect(
        buildCuratedRepoUrlForSource(OWNER, REPO, BRANCH, 'top/main.c', 'local-filesystem')
      ).toBe(`/repos/${OWNER}/${REPO}/${BRANCH}/top/main.c`);

      expect(buildCuratedRepoUrlForSource(OWNER, REPO, BRANCH, 'top/main.c', 'r2-bucket')).toBe(
        `${R2_BASE_URL}/repos/${OWNER}/${REPO}/${BRANCH}/top/main.c`
      );
    });
  });

  test('does not allow local staged corpus mode outside development builds', async () => {
    await withNodeEnv('production', async () => {
      await withR2BaseUrl(() => {
        expect(isLocalFilesystemCorpusAvailable()).toBe(false);
        expect(getDefaultCuratedRepoSourceMode()).toBe('r2-bucket');
        expect(normalizeCuratedRepoSourceMode('local-filesystem')).toBe('r2-bucket');
      });
    });
  });

  test('defaults by runtime environment', async () => {
    await withR2BaseUrl(async () => {
      await withNodeEnv('development', async () => {
        expect(isLocalFilesystemCorpusAvailable()).toBe(true);
        expect(getDefaultCuratedRepoSourceMode()).toBe('local-filesystem');
      });

      await withNodeEnv('production', async () => {
        expect(isLocalFilesystemCorpusAvailable()).toBe(false);
        expect(getDefaultCuratedRepoSourceMode()).toBe('r2-bucket');
      });

      await withNodeEnv('test', async () => {
        expect(isLocalFilesystemCorpusAvailable()).toBe(false);
        expect(getDefaultCuratedRepoSourceMode()).toBe('r2-bucket');
      });
    });
  });

  test('normalizes unavailable source selections based on R2 configuration', async () => {
    await withNodeEnv('development', async () => {
      await withR2BaseUrl(() => {
        expect(normalizeCuratedRepoSourceMode('local-filesystem')).toBe('local-filesystem');
        expect(normalizeCuratedRepoSourceMode('r2-bucket')).toBe('r2-bucket');
      });

      await withoutR2BaseUrl(() => {
        expect(normalizeCuratedRepoSourceMode('r2-bucket')).toBe('local-filesystem');
      });
    });

    await withNodeEnv('production', async () => {
      await withR2BaseUrl(() => {
        expect(normalizeCuratedRepoSourceMode('local-filesystem')).toBe('r2-bucket');
        expect(normalizeCuratedRepoSourceMode('r2-bucket')).toBe('r2-bucket');
      });

      await withoutR2BaseUrl(() => {
        expect(normalizeCuratedRepoSourceMode('local-filesystem')).toBe('r2-bucket');
        expect(normalizeCuratedRepoSourceMode('r2-bucket')).toBe('r2-bucket');
      });
    });
  });

  test('reads file content only from the selected local staged source', async () => {
    await withMockedFetch(
      (url) => {
        if (url === `/repos/${OWNER}/${REPO}/${BRANCH}/top/main.c`) {
          return new Response('local staged content', { status: 200 });
        }
        return new Response('wrong source', { status: 500 });
      },
      async (calls) => {
        const result = await readFileFromStatic(OWNER, REPO, BRANCH, 'top/main.c', {
          sourceMode: 'local-filesystem',
        });

        expect(result.content).toBe('local staged content');
        expect(result.debugInfo?.source).toBe('local-filesystem');
        expect(calls).toEqual([`/repos/${OWNER}/${REPO}/${BRANCH}/top/main.c`]);
      }
    );
  });

  test('fetches repository files from an explicit local source even when R2 is configured', async () => {
    await withR2BaseUrl(() =>
      withMockedFetch(
        (url) => {
          if (url === `/repos/${OWNER}/${REPO}/${BRANCH}/top/main.c`) {
            return new Response('local explicit content', { status: 200 });
          }
          return new Response('wrong source', { status: 500 });
        },
        async (calls) => {
          const result = await fetchRepositoryFile(OWNER, REPO, BRANCH, 'top/main.c', {
            sourceMode: 'local-filesystem',
          });

          expect(result.content).toBe('local explicit content');
          expect(result.debugInfo?.source).toBe('local-filesystem');
          expect(calls).toEqual([`/repos/${OWNER}/${REPO}/${BRANCH}/top/main.c`]);
        }
      )
    );
  });

  test('skips static corpus probes for arbitrary GitHub repositories', async () => {
    await withR2BaseUrl(() =>
      withMockedFetch(
        (url) => {
          if (
            url === 'https://raw.githubusercontent.com/s0xDk/ghostty-blackhole/main/blackhole.glsl'
          ) {
            return new Response('runtime repo content', { status: 200 });
          }
          return new Response('unexpected source', { status: 500 });
        },
        async (calls) => {
          const result = await fetchRepositoryFile(
            's0xDk',
            'ghostty-blackhole',
            'main',
            'blackhole.glsl',
            {
              sourceMode: 'local-filesystem',
            }
          );

          expect(result.content).toBe('runtime repo content');
          expect(result.debugInfo?.source).toBe('github-api');
          expect(calls).toEqual([
            'https://raw.githubusercontent.com/s0xDk/ghostty-blackhole/main/blackhole.glsl',
          ]);
        }
      )
    );
  });

  test('reads file content only from the selected R2 bucket source', async () => {
    await withR2BaseUrl(() =>
      withMockedFetch(
        (url) => {
          if (url === `${R2_BASE_URL}/repos/${OWNER}/${REPO}/${BRANCH}/top/main.c`) {
            return new Response('r2 content', { status: 200 });
          }
          return new Response('wrong source', { status: 500 });
        },
        async (calls) => {
          const result = await readFileFromStatic(OWNER, REPO, BRANCH, 'top/main.c', {
            sourceMode: 'r2-bucket',
          });

          expect(result.content).toBe('r2 content');
          expect(result.debugInfo?.source).toBe('r2-bucket');
          expect(calls).toEqual([`${R2_BASE_URL}/repos/${OWNER}/${REPO}/${BRANCH}/top/main.c`]);
        }
      )
    );
  });

  test('does not emit console errors when an R2 file fetch fails', async () => {
    const originalConsoleError = console.error;
    const consoleErrors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };

    try {
      await withR2BaseUrl(() =>
        withMockedFetch(
          () => {
            throw new TypeError('Failed to fetch');
          },
          async () => {
            await expect(
              fetchRepositoryFile(OWNER, REPO, BRANCH, 'top/main.c', {
                sourceMode: 'r2-bucket',
              })
            ).rejects.toThrow(`Failed to load "top/main.c" from r2-bucket`);
          }
        )
      );

      expect(consoleErrors).toEqual([]);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('keeps manifest cache entries separated by source mode', async () => {
    const branch = `${BRANCH}-manifest-cache`;

    await withR2BaseUrl(() =>
      withMockedFetch(
        (url) => {
          const fileName = url.startsWith(R2_BASE_URL) ? 'r2.c' : 'local.c';
          return new Response(
            JSON.stringify({
              tree: [{ name: fileName, type: 'f' }],
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            }
          );
        },
        async (calls) => {
          const localTree = await getTreeStructureFromStatic(OWNER, REPO, branch, {
            sourceMode: 'local-filesystem',
          });
          const r2Tree = await getTreeStructureFromStatic(OWNER, REPO, branch, {
            sourceMode: 'r2-bucket',
          });

          expect(localTree?.[0]?.path).toBe('local.c');
          expect(r2Tree?.[0]?.path).toBe('r2.c');
          expect(calls).toEqual([
            `/repos/${OWNER}/${REPO}/${branch}/repo-manifest.json`,
            `${R2_BASE_URL}/repos/${OWNER}/${REPO}/${branch}/repo-manifest.json`,
          ]);
        }
      )
    );
  });

  test('falls back from repo-manifest.json to .repo-manifest.json in local mode', async () => {
    const branch = `${BRANCH}-local-manifest-fallback`;

    await withMockedFetch(
      (url) => {
        if (url.endsWith('/repo-manifest.json')) {
          return new Response('not found', { status: 404 });
        }
        if (url.endsWith('/.repo-manifest.json')) {
          return new Response(JSON.stringify({ tree: [{ name: 'legacy-local.c', type: 'f' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
        return new Response('wrong source', { status: 500 });
      },
      async (calls) => {
        const tree = await getTreeStructureFromStatic(OWNER, REPO, branch, {
          sourceMode: 'local-filesystem',
        });

        expect(tree?.[0]?.path).toBe('legacy-local.c');
        expect(calls).toEqual([
          `/repos/${OWNER}/${REPO}/${branch}/repo-manifest.json`,
          `/repos/${OWNER}/${REPO}/${branch}/.repo-manifest.json`,
        ]);
      }
    );
  });

  test('falls back from repo-manifest.json to .repo-manifest.json in R2 mode', async () => {
    const branch = `${BRANCH}-r2-manifest-fallback`;

    await withR2BaseUrl(() =>
      withMockedFetch(
        (url) => {
          if (url.endsWith('/repo-manifest.json')) {
            return new Response('not found', { status: 404 });
          }
          if (url.endsWith('/.repo-manifest.json')) {
            return new Response(JSON.stringify({ tree: [{ name: 'legacy-r2.c', type: 'f' }] }), {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            });
          }
          return new Response('wrong source', { status: 500 });
        },
        async (calls) => {
          const tree = await getTreeStructureFromStatic(OWNER, REPO, branch, {
            sourceMode: 'r2-bucket',
          });

          expect(tree?.[0]?.path).toBe('legacy-r2.c');
          expect(calls).toEqual([
            `${R2_BASE_URL}/repos/${OWNER}/${REPO}/${branch}/repo-manifest.json`,
            `${R2_BASE_URL}/repos/${OWNER}/${REPO}/${branch}/.repo-manifest.json`,
          ]);
        }
      )
    );
  });

  test('uses valid browser Cache API keys for source-scoped code indexes', () => {
    return withR2BaseUrl(() => {
      const localCacheKey = buildCodeIndexBrowserCacheKey(
        OWNER,
        REPO,
        BRANCH,
        'local-filesystem',
        'http://localhost:8000'
      );
      const r2CacheKey = buildCodeIndexBrowserCacheKey(
        OWNER,
        REPO,
        BRANCH,
        'r2-bucket',
        'http://localhost:8000'
      );

      expect(new URL(localCacheKey).protocol).toBe('http:');
      expect(new URL(r2CacheKey).protocol).toBe('https:');
      expect(localCacheKey).toBe(
        `http://localhost:8000/repos/${OWNER}/${REPO}/${BRANCH}/code-index.sqlite?__explorar_source=local-filesystem`
      );
      expect(r2CacheKey).toBe(
        `${R2_BASE_URL}/repos/${OWNER}/${REPO}/${BRANCH}/code-index.sqlite?__explorar_source=r2-bucket`
      );
    });
  });
});
