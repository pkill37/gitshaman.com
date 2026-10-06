'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { marked, type Tokens } from 'marked';
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
  resolveRepoRelativePath,
} from '@/lib/markdown-navigation';

interface MarkdownPreviewProps {
  content: string;
  filePath: string;
  isLoading: boolean;
  onOpenFile?: (
    path: string,
    searchPattern?: string,
    scrollToLine?: number,
    searchScope?: string[],
    repoTarget?: { owner: string; repo: string }
  ) => void;
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  filePath,
  isLoading,
  onOpenFile,
}) => {
  const articleRef = useRef<HTMLElement | null>(null);

  const html = useMemo(() => {
    const renderer = new marked.Renderer();

    renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);

    renderer.code = ({ text, lang }: Tokens.Code) => {
      const language = lang?.match(/^\S+/)?.[0].toLowerCase();
      if (language === 'mermaid') {
        return `<div class="mermaid" data-mermaid-diagram>${escapeHtml(text)}</div>`;
      }

      return renderHighlightedCodeBlock(text, language);
    };

    renderer.link = function ({ href, title, tokens }: Tokens.Link) {
      const safeHref = href?.trim() || '#';
      // Avoid invalid nested anchors for markdown links around inline-code
      // navigation links (for example, [`symbol`](path:symbol)).
      const renderedText = this.parser.parseInline(tokens);
      const linkText = renderedText.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

      if (hasUnsafeScheme(safeHref)) {
        return `<span>${renderedText}</span>`;
      }

      if (safeHref.startsWith('#')) {
        return `<a href="${escapeHtml(safeHref)}"${titleAttr}>${linkText}</a>`;
      }

      const navigationTarget = parseMarkdownNavigationTarget(safeHref, filePath, {
        linkText,
        title: title ?? undefined,
      });
      if (navigationTarget?.kind === 'repo-file') {
        return `<a href="#" ${getRepoLinkAttributes(navigationTarget)}${titleAttr}>${getExternalRepoIconHtml(navigationTarget)}${linkText}</a>`;
      }

      const targetAttr = isExternalHref(safeHref) ? ' target="_blank" rel="noreferrer"' : '';
      return `<a href="${escapeHtml(safeHref)}"${titleAttr}${targetAttr}>${linkText}</a>`;
    };

    renderer.codespan = ({ text: code }: Tokens.Codespan) => {
      const decodedCode = decodeHtmlEntities(code);
      const repoTarget = parseRepoNavigationTarget(decodedCode, filePath);
      const codeHtml = `<code>${escapeHtml(decodedCode)}</code>`;
      if (!repoTarget) {
        return codeHtml;
      }

      return `<a href="#" class="inline-code-link" ${getRepoLinkAttributes(repoTarget)}>${getExternalRepoIconHtml(repoTarget)}${codeHtml}</a>`;
    };

    renderer.image = function ({ href, title, text, tokens }: Tokens.Image) {
      const safeHref = href?.trim() || '';
      if (!safeHref || hasUnsafeScheme(safeHref)) {
        return '';
      }

      const repoPath = resolveRepoRelativePath(filePath, safeHref);
      const src = repoPath ? '#' : escapeHtml(safeHref);
      const repoAttr = repoPath ? ` data-repo-path="${escapeHtml(repoPath)}"` : '';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      const altText = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
      const altAttr = escapeHtml(altText || '');
      return `<img src="${src}" alt="${altAttr}"${titleAttr}${repoAttr} />`;
    };

    marked.setOptions({
      gfm: true,
      breaks: true,
      renderer,
    });

    return marked.parse(content) as string;
  }, [content, filePath]);

  useEffect(() => {
    const root = articleRef.current;
    const diagrams = root
      ? Array.from(root.querySelectorAll<HTMLElement>('[data-mermaid-diagram]'))
      : [];
    if (diagrams.length === 0) {
      return;
    }

    let isCancelled = false;

    import('mermaid')
      .then(({ default: mermaid }) => {
        if (isCancelled) {
          return;
        }

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
        });

        return mermaid.run({ nodes: diagrams });
      })
      .catch((error) => {
        for (const diagram of diagrams) {
          diagram.setAttribute('data-mermaid-error', 'true');
        }
        console.error('Failed to render Mermaid diagram', error);
      });

    return () => {
      isCancelled = true;
    };
  }, [html]);

  if (isLoading) {
    return (
      <div className="vscode-editor">
        <div className="vscode-loading">
          <div className="vscode-spinner" />
          <div>Loading markdown preview...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="vscode-editor" style={{ overflow: 'auto' }}>
      <div
        style={{
          maxWidth: '920px',
          margin: '0 auto',
          padding: '32px 40px 48px',
          color: 'var(--vscode-editor-foreground, #d4d4d4)',
          lineHeight: 1.7,
          fontSize: '15px',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--vscode-text-muted, #999)',
            marginBottom: '20px',
          }}
        >
          Markdown Preview
        </div>
        <article
          ref={articleRef}
          data-markdown-preview={filePath}
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            const anchor = target.closest('a[data-repo-path], img[data-repo-path]');
            if (!anchor) {
              return;
            }

            const repoPath = anchor.getAttribute('data-repo-path');
            if (!repoPath || !onOpenFile) {
              return;
            }

            const searchPattern = anchor.getAttribute('data-search-pattern') || undefined;
            const scrollToLineAttr = anchor.getAttribute('data-scroll-to-line');
            const scrollToLine = scrollToLineAttr ? parseInt(scrollToLineAttr, 10) : undefined;
            const repoOwner = anchor.getAttribute('data-repo-owner') || undefined;
            const repoName = anchor.getAttribute('data-repo-name') || undefined;

            event.preventDefault();
            onOpenFile(
              repoPath,
              searchPattern,
              scrollToLine,
              undefined,
              repoOwner && repoName ? { owner: repoOwner, repo: repoName } : undefined
            );
          }}
          style={{
            wordBreak: 'break-word',
          }}
        />
      </div>
    </div>
  );
};

export default MarkdownPreview;
