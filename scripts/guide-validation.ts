import matter from 'gray-matter';
import {
  extractFencedBlocks,
  extractSectionFrontmatterBlocks,
  parseFrontmatterTitleFields,
} from './guide-markdown-utils';

export interface SectionMeta {
  id?: string;
  title?: string;
}

export interface GuideValidationResult {
  errors: string[];
  sections: SectionMeta[];
  graphBlocks: Array<{ code: string; line: number }>;
}

/** Split content into sections by --- delimiter pairs, returning frontmatter strings */
export function parseSectionIds(content: string): SectionMeta[] {
  return extractSectionFrontmatterBlocks(content)
    .map(({ frontmatter }) => parseFrontmatterTitleFields(frontmatter))
    .filter((section) => section.id || section.title);
}

/** Edge syntax: `source -> target : label` (label is required) */
const EDGE_RE = /^(\S+)\s*->\s*(\S+)\s*:\s*(.+)$/;

/**
 * Validate a chapter-graph block.
 * Returns an array of error strings (empty = valid).
 */
export function validateChapterGraph(graph: string, blockLine: number): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  graph
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, idx) => {
      const lineNum = blockLine + idx;
      if (!EDGE_RE.test(line)) {
        errors.push(
          `line ${lineNum}: invalid edge syntax (expected "source -> target : label"): ${line}`
        );
        return;
      }
      const m = line.match(EDGE_RE)!;
      const [, src, tgt] = m;
      const key = `${src} -> ${tgt}`;
      if (seen.has(key)) {
        errors.push(`line ${lineNum}: duplicate edge: ${key}`);
      }
      seen.add(key);
      if (src === tgt) {
        errors.push(`line ${lineNum}: self-loop: ${key}`);
      }
    });

  return errors;
}

export function validateGuideMarkdown(raw: string): GuideValidationResult {
  const { data: frontmatter, content } = matter(raw);

  const errors: string[] = [];

  // 1. Doc-level frontmatter checks
  if (!frontmatter.owner) errors.push('missing doc frontmatter: owner');
  if (!frontmatter.repo) errors.push('missing doc frontmatter: repo');
  if (!Array.isArray(frontmatter.defaultOpenIds) || frontmatter.defaultOpenIds.length === 0) {
    errors.push('missing or empty doc frontmatter: defaultOpenIds');
  }

  // 2. Section frontmatter checks
  const sections = parseSectionIds(content);

  if (sections.length === 0) {
    errors.push('no section frontmatter found — chapters will not open correctly');
  }

  for (const section of sections) {
    if (!section.id) errors.push(`section missing id (title: "${section.title}")`);
    if (!section.title) errors.push(`section missing title (id: "${section.id}")`);
  }

  // 3. defaultOpenIds coverage check
  if (Array.isArray(frontmatter.defaultOpenIds)) {
    const sectionIds = new Set(sections.map((s) => s.id));
    for (const openId of frontmatter.defaultOpenIds) {
      if (!sectionIds.has(openId)) {
        errors.push(
          `defaultOpenIds contains "${openId}" but no section has that id — chapter will never auto-open`
        );
      }
    }
  }

  // 4. Chapter-graph edge syntax check
  const graphBlocks = extractFencedBlocks(raw, 'chapter-graph');
  for (const block of graphBlocks) {
    if (!block.code.trim()) {
      errors.push(`chapter-graph block at line ${block.line}: empty graph`);
      continue;
    }
    const graphErrors = validateChapterGraph(block.code, block.line + 1);
    errors.push(...graphErrors);
  }

  return { errors, sections, graphBlocks };
}
