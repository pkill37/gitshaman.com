// Dynamic project guide configuration system using docs/ markdown files
import React, { type CSSProperties } from 'react';
import { getCuratedGuideByRepo } from '@/features/guides/docs-loader';
import { parseRepoNavigationTarget } from '@/lib/markdown-navigation';
import { getCuratedRepoAccent, getCuratedRepoDisplayName } from '@/lib/curated-repos';
import { SOURCE_REPOSITORY_URL } from '@/lib/site';

export interface FileRecommendation {
  path: string;
  description?: string;
  type?: 'docs' | 'source' | 'directory';
}

type RecommendationType = 'docs' | 'source' | 'directory';

interface RecommendationItem extends FileRecommendation {
  type: RecommendationType;
}

interface RecommendationGroup {
  type: RecommendationType;
  title: string;
  items: RecommendationItem[];
  accent: string;
}

export interface GuideSection {
  id: string;
  title: string;
  body: React.ReactNode;
  narrativePaths?: string[];
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  learningGoals?: string[];
  questions?: Array<{ prompt: string; answer: string }>;
  trace?: FileRecommendation[];
  fileRecommendations?: {
    readingOrder?: FileRecommendation[];
    docs?: FileRecommendation[];
    source?: FileRecommendation[];
    directories?: FileRecommendation[];
  };
  /** Mermaid diagram describing the pedagogical graph for this chapter */
  graph?: string;
}

export interface ProjectGuide {
  id: string;
  name: string;
  description?: string;
  sections: GuideSection[];
  defaultOpenIds?: string[];
}

export interface ProjectConfig {
  id: string;
  name: string;
  owner: string;
  repo: string;
  defaultRevision: string;
  guides: ProjectGuide[];
  suggestions?: {
    pathBased?: Record<string, unknown[]>;
    patternBased?: Array<{ pattern: RegExp; suggestions: unknown[] }>;
    fundamental?: unknown[];
  };
}

