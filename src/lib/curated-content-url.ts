function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  const withoutWrappingQuotes = trimmed.replace(/^['"]+|['"]+$/g, '').trim();
  const extractedUrl = withoutWrappingQuotes.match(/https?:\/\/[^\s'"]+/i)?.[0];
  const normalized = extractedUrl ?? withoutWrappingQuotes;
  return normalized.replace(/\/+$/, '');
}

export type CuratedRepoSourceMode = 'local-filesystem' | 'r2-bucket';

function buildRepoPath(owner: string, repo: string, branch: string, filePath: string): string {
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `/repos/${owner}/${repo}/${branch}/${cleanPath}`;
}

function getConfiguredR2BaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_CURATED_CONTENT_BASE_URL?.trim();
  return baseUrl ? normalizeBaseUrl(baseUrl) : '';
}

function getConfiguredPublicR2BaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL?.trim();
  return baseUrl ? normalizeBaseUrl(baseUrl) : '';
}

export function getR2BucketBaseUrl(): string {
  const configuredBaseUrl = getConfiguredPublicR2BaseUrl();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const legacyConfiguredBaseUrl = getConfiguredR2BaseUrl();
  if (legacyConfiguredBaseUrl) {
    return legacyConfiguredBaseUrl;
  }

  return '';
}

export function hasConfiguredR2BucketBaseUrl(): boolean {
  return getR2BucketBaseUrl().length > 0;
}

export function isLocalFilesystemCorpusAvailable(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function getDefaultCuratedRepoSourceMode(): CuratedRepoSourceMode {
  return isLocalFilesystemCorpusAvailable() ? 'local-filesystem' : 'r2-bucket';
}

export function normalizeCuratedRepoSourceMode(
  sourceMode: CuratedRepoSourceMode
): CuratedRepoSourceMode {
  if (sourceMode === 'local-filesystem' && !isLocalFilesystemCorpusAvailable()) {
    return 'r2-bucket';
  }

  if (sourceMode === 'r2-bucket' && !hasConfiguredR2BucketBaseUrl()) {
    return isLocalFilesystemCorpusAvailable() ? 'local-filesystem' : 'r2-bucket';
  }

  return sourceMode;
}

export function buildCuratedRepoUrl(
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): string {
  const baseUrl = getR2BucketBaseUrl();
  if (!baseUrl) {
    return buildRepoPath(owner, repo, branch, filePath);
  }

  return `${baseUrl}${buildRepoPath(owner, repo, branch, filePath)}`;
}

export function buildCuratedRepoStaticPath(
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): string {
  return buildRepoPath(owner, repo, branch, filePath);
}

export function buildCuratedRepoUrlForSource(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  sourceMode: CuratedRepoSourceMode
): string {
  if (sourceMode === 'local-filesystem') {
    return buildCuratedRepoStaticPath(owner, repo, branch, filePath);
  }

  return buildCuratedRepoUrl(owner, repo, branch, filePath);
}
