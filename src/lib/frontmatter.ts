import { load } from 'js-yaml';

/** Parse YAML metadata without importing filesystem-dependent modules into the browser. */
export function parseFrontmatter(markdown: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(markdown);
  if (!match || match.index !== 0) return { data: {}, content: markdown };

  const data: unknown = load(match[1]);
  if (data != null && (typeof data !== 'object' || Array.isArray(data))) {
    throw new Error('Guide frontmatter must be a YAML mapping');
  }
  return {
    data: (data as Record<string, unknown> | null) ?? {},
    content: markdown.slice(match[0].length),
  };
}
