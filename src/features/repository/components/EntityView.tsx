'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import SidebarSearchHeader from './SidebarSearchHeader';
import { fetchRepositoryFile, getTrustedVersion } from '@/lib/github-api';
import { getProjectConfig, type GuideSection } from '@/lib/project-guides';
import { getGuideByRepo } from '@/features/guides/docs-loader';
import { buildGraphData, buildGraphDataFromSections } from '@/lib/graph-data';
import { extractEntities, type CodeEntity } from '@/lib/entity-extraction';
import {
  getRepositoryMode,
  getTreeStructureFromStatic,
  resolveCorpusPathFromKnownFiles,
  type CuratedRepoSourceMode,
} from '@/lib/repo-static';
import type { FileNode } from '@/types';

// ─── Importance tiers ────────────────────────────────────────────────────────

type Tier = 'hero' | 'major' | 'minor';

interface ScoredEntity {
  entity: CodeEntity & { line: number };
  refCount: number;
  score: number;
  tier: Tier;
}

interface FolderGroup {
  folder: string;
  color: string;
  items: ScoredEntity[];
}

const FOLDER_COLORS = [
  '#1d4ed8',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#dc2626',
];

function getFolderLabel(filePath: string): string {
  return filePath.includes('/') ? filePath.split('/')[0] : 'root';
}

