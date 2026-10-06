import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import matter from 'gray-matter';
import { fetchRepositoryFile } from '../src/lib/github-api';
import { getCuratedRepo } from '../src/lib/curated-repos';
import {
  checkGuide,
  parseSections,
  resolveRepoPath,
  stripNavigationSuffix,
  stripFencedBlocks,
} from '../scripts/check-guide-refs';
import { DOCS_DIR, isGuideMarkdownFile, listGuideMarkdownFiles } from '../scripts/guide-docs';
import { generateGuideRegistrySource } from '../scripts/generate-guide-registry';
import { CORPUS_REPOS_DIR } from '../scripts/static-asset-paths';
import {
  parseSectionIds,
  validateChapterGraph,
  validateGuideMarkdown,
} from '../scripts/validate-guides';
import { getExternalRepoIconHtml, parseRepoNavigationTarget } from '../src/lib/markdown-navigation';
import { resolveCorpusPathFromKnownFiles } from '../src/lib/repo-static';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function looksLikeRepoPath(ref: string): boolean {
  if (!ref || ref.includes('://') || ref.startsWith('#') || ref.startsWith('/')) return false;
  return ref.includes('/') || /\.[A-Za-z0-9]+$/.test(ref) || ref.endsWith('/');
}

function extractInlineRefs(prose: string): string[] {
  const refs = new Set<string>();
  const MD_LINK_RE = /\[(?:[^\]]*)\]\(([\w./\-@:]+)\)/g;
  const BACKTICK_RE = /`([^`\n]+)`/g;

  for (const line of stripFencedBlocks(prose).split('\n')) {
    for (const match of line.matchAll(MD_LINK_RE)) {
      const ref = match[1];
      if (looksLikeRepoPath(ref)) {
        refs.add(ref);
      }
    }

    for (const match of line.matchAll(BACKTICK_RE)) {
      const ref = match[1].trim();
      if (looksLikeRepoPath(ref)) {
        refs.add(ref);
      }
    }
  }

  return Array.from(refs);
}

function normalizeInlineRef(ref: string): string {
  return stripNavigationSuffix(ref);
}

function resolveInlineRef(repoRoot: string, ref: string): string | null {
  const target = parseRepoNavigationTarget(ref);
  if (target?.owner && target.repo) {
    const curatedRepo = getCuratedRepo(target.owner, target.repo);
    if (!curatedRepo) return null;
    const targetRoot = path.join(
      CORPUS_REPOS_DIR,
      curatedRepo.owner,
      curatedRepo.repo,
      curatedRepo.revision
    );
    if (!fs.existsSync(targetRoot)) return target.path;
    return resolveRepoPath(targetRoot, target.path);
  }

  return resolveRepoPath(repoRoot, normalizeInlineRef(ref));
}

test.describe('guide reference linting', () => {
  test('parses curated cross-repo guide links', () => {
    expect(
      parseRepoNavigationTarget(
        'repo:apple-oss-distributions/xnu/osfmk/kern/task.c:task_create_internal'
      )
    ).toEqual({
      path: 'osfmk/kern/task.c',
      owner: 'apple-oss-distributions',
      repo: 'xnu',
      searchPattern: 'task_create_internal',
    });
    expect(parseRepoNavigationTarget('repo:not-curated/example/kernel.c')).toBeNull();
  });

  test('marks only cross-repository references with an external-link icon', () => {
    const localTarget = parseRepoNavigationTarget('kernel/sched/core.c');
    const externalTarget = parseRepoNavigationTarget(
      'repo:apple-oss-distributions/xnu/osfmk/kern/task.c'
    );

    expect(localTarget).not.toBeNull();
    expect(externalTarget).not.toBeNull();
    expect(getExternalRepoIconHtml(localTarget!)).toBe('');
    expect(getExternalRepoIconHtml(externalTarget!)).toContain('external-repo-reference-icon');
  });

  test('keeps the Linux, glibc, and CPython cross-learning links resolvable', () => {
    const expectedLinks = {
      'torvalds_linux.md': [
        'repo:bminor/glibc/sysdeps/unix/sysv/linux/read.c:__libc_read',
        'repo:bminor/glibc/csu/libc-start.c:__libc_start_main',
      ],
      'bminor_glibc.md': [
        'repo:bminor/glibc/sysdeps/unix/sysv/linux/read.c:__libc_read',
        'repo:torvalds/linux/fs/read_write.c:ksys_write',
        'repo:torvalds/linux/mm/mmap.c:vm_mmap_pgoff',
      ],
      'python_cpython.md': [
        'repo:bminor/glibc/nptl/pthread_create.c:pthread_create',
        'repo:torvalds/linux/kernel/fork.c:kernel_clone',
        'repo:bminor/glibc/malloc/malloc.c:__libc_malloc',
        'repo:torvalds/linux/mm/mmap.c:do_mmap',
        'repo:bminor/glibc/elf/rtld.c:_dl_start',
        'repo:torvalds/linux/fs/exec.c:load_elf_binary',
      ],
    } as const;

    for (const [guideFile, refs] of Object.entries(expectedLinks)) {
      const guide = fs.readFileSync(path.join(DOCS_DIR, guideFile), 'utf8');
      const guideData = matter(guide).data;
      const guideRoot = path.join(
        CORPUS_REPOS_DIR,
        String(guideData.owner),
        String(guideData.repo),
        String(guideData.revision)
      );

      for (const ref of refs) {
        expect(guide, `${guideFile} is missing ${ref}`).toContain(`](${ref})`);
        const target = parseRepoNavigationTarget(ref);
        expect(target).not.toBeNull();
        expect(target?.owner).toBe(ref.slice('repo:'.length).split('/')[0]);
        expect(target?.repo).toBe(ref.slice('repo:'.length).split('/')[1]);
        expect(resolveInlineRef(guideRoot, ref), `unresolved ${ref}`).not.toBeNull();
      }
    }
  });

  test('validates required guide document frontmatter', () => {
    const guide = `---
