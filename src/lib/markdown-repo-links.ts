import { marked, type Token } from 'marked';
import { parseRepoNavigationTarget } from './markdown-navigation';

/** Collect authored navigation links, excluding inline code, examples, and images. */
export function collectMarkdownRepoLinks(markdown: string): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      // An image's alt text may contain link tokens, but they are not rendered
      // as navigation. Do not turn them into file cards or validation targets.
      if (token.type === 'image') continue;
      if (token.type === 'link') {
        if (parseRepoNavigationTarget(token.href)) {
          links.push({ href: token.href, label: token.text });
        }
      } else if (token.type === 'list') {
        for (const item of token.items) visit(item.tokens);
      } else if (token.type === 'table') {
        for (const cell of token.header) visit(cell.tokens);
        for (const row of token.rows) {
          for (const cell of row) visit(cell.tokens);
        }
      } else if ('tokens' in token && token.tokens) {
        visit(token.tokens);
      }
    }
  };
  visit(marked.lexer(markdown));
  return links;
}
