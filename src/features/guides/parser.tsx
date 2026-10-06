// Markdown parser utility for guide files
import React from 'react';
import matter from 'gray-matter';
import { marked, type Tokens } from 'marked';
import { GuideSection, FileRecommendation } from '@/lib/project-guides';
import { createFileRecommendationsComponent } from '@/lib/project-guides';
import { getCuratedRepoAccent } from '@/lib/curated-repos';
import { debugLog } from '@/lib/browser-debug';
import { renderHighlightedCodeBlock } from '@/lib/markdown-code-highlight';
import {
  decodeHtmlEntities,
  escapeHtml,
  getExternalRepoIconHtml,
  getRepoLinkAttributes,
  hasUnsafeScheme,
  isExternalHref,
  parseMarkdownNavigationTarget,
  parseRepoNavigationTarget,
} from '@/lib/markdown-navigation';

/** Extract and strip a ```chapter-graph block from section content. */
function extractChapterGraph(content: string): { graph: string | undefined; cleanContent: string } {
  const re = /```chapter-graph\n([\s\S]*?)```/;
  const match = content.match(re);
  if (!match) return { graph: undefined, cleanContent: content };
  return {
    graph: match[1].trim(),
    cleanContent: content.replace(re, '').trim(),
  };
}

function isLikelySymbolCode(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (/[\s/\\]/.test(trimmed)) return false;
  if (/^(true|false|null|undefined|\d+)$/i.test(trimmed)) return false;
  return /^(?:[A-Za-z_]\w*|[A-Za-z_]\w*::[A-Za-z_]\w*)(?:\(\))?$/.test(trimmed);
}

type OpenFileInTab = (
  path: string,
  searchPattern?: string,
  scrollToLine?: number,
  searchScope?: string[],
  repoTarget?: { owner: string; repo: string }
) => void;

function createMarkdownRenderer(
  symbolScopePaths: string[],
  options?: { linkRepoReferences?: boolean }
) {
  const renderer = new marked.Renderer();
  const linkRepoReferences = options?.linkRepoReferences ?? true;

  renderer.code = function ({ text, lang }: Tokens.Code) {
    return renderHighlightedCodeBlock(text, lang);
  };

  renderer.link = function ({ href, title, tokens }: Tokens.Link) {
    const safeHref = href?.trim() || '#';
    // A markdown link can wrap an inline-code span. Since codespan navigation
    // also renders an anchor, remove that nested anchor before rendering the
    // outer link so the resulting HTML contains one accessible link.
    const renderedText = this.parser.parseInline(tokens);
    const linkText = renderedText.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

    if (hasUnsafeScheme(safeHref)) {
      return `<span>${renderedText}</span>`;
    }

    const navigationTarget = parseMarkdownNavigationTarget(safeHref, undefined, {
      linkText: linkText,
      title: title ?? undefined,
    });

    if (navigationTarget?.kind === 'repo-file') {
      if (!linkRepoReferences) {
        return linkText;
      }
      return `<a href="#" ${getRepoLinkAttributes(navigationTarget)}${titleAttr}>${getExternalRepoIconHtml(navigationTarget)}${linkText}</a>`;
    }

    const targetAttr = isExternalHref(safeHref) ? ' target="_blank" rel="noreferrer"' : '';
    return `<a href="${escapeHtml(safeHref)}"${titleAttr}${targetAttr}>${linkText}</a>`;
  };

  renderer.codespan = function ({ text: code }: Tokens.Codespan) {
    const decodedCode = decodeHtmlEntities(code);
    const repoTarget = parseRepoNavigationTarget(decodedCode);
    const codeHtml = `<code>${escapeHtml(decodedCode)}</code>`;

    if (!repoTarget) {
      if (symbolScopePaths.length > 0 && isLikelySymbolCode(decodedCode)) {
        return `<a href="#" class="inline-code-link" data-search-pattern="${escapeHtml(
          decodedCode.trim()
        )}" data-symbol-scope="${escapeHtml(symbolScopePaths.join('|||'))}">${codeHtml}</a>`;
      }
      return codeHtml;
    }

    if (!linkRepoReferences) {
      return codeHtml;
    }

    return `<a href="#" class="inline-code-link" ${getRepoLinkAttributes(repoTarget)}>${getExternalRepoIconHtml(repoTarget)}${codeHtml}</a>`;
  };

  return renderer;
}

