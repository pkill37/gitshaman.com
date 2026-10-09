import { expect, test } from '@playwright/test';
import {
  githubUrlToGitShamanUrl,
  parseGitHubUrl,
  parseGitHubRepositoryPath,
  resolveRepositoryNavigation,
} from '@/lib/github-url';

test.describe('GitHub URL hacking', () => {
  test('parses repository, tree, and blob URLs', () => {
    expect(parseGitHubRepositoryPath('/torvalds/linux')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
    });
    expect(parseGitHubRepositoryPath('/torvalds/linux/tree/v6.1')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
      branch: 'v6.1',
      targetType: 'directory',
    });
    expect(parseGitHubRepositoryPath('/torvalds/linux/blob/v6.1/kernel/sched/core.c')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
      branch: 'v6.1',
      filePath: 'kernel/sched/core.c',
    });
  });

  test('translates a GitHub blob URL while preserving context', () => {
    expect(
      githubUrlToGitShamanUrl(
        'https://github.com/torvalds/linux/blob/v6.1/kernel/sched/core.c?tab=readme#L42-L48'
      )
    ).toBe(
      'https://gitshaman.com/torvalds/linux?ref=v6.1&file=kernel%2Fsched%2Fcore.c&line=42&tab=readme'
    );
  });

  test('preserves slash-containing refs and tree subpaths', () => {
    expect(
      parseGitHubRepositoryPath('/freebsd/freebsd-src/blob/releng/15.1/sys/kern/kern_exit.c')
    ).toEqual({
      owner: 'freebsd',
      repo: 'freebsd-src',
      branch: 'releng',
      filePath: '15.1/sys/kern/kern_exit.c',
    });
    expect(parseGitHubRepositoryPath('/owner/repo/tree/main/src')).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      filePath: 'src',
      targetType: 'directory',
    });
    expect(githubUrlToGitShamanUrl('https://github.com/owner/repo/tree/main/src')).toBe(
      'https://gitshaman.com/owner/repo?ref=main&dir=src'
    );
  });

  test('accepts an explicit slash-containing ref without probing GitHub', () => {
    expect(
      parseGitHubUrl(
        'https://github.com/owner/repo/blob/feature/foo/src/index.ts?ref=feature/foo#L42'
      )
    ).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'feature/foo',
      filePath: 'src/index.ts',
      line: 42,
    });
  });

  test('rejects non-GitHub and non-repository URLs', () => {
    expect(githubUrlToGitShamanUrl('https://gitlab.com/torvalds/linux')).toBeNull();
    expect(githubUrlToGitShamanUrl('https://github.com/settings/profile')).toBeNull();
  });
});

test('resolves fallback navigation with outer query overrides and line anchors', () => {
  const query = new URLSearchParams({
    github_path: '/owner/repo/blob/main/README.md#L42',
    ref: 'feature/docs',
    file: 'docs/readme.md',
    line: '12',
  });
  expect(resolveRepositoryNavigation('/', query.toString())).toEqual({
    owner: 'owner',
    repo: 'repo',
    branch: 'feature/docs',
    filePath: 'docs/readme.md',
    targetType: 'file',
    line: 12,
  });
  expect(resolveRepositoryNavigation('/', '')).toBeNull();
  expect(resolveRepositoryNavigation('/', 'file=README.md')).toBeNull();
  expect(resolveRepositoryNavigation('/', 'github_path=http%3A%2F%2F%5B')).toBeNull();
  expect(resolveRepositoryNavigation('/owner/repo/blob/main/README.md', '', '#L42')?.line).toBe(42);
  expect(
    resolveRepositoryNavigation(
      '/',
      new URLSearchParams({
        github_path: '/owner/repo/tree/main/src',
      }).toString()
    )?.targetType
  ).toBe('directory');
});

test.describe('runtime navigation targets', () => {
  test('opens root-level blob targets without requiring a workspace index', () => {
    expect(
      resolveRepositoryNavigation(
        '/',
        new URLSearchParams({ github_path: '/owner/repo/blob/main/README.md' }).toString()
      )
    ).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      filePath: 'README.md',
    });
  });

  test('keeps nested file paths and URL context intact', () => {
    const target = resolveRepositoryNavigation(
      '/',
      new URLSearchParams({
        github_path: '/owner/repo/blob/main/src/index.ts',
        ref: 'main',
        line: '27',
      }).toString()
    );
    expect(target?.filePath).toBe('src/index.ts');
    expect(target?.line).toBe(27);
  });

  test('resolves direct paths after client-side navigation', () => {
    expect(resolveRepositoryNavigation('/owner/repo/blob/main/README.md', '')).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      filePath: 'README.md',
    });
    expect(resolveRepositoryNavigation('/', '')).toBeNull();
  });

  test('does not retain a removed fallback target', () => {
    const fallback = new URLSearchParams({
      github_path: '/owner/repo/blob/main/README.md',
    }).toString();
    expect(resolveRepositoryNavigation('/', fallback)?.repo).toBe('repo');
    expect(resolveRepositoryNavigation('/', '')).toBeNull();
  });
});