function buildFolderGroups(scored: ScoredEntity[]): FolderGroup[] {
  const folderOrder: string[] = [];
  const folderItems = new Map<string, ScoredEntity[]>();

  for (const item of scored) {
    const folder = getFolderLabel(item.entity.filePath);
    if (!folderItems.has(folder)) {
      folderItems.set(folder, []);
      folderOrder.push(folder);
    }
    folderItems.get(folder)!.push(item);
  }

  const colorMap = new Map<string, string>();
  folderOrder.forEach((folder, index) => {
    colorMap.set(folder, FOLDER_COLORS[index % FOLDER_COLORS.length]);
  });

  return folderOrder
    .map((folder) => ({
      folder,
      color: colorMap.get(folder) ?? FOLDER_COLORS[0],
      items: folderItems.get(folder) ?? [],
    }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

function matchesEntityQuery(item: ScoredEntity, query: string): boolean {
  if (!query) return true;

  const haystack = [
    item.entity.name,
    item.entity.kind,
    item.entity.filePath,
    item.entity.language,
    ...item.entity.fields.flatMap((field) => [field.name, field.type]),
  ]
    .join(' ')
    .toLowerCase();

  return query.split(/\s+/).every((term) => haystack.includes(term));
}

function scoreEntities(entities: Array<CodeEntity & { line: number }>): ScoredEntity[] {
  // Deduplicate (same name+file)
  const seen = new Set<string>();
  const unique = entities.filter((e) => {
    const key = `${e.filePath}::${e.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Pre-compile one regex per entity name — reused across all field type strings
  const nameRegex = new Map<string, RegExp>(
    unique.map((e) => [e.name, new RegExp(`\\b${e.name}\\b`)])
  );

  // Count how many other entity fields reference each entity's name
  const refCounts = new Map<string, number>(unique.map((e) => [e.name, 0]));
  for (const e of unique) {
    for (const f of e.fields) {
      if (!f.type) continue;
      for (const candidate of unique) {
        if (candidate.name === e.name) continue;
        if (nameRegex.get(candidate.name)!.test(f.type)) {
          refCounts.set(candidate.name, (refCounts.get(candidate.name) ?? 0) + 1);
        }
      }
    }
  }

  const scores = unique.map((e) => {
    const refCount = refCounts.get(e.name) ?? 0;
    return { entity: e, refCount, score: e.fields.length + refCount * 3 };
  });

  const maxScore = Math.max(...scores.map((s) => s.score), 1);

  return scores
    .map((s) => ({
      ...s,
      tier: (s.score / maxScore >= 0.6
        ? 'hero'
        : s.score / maxScore >= 0.25
          ? 'major'
          : 'minor') as Tier,
    }))
    .sort(
      (a, b) =>
        a.entity.name.localeCompare(b.entity.name) ||
        a.entity.filePath.localeCompare(b.entity.filePath)
    );
}

// ─── Entity card ─────────────────────────────────────────────────────────────

interface EntityCardProps {
  scored: ScoredEntity;
  onOpenFile: (path: string, searchPattern?: string, scrollToLine?: number) => void;
  color: string;
  folderLabel: string;
}

function EntityCard({ scored, onOpenFile, color, folderLabel }: EntityCardProps) {
  const { entity, tier, refCount } = scored;

  const isHero = tier === 'hero';
  const isMajor = tier === 'major';

  const maxFields = isHero ? 16 : isMajor ? 10 : 6;
  const headerFontSize = isHero ? 14 : isMajor ? 12 : 10;
  const fieldFontSize = isHero ? 11 : isMajor ? 10 : 9;
  const footerFontSize = isHero ? 9 : 8;
  const headerPad = isHero ? '10px 12px' : isMajor ? '8px 10px' : '6px 8px';
  const fieldPad = isHero ? '0 12px' : isMajor ? '0 10px' : '0 8px';
  const fieldHeight = isHero ? 24 : isMajor ? 20 : 17;
  const borderTopWidth = isHero ? 4 : isMajor ? 3 : 2;

  const visibleFields = entity.fields.slice(0, maxFields);
  const hidden = entity.fields.length - visibleFields.length;

  return (
    <div
      className="explorar-entity-card"
      onClick={() => onOpenFile(entity.filePath, entity.name, entity.line)}
      style={{
        fontFamily: 'monospace',
        background: 'var(--vscode-bg-primary)',
        border: `1px solid ${color}33`,
        borderTop: `${borderTopWidth}px solid ${color}`,
        borderRadius: 7,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: 'none',
        opacity: tier === 'minor' ? 0.72 : 1,
        transition: 'opacity 0.15s, box-shadow 0.15s, border-color 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gridColumn: isHero ? 'span 2' : 'span 1',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.opacity = '1';
        el.style.borderColor = color;
        el.style.boxShadow = 'none';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.opacity = tier === 'minor' ? '0.72' : '1';
        el.style.border = `1px solid ${color}33`;
        el.style.borderTop = `${borderTopWidth}px solid ${color}`;
        el.style.boxShadow = 'none';
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: headerPad,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: `${color}${isHero ? '1e' : '10'}`,
          borderBottom: `1px solid ${color}22`,
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: headerFontSize,
            fontWeight: isHero ? 800 : 700,
            color: 'var(--vscode-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {entity.name}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {refCount > 0 && (
            <span
              title={`Referenced by ${refCount} other ${refCount === 1 ? 'entity' : 'entities'}`}
              style={{
                fontSize: fieldFontSize - 1,
                color,
                background: `${color}20`,
                border: `1px solid ${color}44`,
                padding: '1px 5px',
                borderRadius: 10,
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
              ×{refCount}
            </span>
          )}
          <span
            style={{
              fontSize: fieldFontSize - 1,
              color,
              background: `${color}18`,
              padding: '2px 5px',
              borderRadius: 3,
              fontWeight: 600,
            }}
          >
            {entity.kind}
          </span>
          <span
            style={{
              fontSize: fieldFontSize - 1,
              color: 'var(--vscode-text-secondary)',
              background: 'var(--vscode-bg-tertiary)',
              padding: '2px 5px',
              borderRadius: 3,
              fontWeight: 600,
            }}
          >
            {folderLabel}
          </span>
        </div>
      </div>

      {/* Fields */}
      <div style={{ flex: 1 }}>
        {visibleFields.map((field, idx) => (
          <div
            key={`${field.name}:${field.type ?? 'unknown'}:${idx}`}
            style={{
              height: fieldHeight,
              display: 'flex',
              alignItems: 'center',
              padding: fieldPad,
              background: idx % 2 === 0 ? 'var(--vscode-bg-primary)' : 'var(--vscode-bg-secondary)',
              borderBottom: '1px solid var(--vscode-border)',
            }}
          >
            <span
              style={{
                fontSize: fieldFontSize,
                color: 'var(--syntax-variable)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: '0 0 40%',
              }}
            >
              {field.name}
            </span>
            {field.type && (
              <span
                style={{
                  fontSize: fieldFontSize,
                  color: 'var(--syntax-type)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  marginLeft: 8,
                }}
              >
                {field.type}
              </span>
            )}
          </div>
        ))}
        {hidden > 0 && (
          <div
            style={{
              height: fieldHeight,
              display: 'flex',
              alignItems: 'center',
              padding: fieldPad,
              background: 'var(--vscode-bg-secondary)',
            }}
          >
            <span style={{ fontSize: fieldFontSize - 1, color: 'var(--vscode-text-tertiary)' }}>
              +{hidden} more…
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: `4px ${isHero ? '12px' : isMajor ? '10px' : '8px'}`,
          background: 'var(--vscode-bg-secondary)',
          borderTop: '1px solid var(--vscode-border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: footerFontSize,
            color: 'var(--vscode-text-tertiary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
          }}
        >
          {entity.filePath}
        </span>
      </div>
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────

interface ChapterEntry {
  id: string;
  files: string[];
}

interface EntityViewProps {
  owner: string;
  repo: string;
  onOpenFile: (path: string, searchPattern?: string, scrollToLine?: number) => void;
  activeChapterId?: string | null;
  chapterMapEntries?: ChapterEntry[];
  guideSections?: GuideSection[];
  isActive?: boolean;
  sourceMode?: CuratedRepoSourceMode;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}

const FETCH_CAP = 40;
const BATCH_SIZE = 8;
const BYTES_CAP = 60 * 1024;
const SOURCE_FILE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hh',
  'hpp',
  'hxx',
  'inc',
  'inl',
  'py',
  'js',
  'jsx',
  'ts',
  'tsx',
]);

function isLikelySourceFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return Boolean(ext && SOURCE_FILE_EXTENSIONS.has(ext));
}

function flattenTree(nodes: FileNode[]): FileNode[] {
  const flat: FileNode[] = [];

  const walk = (entries: FileNode[]) => {
    for (const entry of entries) {
      flat.push(entry);
      if (entry.children?.length) {
        walk(entry.children);
      }
    }
  };

  walk(nodes);
  return flat;
}

function expandGuidePathsToSourceFiles(paths: string[], tree: FileNode[]): string[] {
  const flatTree = flattenTree(tree);
  const deduped = new Set<string>();
  const resolved: string[] = [];

  for (const rawPath of paths) {
    const normalizedPath = rawPath.replace(/\/+$/, '');
    if (!normalizedPath) {
      continue;
    }

    const exactNode = flatTree.find((node) => node.path === normalizedPath);
    if (exactNode?.type === 'file' && isLikelySourceFile(exactNode.path)) {
      if (!deduped.has(exactNode.path)) {
        deduped.add(exactNode.path);
        resolved.push(exactNode.path);
      }
      continue;
    }

    const resolvedPath = resolveCorpusPathFromKnownFiles(
      normalizedPath,
      flatTree.filter((node) => node.type === 'file').map((node) => node.path)
    );
    if (resolvedPath && isLikelySourceFile(resolvedPath)) {
      if (!deduped.has(resolvedPath)) {
        deduped.add(resolvedPath);
        resolved.push(resolvedPath);
      }
      continue;
    }

    const prefix = `${normalizedPath}/`;
    const descendants = flatTree
      .filter((node) => node.type === 'file' && node.path.startsWith(prefix))
      .map((node) => node.path)
      .filter(isLikelySourceFile)
      .sort();

    for (const filePath of descendants) {
      if (!deduped.has(filePath)) {
        deduped.add(filePath);
        resolved.push(filePath);
      }
    }
  }

  return resolved;
}

export function EntityView({
  owner,
  repo,
  onOpenFile,
  activeChapterId,
  chapterMapEntries,
  guideSections,
  isActive = true,
  sourceMode = 'r2-bucket',
  searchQuery = '',
  onSearchQueryChange,
}: EntityViewProps) {
  const projectConfig = useMemo(() => getProjectConfig(owner, repo), [owner, repo]);
  const branch = projectConfig?.defaultRevision ?? 'main';

  // Per-key entity cache — key is chapterId or '__all__'
  const cacheRef = useRef<Map<string, ScoredEntity[]>>(new Map());
  const [cachedEntityKeys, setCachedEntityKeys] = useState<ReadonlySet<string>>(() => new Set());

  const [scored, setScored] = useState<ScoredEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const deferredEntityFilter = useDeferredValue(searchQuery.trim().toLowerCase());
  const filteredScored = useMemo(
    () => scored.filter((item) => matchesEntityQuery(item, deferredEntityFilter)),
    [scored, deferredEntityFilter]
  );
  const folderGroups = useMemo(() => buildFolderGroups(filteredScored), [filteredScored]);

  // Stable key for the current view
  const currentKey = `${sourceMode}:${activeChapterId ?? '__all__'}`;

  // Guide-selected paths for the current key. These may be files or directories.
  const selectedPaths = useMemo(() => {
    if (chapterMapEntries && chapterMapEntries.length > 0) {
      if (activeChapterId) {
        return chapterMapEntries.find((e) => e.id === activeChapterId)?.files ?? [];
      }
      // All chapters merged, deduped
      const seen = new Set<string>();
      const all: string[] = [];
      for (const entry of chapterMapEntries) {
        for (const f of entry.files) {
          if (!seen.has(f)) {
            seen.add(f);
            all.push(f);
          }
        }
      }
      return all;
    }
    if (guideSections && guideSections.length > 0) {
      const { nodes } = buildGraphDataFromSections(guideSections);
      return nodes.map((n) => n.id);
    }
    // Fallback: extract from guide content (no parsed guide sections available)
    const guideDoc = getGuideByRepo(owner, repo);
    if (!guideDoc) return [] as string[];
    const { nodes } = buildGraphData(guideDoc.content);
    return nodes.map((n) => n.id);
  }, [owner, repo, activeChapterId, chapterMapEntries, guideSections]);

  const [filesToFetch, setFilesToFetch] = useState<string[]>(selectedPaths);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let cancelled = false;

    async function resolveFilesToFetch() {
      if (selectedPaths.length === 0) {
        setFilesToFetch([]);
        return;
      }

      const hasTreeResolutionHints = selectedPaths.some(
        (path) => path.endsWith('/') || !path.includes('/')
      );
      if (!hasTreeResolutionHints) {
        setFilesToFetch(selectedPaths.filter(isLikelySourceFile));
        return;
      }

      try {
        const repoMode = getRepositoryMode(owner, repo);
        if (repoMode !== 'curated') {
          throw new Error(`Repository ${owner}/${repo} is not curated`);
        }
        const tree = await getTreeStructureFromStatic(owner, repo, branch, { sourceMode });

        if (cancelled) return;

        if (tree && tree.length > 0) {
          const expanded = expandGuidePathsToSourceFiles(selectedPaths, tree);
          setFilesToFetch(expanded);
          return;
        }
      } catch {
        // Fall back to raw selected paths below.
      }

      if (!cancelled) {
        setFilesToFetch(selectedPaths.filter(isLikelySourceFile));
      }
    }

    void resolveFilesToFetch();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, selectedPaths, sourceMode, isActive]);

  useEffect(() => {
    console.log('[EntityView] files selected for scan', {
      owner,
      repo,
      activeChapterId: activeChapterId ?? '__all__',
      selectedPathCount: selectedPaths.length,
      selectedPaths: selectedPaths.slice(0, 20),
      fileCount: filesToFetch.length,
      files: filesToFetch.slice(0, 20),
    });
  }, [owner, repo, activeChapterId, selectedPaths, filesToFetch]);

  useEffect(() => {
    if (!isActive) {
      queueMicrotask(() => {
        setScored([]);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;

    async function run() {
      if (!branch || filesToFetch.length === 0) {
        setScored([]);
        setLoading(false);
        return;
      }

      // Cache hit — show immediately, no loading state
      const cached = cacheRef.current.get(currentKey);
      if (cached) {
        setScored(cached);
        setLoading(false);
        return;
      }

      setLoading(true);

      const allEntities: Array<CodeEntity & { line: number }> = [];
      const batch = filesToFetch.slice(0, FETCH_CAP);

      for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        if (cancelled) return;
        await Promise.all(
          batch.slice(i, i + BATCH_SIZE).map(async (fp: string) => {
            try {
              const fullText = (
                await fetchRepositoryFile(owner, repo, branch, fp, {
                  sourceMode,
                  allowGitHubFallback: branch !== getTrustedVersion(owner, repo),
                })
              ).content;
              const text = fullText.length > BYTES_CAP ? fullText.slice(0, BYTES_CAP) : fullText;
              const entities = extractEntities(fp, text);

              if (entities.length > 0) {
                allEntities.push(...entities);
              }
            } catch {
              // skip
            }
          })
        );
      }

      if (cancelled) return;

      const result = allEntities.length > 0 ? scoreEntities(allEntities) : [];
      console.log('[EntityView] symbols/entities extracted', {
        owner,
        repo,
        activeChapterId: activeChapterId ?? '__all__',
        fileCount: batch.length,
        rawEntityCount: allEntities.length,
        scoredEntityCount: result.length,
      });
      cacheRef.current.set(currentKey, result);
      setCachedEntityKeys((prev) => {
        const next = new Set(prev);
        next.add(currentKey);
        return next;
      });
      setScored(result);
      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [currentKey, branch, owner, repo, activeChapterId, filesToFetch, isActive, sourceMode]);

  useEffect(() => {
    console.log('[EntityView] render state', {
      owner,
      repo,
      activeChapterId: activeChapterId ?? '__all__',
      loading,
      scoredEntityCount: scored.length,
      folderGroupCount: folderGroups.length,
      branch: loading || scored.length > 0 ? (scored.length > 0 ? 'cards' : 'loading') : 'empty',
    });
  }, [owner, repo, activeChapterId, loading, scored.length, folderGroups.length]);

  const isEntityCacheReady = cachedEntityKeys.has(currentKey);
  const content = loading ? (
    <div
      style={{
        minHeight: 320,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'monospace',
        color: 'var(--vscode-text-tertiary)',
        gap: 10,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          border: '2px solid var(--vscode-border)',
          borderTopColor: 'var(--vscode-text-secondary)',
          borderRadius: '50%',
          animation: 'spin 0.9s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ fontSize: 11 }}>scanning entities…</span>
    </div>
  ) : scored.length === 0 ? (
    <div
      style={{
        minHeight: 320,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'monospace',
        fontSize: 13,
        color: 'var(--vscode-text-tertiary)',
      }}
    >
      No entities found.
    </div>
  ) : (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {filteredScored.length === 0 ? (
        <div
          style={{
            minHeight: 240,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'monospace',
            fontSize: 13,
            color: 'var(--vscode-text-tertiary)',
            background: 'var(--vscode-bg-primary)',
            border: '1px solid var(--vscode-border)',
            borderRadius: 10,
          }}
        >
          No entities match the current filter.
        </div>
      ) : (
        folderGroups.map((group) => (
          <section
            key={group.folder}
            style={{
              border: `1px solid ${group.color}26`,
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--vscode-bg-primary)',
              boxShadow: `0 0 0 1px ${group.color}10 inset`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                background: `${group.color}14`,
                borderBottom: `1px solid ${group.color}26`,
                fontFamily: 'monospace',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: group.color,
                  boxShadow: `0 0 12px ${group.color}88`,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vscode-text-primary)' }}>
                {group.folder}
              </span>
              <span style={{ fontSize: 10, color: 'var(--vscode-text-secondary)' }}>
                {group.items.length} entities
              </span>
            </div>
            <div
              style={{
                padding: 12,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 10,
                alignItems: 'start',
              }}
            >
              {group.items.map((item, index) => (
                <EntityCard
                  key={`${item.entity.filePath}::${item.entity.name}::${index}`}
                  scored={item}
                  onOpenFile={onOpenFile}
                  color={group.color}
                  folderLabel={group.folder}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--vscode-bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <SidebarSearchHeader
        query={searchQuery}
        onQueryChange={onSearchQueryChange ?? (() => undefined)}
        placeholder="Search…"
        ariaLabel="Search entities"
        statusVisible={loading}
        statusLoading={loading}
        statusReady={!loading && scored.length > 0}
        statusCached={isEntityCacheReady}
        statusProgress={loading ? 35 : 100}
        statusLabel={
          loading
            ? 'Scanning entities'
            : isEntityCacheReady
              ? 'Cached entities ready'
              : 'Entities ready'
        }
        statusBadgeLabel={loading ? 'loading' : isEntityCacheReady ? 'cached' : 'ready'}
        meta={
          searchQuery && !loading ? (
            <div className="vscode-tree-search-meta">
              {filteredScored.length} match{filteredScored.length === 1 ? '' : 'es'}
            </div>
          ) : null
        }
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{content}</div>
    </div>
  );
}
