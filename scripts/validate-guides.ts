/**
 * Validates that all docs/*.md guide files have correct section frontmatter.
 *
 * Checks:
 * - Doc-level frontmatter has owner, repo, defaultOpenIds
 * - Every section has id and title
 * - Every id in defaultOpenIds has a matching section id
 * - Every ```chapter-graph block has valid edge syntax and no duplicate edges
 */
import fs from 'fs';
import path from 'path';
import { DOCS_DIR, listGuideMarkdownFiles } from './guide-docs';
import { validateGuideMarkdown } from './guide-validation';
export { parseSectionIds, validateChapterGraph, validateGuideMarkdown } from './guide-validation';
export type { SectionMeta, GuideValidationResult } from './guide-validation';

export function main(): number {
  let errors = 0;

  const files = listGuideMarkdownFiles();

  for (const file of files) {
    const filepath = path.join(DOCS_DIR, file);
    const raw = fs.readFileSync(filepath, 'utf-8');
    const { errors: fileErrors, sections, graphBlocks } = validateGuideMarkdown(raw);

    if (fileErrors.length > 0) {
      console.error(`\n❌ ${file}:`);
      for (const err of fileErrors) {
        console.error(`   • ${err}`);
      }
      errors += fileErrors.length;
    } else {
      const chapterCount = sections.filter((s) => s.id !== 'learning-path').length;
      const graphCount = graphBlocks.length;
      console.log(
        `✓ ${file} (${chapterCount} chapters, ${graphCount} chapter-graph${graphCount !== 1 ? 's' : ''})`
      );
    }
  }

  if (errors > 0) {
    console.error(`\n${errors} guide validation error(s) found.`);
    return 1;
  } else {
    console.log(`\nAll ${files.length} guide files valid.`);
    return 0;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
