import fs from 'fs';
import path from 'path';

export const DOCS_DIR = path.join(process.cwd(), 'docs');
const NON_GUIDE_DOCS = new Set(['common.md', '_template.md', 'README.md']);

export function isGuideMarkdownFile(fileName: string): boolean {
  return fileName.endsWith('.md') && !NON_GUIDE_DOCS.has(fileName) && !fileName.startsWith('_');
}

export function listGuideMarkdownFiles(): string[] {
  return fs.readdirSync(DOCS_DIR).filter(isGuideMarkdownFile).sort();
}
