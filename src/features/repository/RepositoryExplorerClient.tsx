'use client';

import { useState, useCallback, useMemo, useRef, useEffect, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import RepositoryWorkspaceExplorer, {
  type InitialFileTarget,
} from './components/RepositoryWorkspaceExplorer';
import GuidePanel from './components/GuidePanel';
import RepositoryRightPanel from './components/RepositoryRightPanel';
import StatusBar from './components/StatusBar';
import { getProjectConfig, createGenericGuide } from '@/lib/project-guides';
import { parseGuideMarkdown } from '@/features/guides/parser';
import { debugLog } from '@/lib/browser-debug';
import { useRepository } from '@/contexts/RepositoryContext';
import { getCuratedRepoAccent, getCuratedRepoPath } from '@/lib/curated-repos';
import type { GitHubUrlTarget } from '@/lib/github-url';
import { resolveRepositoryNavigation } from '@/lib/github-url';
import {
  getDefaultCuratedRepoSourceMode,
  hasConfiguredR2BucketBaseUrl,
  isLocalFilesystemCorpusAvailable,
  normalizeCuratedRepoSourceMode,
} from '@/lib/curated-content-url';
import type { CuratedRepoSourceMode } from '@/lib/repo-static';
import '@/app/vscode.css';

const GUIDE_DEFAULT_WIDTH = 300;
const GUIDE_MIN_WIDTH = 200;
const GUIDE_MAX_WIDTH = 520;
const GUIDE_COLLAPSED_WIDTH = 44;
const ENTITY_CONTEXT_WIDTH = 420;
const CORPUS_SOURCE_MODE_STORAGE_KEY = 'repository-workspace-explorer-corpus-source-mode';
const GUIDE_SIDEBAR_OPEN_STORAGE_KEY = 'repository-explorer-guide-sidebar-open';
const WORKSPACE_THEME_STORAGE_KEY = 'repository-workspace-explorer-theme';
let navigationNonceCounter = 0;

const EntityView = dynamic(
  () => import('./components/EntityView').then((module) => module.EntityView),
  { loading: () => null }
);

type WorkspaceTheme = 'dark' | 'light';

function createNavigationNonce(): number {
  navigationNonceCounter = (navigationNonceCounter + 1) % Number.MAX_SAFE_INTEGER;
  return Date.now() + navigationNonceCounter / 1000000;
}

interface RepositoryExplorerClientProps {
  owner: string;
  repo: string;
  directTarget?: GitHubUrlTarget;
  guideContent?: string;
  guideDefaultOpenIds?: string[];
  loadingTitle?: string;
  loadingDescription?: string;
}

export default function RepositoryExplorerClient({
  owner,
  repo,
  directTarget,
  guideContent,
  guideDefaultOpenIds,
  loadingTitle: _loadingTitle,
  loadingDescription: _loadingDescription,
}: RepositoryExplorerClientProps) {
  const projectConfig = getProjectConfig(owner, repo);

  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const browserTarget = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return resolveRepositoryNavigation(window.location.pathname, queryString, window.location.hash);
  }, [queryString]);
  const effectiveDirectTarget = directTarget ?? browserTarget ?? undefined;
  // Curated routes always use their seeded revision. Arbitrary routes keep
  // the explicit URL ref and resolve a default branch only when absent.
  const requestedBranch = projectConfig
    ? undefined
    : searchParams.get('ref') || effectiveDirectTarget?.branch;
  const { currentBranch } = useRepository();
  const [mode, setMode] = useState<'editor' | 'search' | 'entities' | 'semantic'>('editor');
  const [fileSourceMode, setFileSourceMode] = useState<CuratedRepoSourceMode>(() => {
    let nextSourceMode = getDefaultCuratedRepoSourceMode();
    try {
      if (typeof window !== 'undefined') {
        const savedSourceMode = localStorage.getItem(CORPUS_SOURCE_MODE_STORAGE_KEY);
        if (savedSourceMode === 'local-filesystem' || savedSourceMode === 'r2-bucket') {
          nextSourceMode = savedSourceMode;
        }
      }
    } catch {
      // Keep the environment default.
    }
    return normalizeCuratedRepoSourceMode(nextSourceMode);
  });
  const [workspaceTheme, setWorkspaceTheme] = useState<WorkspaceTheme>(() => {
    try {
      if (typeof window === 'undefined') return 'dark';
      const savedTheme = localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
      if (savedTheme === 'dark' || savedTheme === 'light') {
        return savedTheme;
      }
    } catch {
      // Keep the default dark workspace.
    }
    return 'dark';
  });
  const [initialFile, setInitialFile] = useState<InitialFileTarget | null>(() => {
    const requestedDirectory = searchParams.get('dir')?.trim();
    const requestedFile = searchParams.get('file')?.trim();
    const filePath = requestedFile || effectiveDirectTarget?.filePath;
    const directoryPath =
      requestedDirectory ||
      (effectiveDirectTarget?.targetType === 'directory'
        ? effectiveDirectTarget.filePath
        : undefined) ||
      (requestedFile?.endsWith('/') ? requestedFile.replace(/\/+$/, '') : undefined);
    if (directoryPath) {
      return {
        kind: 'directory',
        path: directoryPath,
        navigationNonce: createNavigationNonce(),
      };
    }
    if (!filePath) return null;
    const lineValue = searchParams.get('line');
    const parsedLine = lineValue ? parseInt(lineValue, 10) : Number.NaN;
    return {
      path: filePath,
      exactPath: true,
      searchPattern: searchParams.get('search') || undefined,
      scrollToLine: Number.isFinite(parsedLine) ? parsedLine : effectiveDirectTarget?.line,
      navigationNonce: createNavigationNonce(),
    };
  });
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const [isGuideSidebarOpen, setIsGuideSidebarOpen] = useState(() => {
    try {
      if (typeof window === 'undefined') return true;
      const savedGuideSidebarOpen = localStorage.getItem(GUIDE_SIDEBAR_OPEN_STORAGE_KEY);
      if (savedGuideSidebarOpen === 'true' || savedGuideSidebarOpen === 'false') {
        return savedGuideSidebarOpen === 'true';
      }
    } catch {
      // Keep the default visible sidebar.
    }
    return true;
  });
  // Keep EntityView mounted once first activated to preserve per-chapter cache
  const [entitiesMounted, setEntitiesMounted] = useState(false);
  const urlInitialFile = useMemo<InitialFileTarget | null>(() => {
    const requestedFile = searchParams.get('file')?.trim() || effectiveDirectTarget?.filePath;
    if (!requestedFile) return null;
    const lineValue = searchParams.get('line');
    const parsedLine = lineValue ? parseInt(lineValue, 10) : Number.NaN;
    return {
      path: requestedFile,
      exactPath: true,
      searchPattern: searchParams.get('search') || undefined,
      scrollToLine: Number.isFinite(parsedLine) ? parsedLine : effectiveDirectTarget?.line,
      navigationNonce: createNavigationNonce(),
    };
  }, [effectiveDirectTarget?.filePath, effectiveDirectTarget?.line, searchParams]);

  const navigateToRepoTarget = useCallback(
    (
      fileId: string,
      searchPattern?: string,
      scrollToLine?: number,
      repoTarget?: { owner: string; repo: string }
    ) => {
      if (repoTarget && (repoTarget.owner !== owner || repoTarget.repo !== repo)) {
        const params = new URLSearchParams({ file: fileId });
        if (searchPattern) params.set('search', searchPattern);
        if (typeof scrollToLine === 'number') params.set('line', String(scrollToLine));
        try {
          sessionStorage.setItem(
            'explorar:repo-switch-flash',
            JSON.stringify({
              from: `${owner}/${repo}`,
              to: `${repoTarget.owner}/${repoTarget.repo}`,
              ts: Date.now(),
            })
          );
        } catch {
          // Ignore storage failures; the navigation itself still succeeds.
        }
        router.push(`${getCuratedRepoPath(repoTarget.owner, repoTarget.repo)}?${params}`);
        return true;
      }

      return false;
    },
    [owner, repo, router]
  );

  const handleEnterFile = useCallback(
    (
      fileId: string,
      searchPattern?: string,
      scrollToLine?: number,
      searchScope?: string[],
      repoTarget?: { owner: string; repo: string }
    ) => {
      debugLog('[explorar:open-file] guide-request', {
        fileId,
        searchPattern,
        scrollToLine,
        searchScope,
        repoTarget,
      });
      if (navigateToRepoTarget(fileId, searchPattern, scrollToLine, repoTarget)) {
        return;
      }

      // Paired nodes encode both paths as "primary|||header"
      const paths = fileId.includes('|||') ? fileId.split('|||') : null;
      const navigationNonce = createNavigationNonce();
      setInitialFile(
        paths ?? {
          path: fileId,
          searchPattern,
          scrollToLine,
          searchScope,
          navigationNonce,
        }
      );
      setMode('editor');
    },
    [navigateToRepoTarget]
  );

  const handleOpenFileInCurrentMode = useCallback(
    (
      fileId: string,
      searchPattern?: string,
      scrollToLine?: number,
      searchScope?: string[],
      repoTarget?: { owner: string; repo: string }
    ) => {
      debugLog('[explorar:open-file] context-request', {
        fileId,
        searchPattern,
        scrollToLine,
        searchScope,
        repoTarget,
      });
      if (navigateToRepoTarget(fileId, searchPattern, scrollToLine, repoTarget)) {
        return;
      }

      const paths = fileId.includes('|||') ? fileId.split('|||') : null;
      const navigationNonce = createNavigationNonce();
      setInitialFile(
        paths ?? {
          path: fileId,
          searchPattern,
          scrollToLine,
          searchScope,
          navigationNonce,
        }
      );
    },
    [navigateToRepoTarget]
  );

  useEffect(() => {
    const requestedDirectory = searchParams.get('dir')?.trim();
    const requestedFile = searchParams.get('file')?.trim();
    const filePath = requestedFile || effectiveDirectTarget?.filePath;
    const directoryPath =
      requestedDirectory ||
      (effectiveDirectTarget?.targetType === 'directory'
        ? effectiveDirectTarget.filePath
        : undefined) ||
      (requestedFile?.endsWith('/') ? requestedFile.replace(/\/+$/, '') : undefined);
    if (directoryPath) {
      const timeoutId = window.setTimeout(() => {
        setInitialFile({
          kind: 'directory',
          path: directoryPath,
          navigationNonce: createNavigationNonce(),
        });
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
    if (!filePath) {
      return;
    }

    const lineValue = searchParams.get('line');
    const parsedLine = lineValue ? parseInt(lineValue, 10) : Number.NaN;
    const timeoutId = window.setTimeout(() => {
      setInitialFile({
        path: filePath,
        exactPath: true,
        searchPattern: searchParams.get('search') || undefined,
        scrollToLine: Number.isFinite(parsedLine) ? parsedLine : effectiveDirectTarget?.line,
        navigationNonce: createNavigationNonce(),
      });
      setMode('editor');
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    effectiveDirectTarget?.filePath,
    effectiveDirectTarget?.line,
    effectiveDirectTarget?.targetType,
    queryString,
    searchParams,
  ]);

  // ── Guide sections ──────────────────────────────────────────────────────────
  const guideSections = useMemo(() => {
    if (guideContent) {
      try {
        return parseGuideMarkdown(guideContent, handleEnterFile);
      } catch {
        // fall through to generic
      }
    }
    return createGenericGuide(owner, repo);
  }, [guideContent, owner, repo, handleEnterFile]);

  const defaultOpenIds = useMemo(
    () =>
      guideDefaultOpenIds ||
      projectConfig?.guides?.[0]?.defaultOpenIds ||
      (guideSections.length > 0 ? [guideSections[0].id] : []),
    [guideDefaultOpenIds, projectConfig, guideSections]
  );
  const repoLabel = `${owner}/${repo}`;
  const repoAccent = getCuratedRepoAccent(owner, repo);
  const statusBranch = currentBranch || projectConfig?.defaultRevision || requestedBranch || 'main';
  const showDevSourceMode = isLocalFilesystemCorpusAvailable();
  const isR2SourceConfigured = hasConfiguredR2BucketBaseUrl();

  // ── Chapter graph state ─────────────────────────────────────────────────────
  const [activeChapterId, setActiveChapterId] = useState<string | null>(
    () => defaultOpenIds[0] ?? guideSections[0]?.id ?? null
  );
  const chapterMapEntries = useMemo(
    () =>
      guideSections.map((section) => ({
        id: section.id,
        files: section.narrativePaths ?? [],
      })),
    [guideSections]
  );
  const handleSourceModeChange = useCallback((sourceMode: CuratedRepoSourceMode) => {
    const normalizedSourceMode = normalizeCuratedRepoSourceMode(sourceMode);
    setFileSourceMode(normalizedSourceMode);
    try {
      localStorage.setItem(CORPUS_SOURCE_MODE_STORAGE_KEY, normalizedSourceMode);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(GUIDE_SIDEBAR_OPEN_STORAGE_KEY, String(isGuideSidebarOpen));
    } catch {
      // Ignore storage failures.
    }
  }, [isGuideSidebarOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, workspaceTheme);
    } catch {
      // Ignore storage failures.
    }
  }, [workspaceTheme]);

  // ── Guide panel resize ──────────────────────────────────────────────────────
  const [guideWidth, setGuideWidth] = useState(GUIDE_DEFAULT_WIDTH);
  const isResizingGuide = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const pendingClientX = useRef(0);
  const resizeRaf = useRef<number | null>(null);

  const handleGuideResizeStart = useCallback(
    (e: React.MouseEvent) => {
      isResizingGuide.current = true;
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = guideWidth;
      e.preventDefault();
    },
    [guideWidth]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingGuide.current) return;
      // Capture latest X but only schedule one RAF per frame
      pendingClientX.current = e.clientX;
      if (resizeRaf.current !== null) return;
      resizeRaf.current = requestAnimationFrame(() => {
        resizeRaf.current = null;
        const delta = resizeStartX.current - pendingClientX.current;
        const next = Math.min(
          GUIDE_MAX_WIDTH,
          Math.max(GUIDE_MIN_WIDTH, resizeStartWidth.current + delta)
        );
        setGuideWidth(next);
      });
    };
    const onUp = () => {
      isResizingGuide.current = false;
      if (resizeRaf.current !== null) {
        cancelAnimationFrame(resizeRaf.current);
        resizeRaf.current = null;
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <main
      className={`vscode-theme-${workspaceTheme} shaman-workspace-enter`}
      suppressHydrationWarning
      style={
        {
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--vscode-bg-primary)',
          color: 'var(--vscode-text-primary)',
          '--repo-accent': repoAccent,
          '--repo-selection-bg':
            'color-mix(in srgb, var(--repo-accent, var(--vscode-text-accent)) 24%, var(--vscode-bg-primary))',
        } as CSSProperties
      }
    >
      <h1
        suppressHydrationWarning
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {owner}/{repo} Explorer
      </h1>
      {_loadingDescription && (
        <p
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          {_loadingDescription}
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
        {/* ── Activity bar ── */}
        <div
          style={{
            width: 48,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 8,
            padding: '10px 8px',
            borderRight: '1px solid var(--vscode-border)',
            background: 'var(--vscode-bg-secondary)',
          }}
        >
          {[
            {
              id: 'editor',
              title: 'File editor',
              label: '</>',
            },
            {
              id: 'search',
              title: 'File search',
              label: '⌕',
            },
            {
              id: 'entities',
              title: 'Entities',
              label: '{}',
            },
            {
              id: 'semantic',
              title: 'Semantic Graph',
              label: '⌬',
            },
          ].map((tab) => {
            const isActive = mode === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'entities') {
                    setEntitiesMounted(true);
                  }
                  setMode(tab.id as typeof mode);
                }}
                title={tab.title}
                aria-label={tab.title}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  border: '1px solid',
                  borderColor: isActive
                    ? 'var(--repo-accent, var(--vscode-text-accent, #0078d4))'
                    : 'var(--vscode-border)',
                  background: isActive
                    ? 'var(--repo-selection-bg, var(--vscode-bg-selected))'
                    : 'var(--vscode-bg-tertiary)',
                  color: isActive ? 'var(--vscode-text-primary)' : 'var(--vscode-text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'monospace',
                  fontSize: tab.id === 'editor' ? 15 : 21,
                  fontWeight: 700,
                  boxShadow: isActive
                    ? '0 0 0 1px color-mix(in srgb, var(--repo-accent, #0078d4) 25%, transparent)'
                    : 'none',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Main content area ── */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
          {/* Explorer surface — used by both editor and search tabs */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: mode === 'entities' ? ENTITY_CONTEXT_WIDTH : 0,
              opacity: 1,
              pointerEvents: 'auto',
              transition: 'opacity 0.35s ease',
              zIndex: 1,
            }}
          >
            <RepositoryWorkspaceExplorer
              owner={owner}
              repo={repo}
              branch={requestedBranch}
              initialFile={initialFile ?? urlInitialFile}
              hideGuidePanel
              layoutMode={
                mode === 'search'
                  ? 'search'
                  : mode === 'entities'
                    ? 'viewer'
                    : mode === 'semantic'
                      ? 'semantic'
                      : 'editor'
              }
              sourceMode={fileSourceMode}
              workspaceTheme={workspaceTheme}
              workspaceSearchQuery={sidebarSearchQuery}
              onWorkspaceSearchQueryChange={setSidebarSearchQuery}
            />
          </div>

          {/* Entities context — kept mounted to preserve per-chapter cache */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: ENTITY_CONTEXT_WIDTH,
              opacity: mode === 'entities' ? 1 : 0,
              pointerEvents: mode === 'entities' ? 'auto' : 'none',
              transition: 'opacity 0.35s ease',
              zIndex: mode === 'entities' ? 2 : 0,
              borderRight: '1px solid var(--vscode-border)',
              background: 'var(--vscode-bg-primary)',
            }}
          >
            {(mode === 'entities' || entitiesMounted) && (
              <EntityView
                owner={owner}
                repo={repo}
                onOpenFile={handleOpenFileInCurrentMode}
                activeChapterId={activeChapterId}
                chapterMapEntries={chapterMapEntries}
                guideSections={guideSections}
                isActive={mode === 'entities'}
                sourceMode={fileSourceMode}
                searchQuery={sidebarSearchQuery}
                onSearchQueryChange={setSidebarSearchQuery}
              />
            )}
          </div>
        </div>

        {/* ── Guide resize handle ── */}
        {isGuideSidebarOpen && (
          <div
            onMouseDown={handleGuideResizeStart}
            style={{
              width: 4,
              cursor: 'col-resize',
              background: 'transparent',
              borderLeft: '1px solid var(--vscode-border)',
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background = 'var(--vscode-bg-quaternary)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = 'transparent')
            }
          />
        )}

        {/* ── Persistent guide sidebar ── */}
        <div
          style={{
            width: isGuideSidebarOpen ? guideWidth : GUIDE_COLLAPSED_WIDTH,
            minWidth: isGuideSidebarOpen ? GUIDE_MIN_WIDTH : GUIDE_COLLAPSED_WIDTH,
            maxWidth: isGuideSidebarOpen ? GUIDE_MAX_WIDTH : GUIDE_COLLAPSED_WIDTH,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
            background: 'var(--vscode-bg-secondary)',
            borderLeft: '1px solid var(--vscode-border)',
            transition: 'width 0.18s ease',
          }}
        >
          <div
            hidden={!isGuideSidebarOpen}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: isGuideSidebarOpen ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <RepositoryRightPanel
              owner={owner}
              repo={repo}
              theme={workspaceTheme}
              onClose={() => setIsGuideSidebarOpen(false)}
            >
              <GuidePanel
                sections={guideSections}
                activeChapterId={activeChapterId}
                onActiveChapterChange={setActiveChapterId}
              />
            </RepositoryRightPanel>
          </div>
          {!isGuideSidebarOpen && (
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 8,
                background: 'var(--vscode-bg-tertiary)',
              }}
            >
              <button
                onClick={() => setIsGuideSidebarOpen(true)}
                title="Show guide sidebar"
                aria-label="Show guide sidebar"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  border: '1px solid var(--vscode-border)',
                  background: 'transparent',
                  color: 'var(--vscode-text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  lineHeight: 1,
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--vscode-bg-hover)';
                  e.currentTarget.style.borderColor =
                    'var(--repo-accent, var(--vscode-text-accent, #0078d4))';
                  e.currentTarget.style.color = 'var(--vscode-text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'var(--vscode-border)';
                  e.currentTarget.style.color = 'var(--vscode-text-secondary)';
                }}
              >
                ‹
              </button>
            </div>
          )}
        </div>
      </div>
      <StatusBar
        repoLabel={repoLabel}
        branch={statusBranch}
        sourceMode={showDevSourceMode ? fileSourceMode : undefined}
        canUseR2Source={isR2SourceConfigured}
        onSourceModeChange={showDevSourceMode ? handleSourceModeChange : undefined}
        workspaceTheme={workspaceTheme}
        onWorkspaceThemeChange={setWorkspaceTheme}
      />
    </main>
  );
}
