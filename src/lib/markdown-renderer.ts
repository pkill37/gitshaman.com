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
} from '@/lib/markdown-navigation';

interface RepoMarkdownRendererOptions {
  baseFilePath?: string;
  linkRepoReferences?: boolean;
  symbolScopePaths?: string[];
  allowMermaid?: boolean;
  escapeHtmlBlocks?: boolean;
}

function isLikelySymbolCode(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (/[\s/\\]/.test(trimmed)) return false;
  if (/^(true|false|null|undefined|\d+)$/i.test(trimmed)) return false;
  return /^(?:[A-Za-z_]\w*|[A-Za-z_]\w*::[A-Za-z_]\w*)(?:\(\))?$/.test(trimmed);
}

export function createRepoMarkdownRenderer(options: RepoMarkdownRendererOptions = {}) {
  const renderer = new marked.Renderer();
  const linkRepoReferences = options.linkRepoReferences ?? true;
  const symbolScopePaths = options.symbolScopePaths ?? [];

  if (options.escapeHtmlBlocks) {
    renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
  }

  renderer.code = ({ text, lang }: Tokens.Code) => {
    const language = lang?.match(/^\S+/)?.[0].toLowerCase();
    if (options.allowMermaid && language === 'mermaid') {
      return `<div class="mermaid" data-mermaid-diagram>${escapeHtml(text)}</div>`;
    }

    return renderHighlightedCodeBlock(text, language);
  };

  renderer.link = function ({ href, title, tokens }: Tokens.Link) {
    const safeHref = href?.trim() || '#';
    const renderedText = this.parser.parseInline(tokens);
    const linkText = renderedText.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

    if (hasUnsafeScheme(safeHref)) {
      return `<span>${renderedText}</span>`;
    }

    if (safeHref.startsWith('#')) {
      return `<a href="${escapeHtml(safeHref)}"${titleAttr}>${linkText}</a>`;
    }

    const navigationTarget = parseMarkdownNavigationTarget(safeHref, options.baseFilePath, {
      linkText,
      title: title ?? undefined,
    });

    if (navigationTarget?.kind === 'repo-file') {
      if (!linkRepoReferences) return linkText;
      return `<a href="#" ${getRepoLinkAttributes(navigationTarget)}${titleAttr}>${getExternalRepoIconHtml(navigationTarget)}${linkText}</a>`;
    }

    const targetAttr = isExternalHref(safeHref) ? ' target="_blank" rel="noreferrer"' : '';
    return `<a href="${escapeHtml(safeHref)}"${titleAttr}${targetAttr}>${linkText}</a>`;
  };

  renderer.codespan = ({ text: code }: Tokens.Codespan) => {
    const decodedCode = decodeHtmlEntities(code);
    const repoTarget = parseRepoNavigationTarget(decodedCode, options.baseFilePath);
    const codeHtml = `<code>${escapeHtml(decodedCode)}</code>`;

    if (!repoTarget) {
      if (symbolScopePaths.length > 0 && isLikelySymbolCode(decodedCode)) {
        return `<a href="#" class="inline-code-link" data-search-pattern="${escapeHtml(
          decodedCode.trim()
        )}" data-symbol-scope="${escapeHtml(symbolScopePaths.join('|||'))}">${codeHtml}</a>`;
      }
      return codeHtml;
    }

    if (!linkRepoReferences) return codeHtml;
    return `<a href="#" class="inline-code-link" ${getRepoLinkAttributes(repoTarget)}>${getExternalRepoIconHtml(repoTarget)}${codeHtml}</a>`;
  };

  return renderer;
}