// Parse section frontmatter
interface SectionFrontmatter {
  id: string;
  title: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  learningGoals?: string[];
  questions?: Array<{
    prompt: string;
    answer: string;
  }>;
  trace?: FileRecommendation[];
  fileRecommendations?: {
    readingOrder?: FileRecommendation[];
    docs?: FileRecommendation[];
    source?: FileRecommendation[];
    directories?: FileRecommendation[];
  };
}

function isDifficulty(value: unknown): value is SectionFrontmatter['difficulty'] {
  return value === 'beginner' || value === 'intermediate' || value === 'advanced';
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeQuestions(value: unknown): Array<{ prompt: string; answer: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      prompt: String(item.prompt ?? '').trim(),
      answer: String(item.answer ?? '').trim(),
    }))
    .filter((item) => item.prompt && item.answer);
}

function normalizeFileRecommendations(value: unknown): FileRecommendation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item): FileRecommendation => {
      const type: FileRecommendation['type'] =
        item.type === 'docs' || item.type === 'directory' || item.type === 'source'
          ? item.type
          : undefined;
      return {
        path: String(item.path ?? '').trim(),
        description: item.description ? String(item.description) : undefined,
        type,
      };
    })
    .filter((item) => item.path);
}

function normalizeSectionMeta(meta: SectionFrontmatter): SectionFrontmatter {
  return {
    ...meta,
    difficulty: isDifficulty(meta.difficulty) ? meta.difficulty : undefined,
    learningGoals: normalizeStringList(meta.learningGoals),
    questions: normalizeQuestions(meta.questions),
    trace: normalizeFileRecommendations(meta.trace),
  };
}

