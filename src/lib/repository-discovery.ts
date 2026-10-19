import { downloadDirectoryContents } from './github-archive';
import { fetchRepositoryFile } from './github-api';
import { getDirectoryMetadata, getGitHubRepoIdentifier, type FileEntry } from './repo-storage';

export interface RepositoryDiscovery {
  entries: FileEntry[];
  readme?: { path: string; content: string };
  description?: string;
  scripts: Array<{ name: string; command: string; path: string }>;
  packages: string[];
  warnings: string[];
}

export function workspacePatterns(manifest: Record<string, unknown>): string[] {
  const workspaces = manifest.workspaces;
  const patterns = Array.isArray(workspaces)
    ? workspaces
    : workspaces && typeof workspaces === 'object' && 'packages' in workspaces
      ? workspaces.packages
      : [];
  return Array.isArray(patterns)
    ? patterns.filter(
        (value): value is string =>
          typeof value === 'string' &&
          /^(?:[\w@.-]+\/)*[\w@.*-]+$/.test(value) &&
          !value.split('/').includes('..')
      )
    : [];
}

export function discoveryRole(entry: FileEntry): string {
  if (/^readme(?:\.|$)/i.test(entry.name)) return 'Project introduction and setup instructions';
  if (/^(contributing|hacking)(?:\.|$)/i.test(entry.name)) return 'Contribution instructions';
  if (/^(test|tests|__tests__|spec|specs)$/i.test(entry.name))
    return 'Tests: start here to see expected behavior';
  if (/^(docs?|documentation)$/i.test(entry.name)) return 'Project documentation';
  if (/^(examples?|samples?|demos?)$/i.test(entry.name)) return 'Usage examples';
  if (/^(src|lib|app|cmd|internal)$/i.test(entry.name)) return 'Likely implementation directory';
  if (/^(package.json|Cargo.toml|go.mod|pyproject.toml|Makefile|CMakeLists.txt)$/i.test(entry.name))
    return 'Dependencies and build configuration';
  return entry.type === 'directory' ? 'Explore directory contents' : 'Repository file';
}

export async function discoverRepository(
  owner: string,
  repo: string,
  revision: string,
  scope: string,
  signal: AbortSignal,
  onEntries: (entries: FileEntry[]) => void
): Promise<RepositoryDiscovery> {
  const directory = async (path: string) => {
    signal.throwIfAborted();
    const cached = await getDirectoryMetadata(
      'github',
      getGitHubRepoIdentifier(owner, repo),
      revision,
      path
    );
    signal.throwIfAborted();
    return cached ?? downloadDirectoryContents(owner, repo, revision, path, undefined, signal);
  };
  const entries = await directory(scope);
  signal.throwIfAborted();
  onEntries(entries);
  const result: RepositoryDiscovery = { entries, scripts: [], packages: [], warnings: [] };
  const readme = entries.find(
    (entry) => entry.type === 'file' && /^readme(?:\.(md|markdown|rst|txt))?$/i.test(entry.name)
  );
  const manifest = entries.find((entry) => entry.name === 'package.json' && entry.type === 'file');
  await Promise.all(
    [readme, manifest].map(async (entry) => {
      if (!entry) return;
      try {
        if ((entry.size ?? 0) > 256_000) throw new Error('File exceeds guide preview limit');
        const { content } = await fetchRepositoryFile(owner, repo, revision, entry.path, {
          signal,
        });
        signal.throwIfAborted();
        if (entry === readme)
          result.readme = { path: entry.path, content: content.slice(0, 12000) };
        else {
          const json = JSON.parse(content) as Record<string, unknown>;
          if (!json || typeof json !== 'object') throw new Error('Invalid manifest');
          if (typeof json.description === 'string') result.description = json.description;
          if (json.scripts && typeof json.scripts === 'object') {
            result.scripts = Object.entries(json.scripts)
              .filter((pair): pair is [string, string] => typeof pair[1] === 'string')
              .map(([name, command]) => ({ name, command, path: entry.path }));
          }
          // Expand only one-level workspace globs; never crawl an entire repository.
          for (const pattern of workspacePatterns(json).slice(0, 8)) {
            if (pattern.includes('*') && !pattern.endsWith('/*')) continue;
            if (pattern.slice(0, -1).includes('*')) continue;
            const path = [scope, pattern.replace(/\/\*$/, '')].filter(Boolean).join('/');
            if (pattern.endsWith('/*')) {
              try {
                const children = await directory(path);
                result.packages.push(
                  ...children
                    .filter((child) => child.type === 'directory')
                    .map((child) => child.path)
                );
              } catch (error) {
                signal.throwIfAborted();
                result.warnings.push(
                  `Could not discover workspace ${pattern}: ${error instanceof Error ? error.message : 'request failed'}`
                );
              }
            } else if (entries.some((item) => item.path === path && item.type === 'directory'))
              result.packages.push(path);
          }
        }
      } catch (error) {
        signal.throwIfAborted();
        result.warnings.push(
          `Could not read ${entry.path}: ${error instanceof Error ? error.message : 'request failed'}`
        );
      }
    })
  );
  result.packages = [...new Set(result.packages)].slice(0, 100);
  return result;
}
