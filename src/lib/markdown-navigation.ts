import { getCuratedRepoAccent, isCuratedRepo } from './curated-repos';

export interface RepoNavigationTarget {
  path: string;
  owner?: string;
  repo?: string;
  searchPattern?: string;
  scrollToLine?: number;
}

export type MarkdownNavigationTarget = { kind: 'repo-file' } & RepoNavigationTarget;

interface ParseRepoNavigationTargetOptions {
  linkText?: string;
  title?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function hasUnsafeScheme(href: string): boolean {
  return /^(javascript|data|vbscript):/i.test(href.trim());
}

export function isExternalHref(href: string): boolean {
  return /^(https?:)?\/\//i.test(href.trim());
}

export function resolveRepoRelativePath(currentFilePath: string, href: string): string | null {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith('#') || isExternalHref(trimmedHref)) {
    return null;
  }

  const withoutHash = trimmedHref.split('#')[0] || '';
  if (!withoutHash) {
    return null;
  }

  const currentDirParts = currentFilePath.split('/').slice(0, -1);
  const targetParts = withoutHash.split('/');
  const resolvedParts = trimmedHref.startsWith('/') ? [] : [...currentDirParts];

  for (const part of targetParts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (resolvedParts.length > 0) {
        resolvedParts.pop();
      }
      continue;
    }
    resolvedParts.push(part);
  }

  return resolvedParts.join('/');
}

function normalizeSearchPattern(pattern: string): string {
  return pattern.replace(/\(\)$/, '');
}

function decodeNavigationSuffix(suffix: string): string {
  const stripped = suffix.trim().replace(/^#/, '');
  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
}

function applyNavigationSuffix(
  target: RepoNavigationTarget,
  rawSuffix: string
): RepoNavigationTarget {
  const suffix = decodeNavigationSuffix(rawSuffix);
  if (!suffix) {
    return target;
  }

  const lineMatch = suffix.match(/^(?:L|line-)?(\d+)(?:[-:](?:L)?\d+)?$/i);
  if (lineMatch) {
    target.scrollToLine = parseInt(lineMatch[1], 10);
    return target;
  }

  const normalizedPattern = normalizeSearchPattern(suffix);
  if (/^[A-Za-z_][A-Za-z0-9_:.<>\-~]*$/.test(normalizedPattern)) {
    target.searchPattern = normalizedPattern;
  }

  return target;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}

function inferSearchPatternFromText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const stripped = decodeHtmlEntities(stripHtml(value)).trim();
  if (!stripped || stripped.length > 160) {
    return undefined;
  }

  const functionMatch = stripped.match(/\b([A-Za-z_][A-Za-z0-9_:.<>~]*)(?:\s*\([^)]*\)|\(\))/);
  if (functionMatch) {
    return normalizeSearchPattern(functionMatch[1]);
  }

  const leadingPhrase = stripped.split(/[—–:]/)[0]?.trim() || '';
  if (/^(?:struct|class|enum)\s+[A-Za-z_][A-Za-z0-9_:.<>~]*$/.test(leadingPhrase)) {
    return normalizeSearchPattern(leadingPhrase);
  }
  if (/^[A-Za-z_][A-Za-z0-9_:.<>~]{2,}$/.test(leadingPhrase)) {
    return normalizeSearchPattern(leadingPhrase);
  }

  if (/<code\b/i.test(value)) {
    const symbolMatch = stripped.match(/\b([A-Za-z_][A-Za-z0-9_:.<>~]{2,})\b/);
    if (symbolMatch) {
      return normalizeSearchPattern(symbolMatch[1]);
    }
  }

  return undefined;
}

function looksLikeRepoPath(path: string): boolean {
  if (!path || /\s/.test(path) || isExternalHref(path)) {
    return false;
  }

  const normalized = path.replace(/^\/+/, '');
  if (/^[A-Za-z0-9._+-]+\/$/.test(normalized)) {
    return true;
  }

  if (/^[A-Za-z0-9._+-]+\.[A-Za-z0-9._+-]+$/.test(normalized)) {
    return true;
  }

  if (!normalized.includes('/')) {
    return false;
  }

  return normalized
    .split('/')
    .filter(Boolean)
    .every((segment) => /^[A-Za-z0-9._+-]+$/.test(segment));
}

