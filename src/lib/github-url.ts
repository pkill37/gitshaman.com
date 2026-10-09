/**
 * The deliberately small URL contract behind GitShaman's URL-hacking UX:
 * replace github.com with gitshaman.com and keep the repository path.
 */
export interface GitHubUrlTarget {
  owner: string;
  repo: string;
  branch?: string;
  filePath?: string;
  targetType?: 'file' | 'directory';
  line?: number;
}

function decodePathSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded && decoded !== '.' && decoded !== '..' ? decoded : null;
  } catch {
    return null;
  }
}

export function parseGitHubRepositoryPath(pathname: string): GitHubUrlTarget | null {
  const segments = pathname.split('/').filter(Boolean).map(decodePathSegment);
  if (segments.some((segment) => !segment)) {
    return null;
  }

  const [owner, repo, mode, ...path] = segments as string[];
  if (!owner || !repo || owner === 'settings' || owner === 'new') {
    return null;
  }

  if (!mode) {
    return { owner, repo };
  }

  if (mode !== 'tree' && mode !== 'blob') {
    return null;
  }

  if (path.length === 0) {
    return null;
  }

  // Keep URL handling deterministic: arbitrary refs are a single path
  // segment (commit SHAs, tags, and simple branch names). More complex refs
  // can be supplied explicitly with ?ref=...
  const branch = path[0];
  const rest = path.slice(1);
  const target: GitHubUrlTarget = {
    owner,
    repo,
    branch,
    ...(mode === 'tree' ? { targetType: 'directory' as const } : {}),
  };
  if (rest.length > 0) {
    target.filePath = rest.join('/');
  }

  return target;
}

function getGitHubUrlParts(
  input: string | URL
): { source: URL; owner: string; repo: string; mode?: string; path: string[] } | null {
  let source: URL;
  try {
    source = typeof input === 'string' ? new URL(input) : input;
  } catch {
    return null;
  }
  if (source.hostname !== 'github.com' && source.hostname !== 'www.github.com') return null;
  const segments = source.pathname.split('/').filter(Boolean).map(decodePathSegment);
  if (segments.some((segment) => !segment)) return null;
  const [owner, repo, mode, ...path] = segments as string[];
  if (!owner || !repo || owner === 'settings' || owner === 'new') return null;
  return { source, owner, repo, mode, path };
}

function buildGitShamanUrl(source: URL, target: GitHubUrlTarget): string {
  const result = new URL(`https://gitshaman.com/${target.owner}/${target.repo}`);
  if (target.branch) result.searchParams.set('ref', target.branch);
  if (target.branch && target.filePath) {
    result.searchParams.set(target.targetType === 'directory' ? 'dir' : 'file', target.filePath);
  }
  if (target.branch && source.hash.match(/^#L(\d+)(?:-L\d+)?$/)) {
    result.searchParams.set('line', source.hash.slice(2).split('-')[0]);
  }
  for (const [key, value] of source.searchParams) result.searchParams.set(key, value);
  return result.toString();
}

export function parseGitHubUrl(input: string | URL): GitHubUrlTarget | null {
  const parts = getGitHubUrlParts(input);
  if (!parts) return null;
  const target = parseGitHubRepositoryPath(parts.source.pathname);
  if (!target) return null;
  const lineMatch = parts.source.hash.match(/^#L(\d+)(?:-L\d+)?$/);
  const explicitRef = parts.source.searchParams.get('ref')?.trim();
  if (explicitRef && parts.mode && parts.path.length > 0) {
    const refParts = explicitRef.split('/');
    if (parts.path.slice(0, refParts.length).join('/') === explicitRef) {
      const focusPath = parts.path.slice(refParts.length).join('/');
      return {
        owner: parts.owner,
        repo: parts.repo,
        branch: explicitRef,
        filePath: focusPath || undefined,
        ...(parts.mode === 'tree' ? { targetType: 'directory' as const } : {}),
        ...(lineMatch ? { line: Number(lineMatch[1]) } : {}),
      };
    }
  }
  return lineMatch ? { ...target, line: Number(lineMatch[1]) } : target;
}

export function githubUrlToGitShamanUrl(input: string | URL): string | null {
  const parts = getGitHubUrlParts(input);
  const target = parseGitHubUrl(input);
  return parts && target ? buildGitShamanUrl(parts.source, target) : null;
}

/** Resolve either a repository route or the static host's homepage fallback. */
export function resolveRepositoryNavigation(
  pathname: string,
  search: string,
  hash = ''
): GitHubUrlTarget | null {
  const params = new URLSearchParams(search);
  const fallbackPath = params.get('github_path');
  params.delete('github_path');

  let url: URL;
  try {
    url = new URL(fallbackPath || pathname, 'https://github.com');
  } catch {
    return null;
  }
  for (const [key, value] of params) url.searchParams.set(key, value);
  if (hash) url.hash = hash;

  const target = parseGitHubUrl(url);
  if (!target) return null;

  const directory = url.searchParams.get('dir');
  const file = url.searchParams.get('file');
  return {
    ...target,
    branch: url.searchParams.get('ref') || target.branch,
    filePath: directory || file || target.filePath,
    targetType: directory ? 'directory' : file ? 'file' : target.targetType,
    line: Number(url.searchParams.get('line')) || target.line,
  };
}