function renderPedagogyPanel(
  sectionMeta: SectionFrontmatter,
  openFileInTab: OpenFileInTab
): React.ReactNode {
  const learningGoals = sectionMeta.learningGoals ?? [];
  const questions = sectionMeta.questions ?? [];
  const trace = sectionMeta.trace ?? [];
  const hasPedagogy =
    Boolean(sectionMeta.difficulty) ||
    learningGoals.length > 0 ||
    questions.length > 0 ||
    trace.length > 0;

  if (!hasPedagogy) return null;

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--vscode-descriptionForeground, #999)',
    margin: '0 0 6px',
  };

  return (
    <aside
      style={{
        border: '1px solid var(--vscode-panel-border, #3e3e3e)',
        borderRadius: '6px',
        padding: '10px 12px',
        marginBottom: '12px',
        background: 'var(--vscode-editor-background, #1e1e1e)',
      }}
    >
      {sectionMeta.difficulty && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            border: '1px solid var(--vscode-panel-border, #3e3e3e)',
            borderRadius: '999px',
            padding: '1px 7px',
            marginBottom: '8px',
            fontSize: '11px',
            textTransform: 'capitalize',
            color: 'var(--vscode-foreground, #d4d4d4)',
          }}
        >
          {sectionMeta.difficulty}
        </div>
      )}

      {learningGoals.length > 0 && (
        <div style={{ marginBottom: trace.length > 0 || questions.length > 0 ? '10px' : 0 }}>
          <p style={labelStyle}>Learning Goals</p>
          <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.45 }}>
            {learningGoals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
        </div>
      )}

      {trace.length > 0 && (
        <div style={{ marginBottom: questions.length > 0 ? '10px' : 0 }}>
          <p style={labelStyle}>Trace</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {trace.map((item, index) => (
              <button
                key={`${index + 1}-${item.path}`}
                onClick={() => {
                  const target = parseRepoNavigationTarget(item.path, undefined, {
                    title: item.description,
                  });
                  if (target) {
                    openFileInTab(target.path, target.searchPattern, target.scrollToLine);
                    return;
                  }
                  openFileInTab(item.path);
                }}
                style={{
                  textAlign: 'left',
                  border: 0,
                  borderRadius: 0,
                  padding: '3px 0',
                  background: 'transparent',
                  color: 'var(--repo-accent, var(--vscode-textLink-foreground, #4a9eff))',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {index + 1}. {item.description || item.path}
              </button>
            ))}
          </div>
        </div>
      )}

      {questions.length > 0 && (
        <div>
          <p style={labelStyle}>Check Yourself</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {questions.map((question) => (
              <details key={question.prompt}>
                <summary style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1.45 }}>
                  {question.prompt}
                </summary>
                <p style={{ margin: '6px 0 0 16px', fontSize: '12px', lineHeight: 1.45 }}>
                  {question.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function pushUniquePath(target: string[], seen: Set<string>, path: string) {
  if (!path || seen.has(path)) return;
  seen.add(path);
  target.push(path);
}

function extractNarrativePaths(sectionContent: string, sectionMeta: SectionFrontmatter): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  const readingOrder = sectionMeta.fileRecommendations?.readingOrder ?? [];
  const fallbackRecommendations =
    readingOrder.length > 0
      ? readingOrder
      : [
          ...(sectionMeta.fileRecommendations?.docs ?? []),
          ...(sectionMeta.fileRecommendations?.source ?? []),
        ];

  for (const recommendation of fallbackRecommendations) {
    const target = parseRepoNavigationTarget(recommendation.path);
    if (!target) continue;
    pushUniquePath(paths, seen, target.path);
  }

  const markdownLinkRe = /\[[^\]]+\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkRe.exec(sectionContent)) !== null) {
    const target = parseRepoNavigationTarget(match[1]);
    if (!target) continue;
    pushUniquePath(paths, seen, target.path);
  }

  const codeSpanRe = /`([^`\n]+)`/g;
  while ((match = codeSpanRe.exec(sectionContent)) !== null) {
    const target = parseRepoNavigationTarget(match[1]);
    if (!target) continue;
    pushUniquePath(paths, seen, target.path);
  }

  return paths;
}

function collectNarrativeFileRecommendations(sectionContent: string): FileRecommendation[] {
  const recommendations: FileRecommendation[] = [];
  const seen = new Set<string>();

  const pushRecommendation = (path: string, description?: string) => {
    const target = parseRepoNavigationTarget(path, undefined, { title: description });
    if (!target || seen.has(target.path)) return;
    seen.add(target.path);
    recommendations.push({
      path,
      description: description?.trim() || target.path,
      type: target.path.endsWith('/') ? 'directory' : 'source',
    });
  };

  const markdownLinkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkRe.exec(sectionContent)) !== null) {
    pushRecommendation(match[2], match[1]);
  }

  const codeSpanRe = /`([^`\n]+)`/g;
  while ((match = codeSpanRe.exec(sectionContent)) !== null) {
    pushRecommendation(match[1]);
  }

  return recommendations;
}

function mergeRecommendations(
  explicit: FileRecommendation[] = [],
  discovered: FileRecommendation[] = []
): FileRecommendation[] {
  const merged: FileRecommendation[] = [];
  const seen = new Set<string>();

  for (const item of [...explicit, ...discovered]) {
    const target = parseRepoNavigationTarget(item.path, undefined, { title: item.description });
    const key = target?.path ?? item.path;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function looksLikeSectionFrontmatter(frontmatter: string): boolean {
  if (!frontmatter.trim()) return false;

  const lines = frontmatter
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.some(
    (line) =>
      line.startsWith('id:') || line.startsWith('title:') || line.startsWith('fileRecommendations:')
  );
}

// Split markdown into sections by "---" delimiters with frontmatter
function splitIntoSections(content: string): Array<{ frontmatter: string; content: string }> {
  const sections: Array<{ frontmatter: string; content: string }> = [];

  // Split by section delimiters (--- on its own line)
  // Pattern: ---\n (optional blank lines) frontmatter \n---\n (optional blank lines) content
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    // Find the start of a section (--- on its own line)
    if (lines[i].trim() === '---') {
      i++; // Skip the --- line

      // Skip blank lines after the first ---
      while (i < lines.length && lines[i].trim() === '') {
        i++;
      }

      // Collect frontmatter until we hit the closing ---
      const frontmatterLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '---') {
        frontmatterLines.push(lines[i]);
        i++;
      }

      // Skip the closing --- line
      if (i < lines.length && lines[i].trim() === '---') {
        i++;
      }

      // Skip blank lines after the closing ---
      while (i < lines.length && lines[i].trim() === '') {
        i++;
      }

      // Collect content until we hit the next section start or end of file
      const contentLines: string[] = [];
      while (i < lines.length) {
        // Check if this is the start of the next section
        if (lines[i].trim() === '---') {
          break; // Stop here, this is the next section
        }
        contentLines.push(lines[i]);
        i++;
      }

      const frontmatter = frontmatterLines.join('\n').trim();
      const sectionContent = contentLines.join('\n').trim();

      // Only treat this block as section metadata if it actually looks like
      // section frontmatter. Plain thematic breaks should be ignored.
      if (looksLikeSectionFrontmatter(frontmatter)) {
        sections.push({
          frontmatter,
          content: sectionContent,
        });
      }
    } else {
      i++;
    }
  }

  return sections;
}

// Parse section frontmatter using gray-matter (js-yaml) for correct nested YAML support
function parseSectionFrontmatter(yaml: string): SectionFrontmatter {
  try {
    return matter('---\n' + yaml + '\n---\n').data as SectionFrontmatter;
  } catch {
    return { id: '', title: '' };
  }
}

/**
 * Parse guide markdown file and return GuideSection array
 */
export function parseGuideMarkdown(markdown: string, openFileInTab: OpenFileInTab): GuideSection[] {
  // Validate inputs
  if (!markdown || markdown.trim().length === 0) {
    throw new Error('Empty markdown content provided');
  }

  if (typeof openFileInTab !== 'function') {
    throw new Error('openFileInTab callback is required and must be a function');
  }

  // Extract document-level frontmatter
  const { content: mainContent, data: documentMeta } = matter(markdown);
  const repoAccent =
    documentMeta.owner && documentMeta.repo
      ? getCuratedRepoAccent(String(documentMeta.owner), String(documentMeta.repo))
      : undefined;

  // Split content into sections
  const sections = splitIntoSections(mainContent);

  const guideSections: GuideSection[] = sections
    .map((section, index): GuideSection | null => {
      // Parse section frontmatter
      const sectionMeta = normalizeSectionMeta(parseSectionFrontmatter(section.frontmatter));

      // If id/title are missing, the "frontmatter" is likely markdown content
      // (e.g., when --- is used as a horizontal rule, not a YAML delimiter).
      // Auto-generate id/title from the first ## heading found.
      let sectionContent = section.content;
      if (!sectionMeta.id || !sectionMeta.title) {
        // Combine frontmatter and content since frontmatter is actually markdown
        const fullContent = section.frontmatter + '\n\n' + section.content;
        const headingMatch = fullContent.match(/^##\s+(.+)/m);
        if (headingMatch) {
          const headingText = headingMatch[1].trim();
          sectionMeta.title = headingText;
          sectionMeta.id =
            sectionMeta.id ||
            headingText
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '');
          sectionContent = fullContent;
        } else {
          console.warn(
            `Section at index ${index} is missing required fields (id or title) and no ## heading found.`
          );
          return null;
        }
      }

      // Extract chapter-graph block (strip it from rendered content)
      const { graph, cleanContent: contentWithoutGraph } = extractChapterGraph(sectionContent);
      sectionContent = contentWithoutGraph;
      const narrativePaths = extractNarrativePaths(sectionContent, sectionMeta);
      const narrativeRecommendations = collectNarrativeFileRecommendations(sectionContent);
      const hasReadingOrder = (sectionMeta.fileRecommendations?.readingOrder?.length ?? 0) > 0;
      const readingOrderRecommendations = hasReadingOrder
        ? mergeRecommendations(
            sectionMeta.fileRecommendations?.readingOrder ?? [],
            narrativeRecommendations
          )
        : [];
      const sourceRecommendations = hasReadingOrder
        ? (sectionMeta.fileRecommendations?.source ?? [])
        : mergeRecommendations(
            sectionMeta.fileRecommendations?.source ?? [],
            narrativeRecommendations
          );
      const hasRecommendationBoxes =
        readingOrderRecommendations.length > 0 ||
        (sectionMeta.fileRecommendations?.docs?.length ?? 0) > 0 ||
        sourceRecommendations.length > 0 ||
        (sectionMeta.fileRecommendations?.directories?.length ?? 0) > 0;

      // Convert markdown to HTML (only if content exists)
      let reactContent: React.ReactNode = null;
      if (sectionContent && sectionContent.trim().length > 0) {
        const renderer = createMarkdownRenderer(
          narrativePaths.filter((path) => !path.endsWith('/'))
        );
        marked.setOptions({ renderer });
        // marked can return string or Promise<string>, but with sync renderer it's always string
        const htmlContent = marked(sectionContent) as string;
        reactContent = <div dangerouslySetInnerHTML={{ __html: htmlContent }} />;
      }

      // Build section body with content and file recommendations
      const body: React.ReactNode = (
        <div>
          {renderPedagogyPanel(sectionMeta, openFileInTab)}
          <div
            data-guide-markdown={sectionMeta.id || `section-${index}`}
            style={
              repoAccent ? ({ '--repo-accent': repoAccent } as React.CSSProperties) : undefined
            }
            onClick={(e: React.MouseEvent) => {
              const anchor = (e.target as HTMLElement).closest('a');
              if (!anchor) return;
              const href = anchor.getAttribute('href');
              const repoPath = anchor.getAttribute('data-repo-path');
              const repoOwner = anchor.getAttribute('data-repo-owner') || undefined;
              const repoName = anchor.getAttribute('data-repo-name') || undefined;
              const searchPattern = anchor.getAttribute('data-search-pattern') || undefined;
              const scrollToLineAttr = anchor.getAttribute('data-scroll-to-line');
              const scrollToLine = scrollToLineAttr ? parseInt(scrollToLineAttr, 10) : undefined;
              const symbolScopeAttr = anchor.getAttribute('data-symbol-scope') || '';
              const symbolScope = symbolScopeAttr
                ? symbolScopeAttr.split('|||').filter(Boolean)
                : undefined;

              if (repoPath) {
                e.preventDefault();
                debugLog('[explorar:guide-link] repo-target', {
                  sectionId: sectionMeta.id,
                  repoPath,
                  searchPattern,
                  scrollToLine,
                  symbolScope,
                  repoOwner,
                  repoName,
                  href,
                });
                openFileInTab(
                  repoPath,
                  searchPattern,
                  scrollToLine,
                  symbolScope,
                  repoOwner && repoName ? { owner: repoOwner, repo: repoName } : undefined
                );
                return;
              }

              if (!href || href.startsWith('http://') || href.startsWith('https://')) {
                return;
              }

              e.preventDefault();

              const explicitTarget = href.startsWith('#') ? null : parseRepoNavigationTarget(href);
              if (explicitTarget) {
                debugLog('[explorar:guide-link] explicit-target', {
                  sectionId: sectionMeta.id,
                  href,
                  explicitTarget,
                });
                openFileInTab(
                  explicitTarget.path,
                  explicitTarget.searchPattern,
                  explicitTarget.scrollToLine,
                  symbolScope,
                  explicitTarget.owner && explicitTarget.repo
                    ? { owner: explicitTarget.owner, repo: explicitTarget.repo }
                    : undefined
                );
                return;
              }

              if (searchPattern && symbolScope && symbolScope.length > 0) {
                debugLog('[explorar:guide-link] scoped-symbol-target', {
                  sectionId: sectionMeta.id,
                  searchPattern,
                  symbolScope,
                });
                openFileInTab(symbolScope[0], searchPattern, scrollToLine, symbolScope);
                return;
              }

              if (!href.startsWith('#')) {
                debugLog('[explorar:guide-link] raw-href', {
                  sectionId: sectionMeta.id,
                  href,
                });
                openFileInTab(href);
              }
            }}
          >
            {reactContent}
          </div>
          {hasRecommendationBoxes &&
            createFileRecommendationsComponent(
              readingOrderRecommendations,
              sectionMeta.fileRecommendations?.docs || [],
              sourceRecommendations,
              sectionMeta.fileRecommendations?.directories || [],
              openFileInTab
            )}
        </div>
      );

      const guideSection: GuideSection = {
        id: sectionMeta.id,
        title: sectionMeta.title,
        body,
        narrativePaths,
        difficulty: sectionMeta.difficulty,
        learningGoals: sectionMeta.learningGoals,
        questions: sectionMeta.questions,
        trace: sectionMeta.trace,
        fileRecommendations: sectionMeta.fileRecommendations,
        graph,
      };

      return guideSection;
    })
    .filter((section): section is GuideSection => section !== null);

  return guideSections;
}
