import { getCuratedRepoBySlug } from '../src/lib/curated-repos';

interface ManifestNode {
  name: string;
  type: 'f' | 'd';
  children?: ManifestNode[];
}

export interface PagesFunctionContext {
  request: Request;
  params: Record<string, string | string[] | undefined>;
  env: Record<string, string | undefined>;
}

const DEFAULT_R2_BASE_URL = 'https://pub-fed8a8778c5340c9a70aec8e22b8296d.r2.dev';
const SOURCE_PREVIEW_LIMIT = 24_000;

export function getFilePath(params: PagesFunctionContext['params']): string | null {
  const value = params.filePath;
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  if (parts.length === 0 || parts.some((part) => !part || part === '.' || part === '..')) {
    return null;
  }
  const filePath = parts.join('/');
  return filePath.length <= 1024 ? filePath : null;
}

export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function sourceBaseUrl(env: PagesFunctionContext['env']): string {
  return (
    env.R2_PUBLIC_BASE_URL?.trim() ||
    env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL?.trim() ||
    DEFAULT_R2_BASE_URL
  ).replace(/\/+$/, '');
}

function flattenManifest(nodes: ManifestNode[], parentPath = ''): string[] {
  const files: string[] = [];
  for (const node of nodes) {
    const filePath = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.type === 'f') files.push(filePath);
    else if (node.children) files.push(...flattenManifest(node.children, filePath));
  }
  return files;
}

export async function getManifestFiles(
  repoSlug: string,
  env: PagesFunctionContext['env']
): Promise<string[]> {
  const repo = getCuratedRepoBySlug(repoSlug);
  if (!repo) return [];

  try {
    const manifestUrl = `${sourceBaseUrl(env)}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${encodePath(repo.revision)}/repo-manifest.json`;
    const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return [];
    const manifest = (await response.json()) as { tree?: ManifestNode[] };
    return manifest.tree ? flattenManifest(manifest.tree) : [];
  } catch {
    return [];
  }
}

async function fetchPreview(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${SOURCE_PREVIEW_LIMIT - 1}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    return (await response.text()).slice(0, SOURCE_PREVIEW_LIMIT);
  } catch {
    return null;
  }
}

export async function fetchSourcePreview(
  owner: string,
  repo: string,
  revision: string,
  filePath: string,
  env: PagesFunctionContext['env']
): Promise<string | null> {
  const repositoryPath = `${owner}/${repo}/${encodePath(revision)}/${encodePath(filePath)}`;
  const r2Preview = await fetchPreview(`${sourceBaseUrl(env)}/repos/${repositoryPath}`);
  if (r2Preview !== null) return r2Preview;

  return fetchPreview(`https://raw.githubusercontent.com/${repositoryPath}`);
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character
  );
}

export function getSourcePageData(repoSlug: string, filePath: string) {
  const repo = getCuratedRepoBySlug(repoSlug);
  if (!repo) return null;
  return {
    repo,
    fileName: filePath.split('/').pop() ?? filePath,
    canonicalPath: `/${repo.slug}/file/${encodePath(filePath)}/`,
    explorerPath: `/${repo.slug}/?file=${encodeURIComponent(filePath)}`,
  };
}