// Helper to create file recommendations component
export function createFileRecommendationsComponent(
  readingOrder: FileRecommendation[] = [],
  docs: FileRecommendation[] = [],
  source: FileRecommendation[] = [],
  directories: FileRecommendation[] = [],
  onFileClick: (
    path: string,
    searchPattern?: string,
    scrollToLine?: number,
    searchScope?: string[],
    repoTarget?: { owner: string; repo: string }
  ) => void
) {
  const normalizeDirectoryPath = (path: string) => (path.endsWith('/') ? path : `${path}/`);
  const orderedItems: RecommendationItem[] =
    readingOrder.length > 0
      ? readingOrder.map((file) => ({
          ...file,
          type: (file.type ?? 'source') as RecommendationType,
        }))
      : [
          ...source.map((file) => ({ ...file, type: 'source' as const })),
          ...docs.map((file) => ({ ...file, type: 'docs' as const })),
          ...directories.map((file) => ({ ...file, type: 'directory' as const })),
        ];

  const groups = [
    {
      type: 'source',
      title: 'Files',
      items: orderedItems.filter((file) => file.type === 'source'),
      accent: '#0ea5e9',
    },
    {
      type: 'docs',
      title: 'Docs',
      items: orderedItems.filter((file) => file.type === 'docs'),
      accent: '#8b5cf6',
    },
    {
      type: 'directory',
      title: 'Directories',
      items: orderedItems.filter((file) => file.type === 'directory'),
      accent: '#f59e0b',
    },
  ].filter((group) => group.items.length > 0) as RecommendationGroup[];

  const getItemPath = (file: FileRecommendation) =>
    file.type === 'directory' ? normalizeDirectoryPath(file.path) : file.path;

  const getItemTarget = (file: FileRecommendation) =>
    parseRepoNavigationTarget(getItemPath(file), undefined, {
      title: file.description,
    });

  const getItemBadge = (file: FileRecommendation) => {
    const target = getItemTarget(file);
    if (target?.owner && target.repo) {
      return getCuratedRepoDisplayName(target.owner, target.repo);
    }

    switch (file.type) {
      case 'docs':
        return 'DOC';
      case 'directory':
        return 'DIR';
      default:
        return 'FILE';
    }
  };

  const getItemAccent = (file: FileRecommendation) => {
    const target = getItemTarget(file);
    return target?.owner && target.repo
      ? getCuratedRepoAccent(target.owner, target.repo)
      : undefined;
  };

  return (
    <div className="guide-recommendations">
      {groups.length > 0 && (
        <div className="guide-recommendations-stack">
          {groups.map((group) => (
            <section
              key={group.type}
              className={`guide-recommendation-group guide-recommendation-group--${group.type}`}
              style={{ '--guide-rec-accent': group.accent } as CSSProperties}
            >
              <div className="guide-recommendation-header">
                <div className="guide-recommendation-heading">
                  <div className="guide-recommendation-title">{group.title}</div>
                </div>
                <div className="guide-recommendation-count">{group.items.length}</div>
              </div>
              <div className="guide-recommendation-list">
                {group.items.map((file, index) => {
                  const itemAccent = getItemAccent(file);
                  return (
                    <button
                      key={`${group.type}-${index + 1}-${file.path}`}
                      className="guide-recommendation-item"
                      onClick={() => {
                        const target = getItemTarget(file);
                        if (target) {
                          onFileClick(
                            target.path,
                            target.searchPattern,
                            target.scrollToLine,
                            undefined,
                            target.owner && target.repo
                              ? { owner: target.owner, repo: target.repo }
                              : undefined
                          );
                          return;
                        }
                        onFileClick(getItemPath(file));
                      }}
                      style={
                        itemAccent
                          ? ({ '--guide-rec-badge-accent': itemAccent } as CSSProperties)
                          : undefined
                      }
                    >
                      <div className="guide-recommendation-item-inner">
                        <span className="guide-recommendation-index">{index + 1}.</span>
                        <div className="guide-recommendation-item-main">
                          <div className="guide-recommendation-item-heading">
                            <div className="guide-recommendation-item-title">
                              {file.description || getItemPath(file)}
                            </div>
                            <span className="guide-recommendation-badge">{getItemBadge(file)}</span>
                          </div>
                          <div className="guide-recommendation-path">{getItemPath(file)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Get project config by owner/repo
 * Dynamically builds configuration from docs/ markdown files
 */
export function getProjectConfig(owner: string, repo: string): ProjectConfig | null {
  const guideDoc = getCuratedGuideByRepo(owner, repo);

  if (!guideDoc) {
    return null;
  }

  const { metadata } = guideDoc;

  return {
    id: `${owner}-${repo}`.toLowerCase().replace(/\//g, '-'),
    name: metadata.name,
    owner: metadata.owner,
    repo: metadata.repo,
    defaultRevision: metadata.revision,
    guides: [
      {
        id: metadata.guideId,
        name: metadata.name,
        description: metadata.description,
        sections: [], // Will be populated by guide loader
        defaultOpenIds: metadata.defaultOpenIds,
      },
    ],
    suggestions: {
      fundamental: [],
    },
  };
}

// Create a generic guide for unsupported repositories
export function createGenericGuide(owner: string, repo: string): GuideSection[] {
  const requestTitle = encodeURIComponent(`Add a guide for ${owner}/${repo}`);

  return [
    {
      id: 'contribute',
      title: 'Repository guide',
      body: (
        <div
          style={{
            fontSize: '12px',
            lineHeight: '1.5',
            color: 'var(--vscode-descriptionForeground, #999)',
          }}
        >
          <p style={{ margin: '0 0 8px' }}>
            No guide yet. Browse the files in the explorer or help add one.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <a
              href={`${SOURCE_REPOSITORY_URL}/issues/new?title=${requestTitle}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'inherit', textUnderlineOffset: '3px' }}
            >
              Request a guide
            </a>
            <a
              href={`${SOURCE_REPOSITORY_URL}/blob/main/CONTRIBUTING.md`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'inherit', textUnderlineOffset: '3px' }}
            >
              Contribute
            </a>
          </div>
        </div>
      ),
    },
  ];
}