export function parseRepoNavigationTarget(
  rawValue: string,
  currentFilePath?: string,
  options: ParseRepoNavigationTargetOptions = {}
): RepoNavigationTarget | null {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.length > 200) {
    return null;
  }

  if (/^repo:/i.test(trimmed)) {
    const scopedValue = trimmed.slice(trimmed.indexOf(':') + 1);
    const [owner = '', repo = '', ...pathParts] = scopedValue.split('/');
    const scopedPath = pathParts.join('/');
    if (!owner || !repo || !scopedPath || !isCuratedRepo(owner, repo)) {
      return null;
    }

    const target = parseRepoNavigationTarget(scopedPath, undefined, options);
    return target ? { ...target, owner, repo } : null;
  }

  const hashIndex = trimmed.indexOf('#');
  const hashSuffix = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : '';
  const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const lastSlash = withoutHash.lastIndexOf('/');
  const navigationColon = withoutHash.indexOf(':', lastSlash + 1);

  let pathPart = withoutHash;
  let suffix = '';

  if (navigationColon > lastSlash) {
    pathPart = withoutHash.slice(0, navigationColon);
    suffix = withoutHash.slice(navigationColon + 1);
  }

  const resolvedPath =
    !pathPart && currentFilePath
      ? currentFilePath
      : currentFilePath
        ? (resolveRepoRelativePath(currentFilePath, pathPart) ?? pathPart.replace(/^\/+/, ''))
        : pathPart.replace(/^\/+/, '');

  if (!looksLikeRepoPath(resolvedPath)) {
    return null;
  }

  const target: RepoNavigationTarget = { path: resolvedPath };

  if (suffix) {
    return applyNavigationSuffix(target, suffix);
  }

  if (hashSuffix) {
    return applyNavigationSuffix(target, hashSuffix);
  }

  const inferredSearchPattern =
    inferSearchPatternFromText(options.title) ?? inferSearchPatternFromText(options.linkText);
  if (inferredSearchPattern) {
    target.searchPattern = inferredSearchPattern;
  }

  return target;
}

export function parseMarkdownNavigationTarget(
  rawValue: string,
  currentFilePath?: string,
  options: ParseRepoNavigationTargetOptions = {}
): MarkdownNavigationTarget | null {
  const repoTarget = parseRepoNavigationTarget(rawValue, currentFilePath, options);
  return repoTarget ? { kind: 'repo-file', ...repoTarget } : null;
}

export function getRepoLinkAttributes(target: RepoNavigationTarget): string {
  const attributes = [`data-repo-path="${escapeHtml(target.path)}"`];

  if (target.owner && target.repo) {
    attributes.push(`data-repo-owner="${escapeHtml(target.owner)}"`);
    attributes.push(`data-repo-name="${escapeHtml(target.repo)}"`);
    attributes.push(`style="--repo-accent: ${getCuratedRepoAccent(target.owner, target.repo)}"`);
  }

  if (target.searchPattern) {
    attributes.push(`data-search-pattern="${escapeHtml(target.searchPattern)}"`);
  }

  if (typeof target.scrollToLine === 'number') {
    attributes.push(`data-scroll-to-line="${target.scrollToLine}"`);
  }

  return attributes.join(' ');
}

/** Cross-repository references carry an explicit owner/repository target. */
export function isExternalRepoReference(target: RepoNavigationTarget): boolean {
  return Boolean(target.owner && target.repo);
}

export function getExternalRepoIconHtml(target: RepoNavigationTarget): string {
  if (!isExternalRepoReference(target)) {
    return '';
  }

  return `<svg class="external-repo-reference-icon" aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M9.5 2H14v4.5M13.5 2.5 8 8m2-6H4.5A1.5 1.5 0 0 0 3 3.5v8A1.5 1.5 0 0 0 4.5 13h8a1.5 1.5 0 0 0 1.5-1.5V8" /></svg>`;
}