name: Incomplete Guide
description: Missing repo metadata
---

---
id: ch1
title: Chapter 1
---

Content.
`;

    expect(validateGuideMarkdown(guide).errors).toEqual(
      expect.arrayContaining([
        'missing doc frontmatter: owner',
        'missing doc frontmatter: repo',
        'missing or empty doc frontmatter: defaultOpenIds',
      ])
    );
  });

  test('validates section id, title, and defaultOpenIds coverage', () => {
    const guide = `---
owner: torvalds
repo: linux
defaultOpenIds:
  - missing
---

---
title: Missing ID
---

Content.

---
id: ch2
---

More content.
`;

    expect(validateGuideMarkdown(guide).errors).toEqual(
      expect.arrayContaining([
        'section missing id (title: "Missing ID")',
        'section missing title (id: "ch2")',
        'defaultOpenIds contains "missing" but no section has that id — chapter will never auto-open',
      ])
    );
  });

  test('validates chapter graph syntax and duplicates', () => {
    expect(validateChapterGraph('a.c -> b.c : calls\nbad edge\na.c -> b.c : repeats', 10)).toEqual(
      expect.arrayContaining([
        'line 11: invalid edge syntax (expected "source -> target : label"): bad edge',
        'line 12: duplicate edge: a.c -> b.c',
      ])
    );
    expect(validateChapterGraph('a.c -> a.c : loops', 20)).toEqual([
      'line 20: self-loop: a.c -> a.c',
    ]);

    const guide = `---
owner: torvalds
repo: linux
defaultOpenIds:
  - ch1
---

---
id: ch1
title: Chapter 1
---

