import { getCuratedRepoPath } from './curated-repos';

export const REPOSITORY_HISTORY_KEY = 'gitshaman:repository-history:v1';

export interface RepositoryVisit {
  id: string;
  owner: string;
  repo: string;
  href: string;
  file: string;
  branch: string;
}

/** History URLs are always rebuilt locally, including when loading stored data. */
export function createRepositoryVisit(
  owner: string,
  repo: string,
  file: string,
  branch: string,
  search: string
): RepositoryVisit {
  const params = new URLSearchParams(search);
  params.delete('github_path');
  if (file) {
    if (params.get('file') !== file) {
      params.delete('line');
      params.delete('search');
    }
    params.delete('dir');
    params.set('file', file);
  }
  if (branch) params.set('ref', branch);
  const query = params.toString();
  return {
    id: '',
    owner,
    repo,
    file,
    branch,
    href: `${getCuratedRepoPath(owner, repo)}${query ? `?${query}` : ''}`,
  };
}

export function readRepositoryHistory(raw: string | null): RepositoryVisit[] {
  try {
    const visits: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(visits)) return [];
    return visits.filter((visit): visit is RepositoryVisit => {
      if (!visit || typeof visit !== 'object') return false;
      const entry = visit as RepositoryVisit;
      return (
        typeof entry.id === 'string' &&
        typeof entry.owner === 'string' &&
        /^[\w.-]+$/.test(entry.owner) &&
        typeof entry.repo === 'string' &&
        /^[\w.-]+$/.test(entry.repo) &&
        typeof entry.file === 'string' &&
        typeof entry.branch === 'string' &&
        typeof entry.href === 'string' &&
        entry.href.split('?')[0] === getCuratedRepoPath(entry.owner, entry.repo)
      );
    });
  } catch {
    return [];
  }
}

/** Updating a workspace keeps its position; switching repos appends without dropping later visits. */
export function recordRepositoryVisit(
  visits: RepositoryVisit[],
  visit: RepositoryVisit
): RepositoryVisit[] {
  const last = visits.at(-1);
  if (last?.owner === visit.owner && last.repo === visit.repo) {
    if (last.href === visit.href && last.file === visit.file && last.branch === visit.branch)
      return visits;
    return [...visits.slice(0, -1), { ...visit, id: last.id }];
  }
  return [...visits, { ...visit, id: globalThis.crypto.randomUUID() }];
}
