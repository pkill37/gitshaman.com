'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  discoverRepository,
  discoveryRole,
  type RepositoryDiscovery,
} from '@/lib/repository-discovery';
import type { GuideSection } from '@/lib/project-guides';

const cache = new Map<string, { time: number; data: RepositoryDiscovery }>();
const linkStyle = {
  color: 'var(--vscode-textLink-foreground, #72b7ff)',
  cursor: 'pointer',
  background: 'none',
  border: 0,
  padding: 0,
  textAlign: 'left' as const,
  overflowWrap: 'anywhere' as const,
};

export function useRepositoryGuide({
  owner,
  repo,
  revision,
  enabled,
  onOpen,
  location = '',
}: {
  owner: string;
  repo: string;
  revision?: string | null;
  enabled: boolean;
  onOpen: (path: string) => void;
  location?: string;
}): GuideSection[] {
  const [selection, setSelection] = useState({ repository: '', scope: '' });
  const repository = `${owner}/${repo}@${revision ?? ''}`;
  const scope = selection.repository === repository ? selection.scope : '';
  const key = JSON.stringify([owner, repo, revision, scope]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data?: RepositoryDiscovery;
    loading: boolean;
    error?: string;
  }>({ key: '', loading: true });

  useEffect(() => {
    if (!enabled || !revision) return;
    const controller = new AbortController();
    const existing = cache.get(key);
    const update = (data?: RepositoryDiscovery, loading = true, error?: string) => {
      if (!controller.signal.aborted) setState({ key, data, loading, error });
    };
    // Defer the initial state update so transitions never expose another repository's guide.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      if (existing && Date.now() - existing.time < 5 * 60_000 && attempt === 0) {
        update(existing.data, false);
        return;
      }
      let partial: RepositoryDiscovery | undefined;
      update();
      try {
        const data = await discoverRepository(
          owner,
          repo,
          revision,
          scope,
          controller.signal,
          (entries) => {
            partial = { entries, scripts: [], packages: [], warnings: [] };
            update(partial);
          }
        );
        if (controller.signal.aborted) return;
        if (cache.size >= 30) cache.delete(cache.keys().next().value!);
        if (!data.warnings.length) cache.set(key, { time: Date.now(), data });
        update(data, false);
      } catch (error) {
        if (!controller.signal.aborted)
          update(
            partial,
            false,
            error instanceof Error ? error.message : 'Unable to load repository guide'
          );
      }
    });
    return () => controller.abort();
  }, [enabled, owner, repo, revision, scope, key, attempt]);

  return useMemo(() => {
    const data = state.key === key ? state.data : undefined;
    const loading = state.key !== key || state.loading;
    const error = state.key === key ? state.error : undefined;
    const entries = data?.entries ?? [];
    const open = (path: string, label = path) => (
      <button type="button" style={linkStyle} onClick={() => onOpen(path)}>
        {label}
      </button>
    );
    const list = (items: typeof entries) => (
      <ul style={{ paddingLeft: 18 }}>
        {items.map((entry) => (
          <li key={entry.path} style={{ marginBottom: 10 }}>
            {open(entry.path + (entry.type === 'directory' ? '/' : ''), entry.name)}
            <div>{discoveryRole(entry)}</div>
          </li>
        ))}
      </ul>
    );
    const docs = entries.filter((entry) =>
      /^(readme|contributing|hacking|docs?|documentation|examples?|samples?)(\.|$)/i.test(
        entry.name
      )
    );
    const reading = [
      ...docs.filter((entry) => /^readme/i.test(entry.name)),
      ...entries.filter((entry) =>
        /^(src|lib|app|cmd|internal|tests?|examples?|package.json|Cargo.toml|go.mod|pyproject.toml|Makefile)$/i.test(
          entry.name
        )
      ),
    ].slice(0, 10);
    const contextDirectory = location.replace(/\/$/, '').split('/').slice(0, -1).join('/');
    const context = contextDirectory && contextDirectory !== scope ? contextDirectory : '';
    const section = (
      id: string,
      title: string,
      body: React.ReactNode,
      paths: string[] = []
    ): GuideSection => ({
      id: `repository-${id}`,
      title,
      body: <div style={{ fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' }}>{body}</div>,
      narrativePaths: paths,
    });
    return [
      section(
        'overview',
        'Repository overview',
        <>
          <h3>
            {owner}/{repo}
          </h3>
          <p>{revision ? `Revision: ${revision}` : 'Resolving repository revision…'}</p>
          <p>Source-backed orientation from {scope || 'the repository root'}.</p>
          {scope && (
            <p>
              <button type="button" onClick={() => setSelection({ repository, scope: '' })}>
                Back to repository overview
              </button>
            </p>
          )}
          {loading && <p role="status">Loading repository guidance…</p>}
          {error && <p role="alert">{error}</p>}
          {data?.warnings.map((warning) => (
            <p key={warning} role="status">
              {warning}
            </p>
          ))}
          {(error || !!data?.warnings.length) && (
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              Retry guide loading
            </button>
          )}
          {data?.description && <p>{data.description}</p>}
          {data?.readme ? (
            <>
              <p>{open(data.readme.path, 'Open full README')}</p>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  font: 'inherit',
                  maxHeight: 360,
                  overflow: 'auto',
                }}
              >
                {data.readme.content.slice(0, 4000)}
              </pre>
            </>
          ) : (
            !loading && (
              <p>
                No README was discovered here. Start with the source map and configuration files.
              </p>
            )
          )}
          {!!data?.packages.length && (
            <label>
              Explore a workspace
              <select
                aria-label="Explore a workspace"
                value=""
                style={{ width: '100%' }}
                onChange={(event) => setSelection({ repository, scope: event.target.value })}
              >
                <option value="">Choose a package</option>
                {data.packages.map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
              </select>
            </label>
          )}
          {context && (
            <p>
              <button type="button" onClick={() => setSelection({ repository, scope: context })}>
                Guide to current directory: {context}
              </button>
            </p>
          )}
        </>
      ),
      section(
        'map',
        'Source map',
        <>
          <p>
            Directories and configuration at {scope || 'the root'}. Descriptions based on naming are
            starting points for exploration.
          </p>
          {list(entries.slice(0, 100))}
          {entries.length > 100 && (
            <p>Showing the first 100 entries. Use the explorer for the full listing.</p>
          )}
        </>,
        entries.map((entry) => entry.path)
      ),
      section(
        'reading',
        'Start reading',
        <>
          <p>Read the introduction, then explore implementation, examples, and tests.</p>
          {reading.length ? (
            list(reading)
          ) : (
            <p>Use the source map to choose a directory and inspect its files.</p>
          )}
        </>,
        reading.map((entry) => entry.path)
      ),
      section(
        'commands',
        'Build and test',
        <>
          {data?.scripts.length ? (
            <>
              <p>
                Scripts declared in {open(data.scripts[0].path)}. Run them with the package manager
                specified by the project, from {scope || 'the repository root'}.
              </p>
              {data.scripts.map((script) => (
                <div key={script.name}>
                  <strong>{script.name}</strong>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{script.command}</pre>
                </div>
              ))}
            </>
          ) : (
            <p>
              No package scripts were discovered. Consult the README and build configuration for
              supported commands.
            </p>
          )}
          {list(
            entries.filter((entry) =>
              /^(Makefile|CMakeLists.txt|Cargo.toml|go.mod|pyproject.toml|pom.xml|build.gradle)$/i.test(
                entry.name
              )
            )
          )}
        </>
      ),
      section(
        'docs',
        'Documentation and examples',
        docs.length ? (
          list(docs)
        ) : (
          <p>
            No documentation was discovered in this directory. Explore another directory using the
            source map.
          </p>
        ),
        docs.map((entry) => entry.path)
      ),
    ];
  }, [state, key, owner, repo, revision, scope, repository, onOpen, location]);
}