\`\`\`chapter-graph
\`\`\`
`;

    expect(validateGuideMarkdown(guide).errors).toContain(
      'chapter-graph block at line 13: empty graph'
    );
  });

  test('section metadata parsing ignores prose and fenced code separators', () => {
    const guideContent = `
Intro text.

\`\`\`md
---
id: not-a-real-section
title: Inside Fence
---
\`\`\`

---
id: ch1
title: Chapter 1
---

Chapter prose.

---

Not section metadata.

---
id: ch2
title: Chapter 2
---

More prose.
`;

    expect(parseSectionIds(guideContent)).toEqual([
      { id: 'ch1', title: 'Chapter 1' },
      { id: 'ch2', title: 'Chapter 2' },
    ]);
  });

  test('all markdown guides satisfy the guide format validator', () => {
    const docFiles = listGuideMarkdownFiles();

    for (const fileName of docFiles) {
      const raw = fs.readFileSync(path.join(DOCS_DIR, fileName), 'utf8');
      const result = validateGuideMarkdown(raw);

      expect(result.errors, `${fileName} guide format errors`).toEqual([]);
      expect(result.sections.length, `${fileName} should contain sections`).toBeGreaterThan(0);
    }
  });

  test('all markdown guide frontmatter matches curated repository config', () => {
    const docFiles = listGuideMarkdownFiles();

    for (const fileName of docFiles) {
      const raw = fs.readFileSync(path.join(DOCS_DIR, fileName), 'utf8');
      const { data } = matter(raw);
      const owner = String(data.owner ?? '');
      const repo = String(data.repo ?? '');
      const curatedRepo = getCuratedRepo(owner, repo);

      expect(curatedRepo, `${fileName} references a curated repo`).not.toBeNull();
      expect(data.curatedRepoId, `${fileName} curatedRepoId`).toBe(curatedRepo?.id);
      expect(data.revision, `${fileName} revision`).toBe(curatedRepo?.revision);
      expect(data.guideId, `${fileName} guideId`).toBe(curatedRepo?.guideId);
    }
  });

  test('resolves bare file names against the downloaded corpus', () => {
    const repoRoot = makeTempDir('explorar-guide-lint-');
    try {
      const filePath = path.join(repoRoot, 'arch/arm64/kernel/entry.S');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, 'entry:\n\tret\n');

      expect(resolveRepoPath(repoRoot, 'entry.S')).toBe('arch/arm64/kernel/entry.S');
      expect(resolveCorpusPathFromKnownFiles('entry.S', ['arch/arm64/kernel/entry.S'])).toBe(
        'arch/arm64/kernel/entry.S'
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('prefers arm64 when a bare file name is ambiguous', () => {
    expect(
      resolveCorpusPathFromKnownFiles('entry.S', [
        'arch/x86/entry/entry.S',
        'arch/arm64/kernel/entry.S',
      ])
    ).toBe('arch/arm64/kernel/entry.S');
  });

  test('fetchRepositoryFile resolves a bare file name through the corpus manifest', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url.includes('repo-manifest.json') || url.includes('.repo-manifest.json')) {
        return new Response(
          JSON.stringify({
            tree: [
              {
                name: 'arch',
                type: 'd',
                children: [
                  {
                    name: 'arm64',
                    type: 'd',
                    children: [
                      {
                        name: 'kernel',
                        type: 'd',
                        children: [{ name: 'entry.S', type: 'f' }],
                      },
                    ],
                  },
                  {
                    name: 'x86',
                    type: 'd',
                    children: [
                      {
                        name: 'entry',
                        type: 'd',
                        children: [{ name: 'entry.S', type: 'f' }],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      }

      if (url.endsWith('/arch/arm64/kernel/entry.S')) {
        return new Response('entry:\n\tret\n', { status: 200 });
      }

      if (url.endsWith('/entry.S')) {
        return new Response('missing', { status: 404 });
      }

      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    try {
      const result = await fetchRepositoryFile('torvalds', 'linux', 'v6.1', 'entry.S');
      expect(result.content).toContain('entry:');
      expect(calls.some((url) => url.endsWith('/entry.S'))).toBeTruthy();
      expect(calls.some((url) => url.endsWith('/arch/arm64/kernel/entry.S'))).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetchRepositoryFile does not fetch the manifest for an exact curated path', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith('/arch/arm64/kernel/entry.S')) {
        return new Response('entry:\n\tret\n', { status: 200 });
      }

      if (url.includes('repo-manifest.json') || url.includes('.repo-manifest.json')) {
        throw new Error(`Unexpected manifest fetch: ${url}`);
      }

      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    try {
      const result = await fetchRepositoryFile(
        'torvalds',
        'linux',
        'v6.1-exact-path',
        'arch/arm64/kernel/entry.S'
      );

      expect(result.content).toContain('entry:');
      expect(calls.some((url) => url.includes('repo-manifest.json'))).toBeFalsy();
      expect(calls.some((url) => url.includes('.repo-manifest.json'))).toBeFalsy();
      expect(calls.some((url) => url.endsWith('/arch/arm64/kernel/entry.S'))).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetchRepositoryFile does not probe directory-like paths', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('unexpected network call', { status: 500 });
    }) as typeof fetch;

    try {
      await expect(
        fetchRepositoryFile('apple-oss-distributions', 'xnu', 'xnu-12377.1.9', 'bsd/')
      ).rejects.toMatchObject({
        status: 404,
      });
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('the Linux guide uses canonical source paths in prose', () => {
    const guidePath = path.join(process.cwd(), 'docs/torvalds_linux.md');
    const guide = fs.readFileSync(guidePath, 'utf8');
    const lines = guide.split('\n');
    const bareRefs = ['fork.c', 'signal.c', 'fair.c', 'core.c', 'rt.c', 'entry.S'];
    for (const ref of bareRefs) {
      const matchingLines = lines.filter((line) => line.includes(ref));
      expect(matchingLines.length).toBeGreaterThan(0);
      expect(matchingLines.every((line) => line.includes('/'))).toBeTruthy();
    }
    expect(guide).toContain('kernel/fork.c');
    expect(guide).toContain('kernel/signal.c');
    expect(guide).toContain('kernel/sched/fair.c');
    expect(guide).toContain('arch/arm64/kernel/entry.S');
  });

  test('the Linux guide distinguishes PID 0, PID 1, and kthreadd', () => {
    const guidePath = path.join(process.cwd(), 'docs/torvalds_linux.md');
    const guide = fs.readFileSync(guidePath, 'utf8');

    expect(guide).toContain('init_task');
    expect(guide).toContain('init_struct_pid');
    expect(guide).toContain('PID 0');
    expect(guide).toContain('PID 1');
    expect(guide).toContain('PID 2');
    expect(guide).toContain('kthreadd');
  });

  test('flags bare file references in guide prose when the corpus does not contain them', () => {
    const repoRoot = makeTempDir('explorar-guide-lint-');
    try {
      const existingFile = path.join(repoRoot, 'arch/arm64/kernel/entry.S');
      fs.mkdirSync(path.dirname(existingFile), { recursive: true });
      fs.writeFileSync(existingFile, 'entry:\n\tret\n');

      const guide = `---
id: linux-kernel-guide
title: Kernel Entry
fileRecommendations:
  source:
    - path: arch/arm64/kernel/entry.S
      description: Real corpus path for syscall entry.
---

The full path exists, but the bare reference \`missing_entry.S\` should still be linted.
The markdown link [missing_entry.S](./missing_entry.S) should also be checked.
---`;

      const sections = parseSections(guide);
      const result = checkGuide(repoRoot, sections);

      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('missing_entry.S'),
          expect.stringContaining('(inline code)'),
          expect.stringContaining('(markdown link)'),
        ])
      );
      expect(
        result.errors.some((error) => error.includes('arch/arm64/kernel/entry.S'))
      ).toBeFalsy();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('resolves guide navigation suffixes against the underlying repo path', () => {
    const repoRoot = makeTempDir('explorar-guide-lint-');
    try {
      const filePath = path.join(repoRoot, 'fs/readdir.c');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, 'SYSCALL_DEFINE3(getdents, unsigned int, fd,\n');

      expect(resolveRepoPath(repoRoot, 'fs/readdir.c:getdents')).toBe('fs/readdir.c');
      expect(resolveRepoPath(repoRoot, 'fs/readdir.c:271')).toBe('fs/readdir.c');
      expect(stripNavigationSuffix('fs/readdir.c:getdents')).toBe('fs/readdir.c');
      expect(stripNavigationSuffix('iokit/Kernel/IOService.cpp:IOService::start')).toBe(
        'iokit/Kernel/IOService.cpp'
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('all inline prose file references resolve to corpus files', () => {
    const docFiles = listGuideMarkdownFiles();
    let checkedDocs = 0;

    for (const fileName of docFiles) {
      const docPath = path.join(DOCS_DIR, fileName);
      const raw = fs.readFileSync(docPath, 'utf8');
      const { data } = matter(raw);
      const owner = String(data.owner ?? '');
      const repo = String(data.repo ?? '');
      const revision = String(data.revision ?? '');
      const repoRoot = path.join(CORPUS_REPOS_DIR, owner, repo, revision);

      if (!fs.existsSync(repoRoot)) {
        continue;
      }
      checkedDocs++;

      const sections = parseSections(raw);
      const inlineRefs = sections.flatMap((section) => extractInlineRefs(section.prose));

      for (const ref of inlineRefs) {
        const normalizedRef = normalizeInlineRef(ref);
        expect(
          resolveInlineRef(repoRoot, normalizedRef),
          `unresolved inline prose ref in ${fileName}: ${ref}`
        ).not.toBeNull();
      }
    }

    expect(
      checkedDocs,
      'expected at least one guide with a downloaded corpus root'
    ).toBeGreaterThan(0);
  });

  test('guide registry generation includes guides and excludes docs helpers', () => {
    const source = generateGuideRegistrySource(
      ['_template.md', 'common.md', 'python_cpython.md', 'README.md'].filter(isGuideMarkdownFile)
    );

    expect(source).toContain('../../../docs/python_cpython.md?raw');
    expect(source).not.toContain('_template.md?raw');
    expect(source).not.toContain('common.md?raw');
    expect(source).not.toContain('README.md?raw');
  });
});
