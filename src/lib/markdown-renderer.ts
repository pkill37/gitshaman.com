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
} from '@/lib/markdown-navigation';

interface RepoMarkdownRendererOptions {
  baseFilePath?: string;
  linkRepoReferences?: boolean;
  allowMermaid?: boolean;
  escapeHtmlBlocks?: boolean;
}

export function createRepoMarkdownRenderer(options: RepoMarkdownRendererOptions = {}) {
  const renderer = new marked.Renderer();
  const linkRepoReferences = options.linkRepoReferences ?? true;

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
    const codeClass = linkText.includes('<code>') ? ' class="inline-code-link"' : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

    if (hasUnsafeScheme(safeHref)) {
      return `<span>${linkText}</span>`;
    }

    if (safeHref.startsWith('#')) {
      return `<a href="${escapeHtml(safeHref)}"${codeClass}${titleAttr}>${linkText}</a>`;
    }

    const navigationTarget = parseMarkdownNavigationTarget(safeHref, options.baseFilePath, {
      linkText,
      title: title ?? undefined,
    });

    if (navigationTarget?.kind === 'repo-file') {
      if (!linkRepoReferences) return linkText;
      return `<a href="#"${codeClass} ${getRepoLinkAttributes(navigationTarget)}${titleAttr}>${getExternalRepoIconHtml(navigationTarget)}${linkText}</a>`;
    }

    const targetAttr = isExternalHref(safeHref) ? ' target="_blank" rel="noreferrer"' : '';
    return `<a href="${escapeHtml(safeHref)}"${codeClass}${titleAttr}${targetAttr}>${linkText}</a>`;
  };

  renderer.codespan = ({ text: code }: Tokens.Codespan) => {
    // Code formatting never implies navigation; authors opt in with Markdown links.
    return `<code>${escapeHtml(decodeHtmlEntities(code))}</code>`;
  };

  return renderer;
}
