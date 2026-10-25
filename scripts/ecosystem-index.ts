import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import yaml from 'js-yaml';
import { CURATED_REPOS } from '../src/lib/curated-repos';
import { parseRepoNavigationTarget } from '../src/lib/markdown-navigation';
import {
  mergeRelationships,
  type Relationship,
  type SourceReference,
} from '../src/features/ecosystem/model';
import { listGuideMarkdownFiles } from './guide-docs';

export function extractReferences(raw: string, document: string): Relationship[] {
  const result: Relationship[] = [];
  let owner = '',
    repo = '',
    chapter: string | undefined;
  let metadata = false;
  let block: string[] = [];
  let blockStart = 0;
  const lines = raw.split('\n');
  function add(
    value: string,
    line: number,
    kind: SourceReference['kind'],
    text?: string,
    title?: string
  ) {
    const target = parseRepoNavigationTarget(value, undefined, { linkText: text, title });
    if (!target?.owner || !target.repo || !owner || !repo) return;
    result.push({
      from: `${owner}/${repo}`.toLowerCase(),
      to: `${target.owner}/${target.repo}`.toLowerCase(),
      kind: 'reference',
      label: 'Guide reference',
      sources: [{ document, chapter, line, kind, target }],
    });
  }
  let metadataPathCursor = 0;
  function visitMetadata(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'path' && typeof child === 'string') {
        const offset = block.findIndex(
          (text, index) =>
            index >= metadataPathCursor && /^\s*-?\s*path:/.test(text) && text.includes(child)
        );
        metadataPathCursor = offset + 1;
        const description =
          'description' in value && typeof value.description === 'string'
            ? value.description
            : undefined;
        add(
          child,
          offset >= 0 ? blockStart + offset + 1 : blockStart + 1,
          'recommendation',
          undefined,
          description
        );
      } else visitMetadata(child);
    }
  }
  let prose: string[] = [];
  let proseStart = 0;
  function flushProse() {
    const tree = fromMarkdown(prose.join('\n'));
    const definitions = new Map<string, string>();
    function definitionsWalk(node: typeof tree | (typeof tree.children)[number]) {
      if (node.type === 'definition') definitions.set(node.identifier, node.url);
      if ('children' in node) node.children.forEach((child) => definitionsWalk(child));
    }
    definitionsWalk(tree);
    function textContent(node: typeof tree | (typeof tree.children)[number]): string {
      if ('children' in node) return node.children.map(textContent).join('');
      return 'value' in node ? node.value : '';
    }
    function walk(node: typeof tree | (typeof tree.children)[number]) {
      if (node.type === 'link')
        add(
          node.url,
          proseStart + (node.position?.start.line ?? 1),
          'prose',
          textContent(node),
          node.title ?? undefined
        );
      if (node.type === 'linkReference') {
        const url = definitions.get(node.identifier);
        if (url)
          add(url, proseStart + (node.position?.start.line ?? 1), 'prose', textContent(node));
      }
      if ('children' in node) node.children.forEach((child) => walk(child));
    }
    walk(tree);
    prose = [];
  }
  let fence = '';
  lines.forEach((line, index) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (!metadata && marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        line.trim() === marker[1]
      )
        fence = '';
    }
    if (
      !fence &&
      line.trim() === '---' &&
      (metadata ||
        /^(?:curatedRepoId|owner|repo|guideId|id|title):/.test(
          lines.slice(index + 1).find((value) => value.trim()) ?? ''
        ))
    ) {
      if (!metadata) {
        flushProse();
        blockStart = index + 1;
      } else {
        const data = yaml.load(block.join('\n')) as Record<string, unknown> | null;
        if (data && typeof data === 'object') {
          if (typeof data.owner === 'string') owner = data.owner;
          if (typeof data.repo === 'string') repo = data.repo;
          if (typeof data.id === 'string') chapter = data.id;
          metadataPathCursor = 0;
          visitMetadata(data);
        }
        block = [];
        proseStart = index + 1;
      }
      metadata = !metadata;
    } else if (metadata) block.push(line);
    else prose.push(line);
  });
  flushProse();
  return mergeRelationships(result);
}
export function generateEcosystemIndex() {
  const references = mergeRelationships(
    listGuideMarkdownFiles().flatMap((file) =>
      extractReferences(fs.readFileSync(`docs/${file}`, 'utf8'), file)
    )
  );
  const lesson =
    fs.readFileSync('docs/common.md', 'utf8').split('<!-- ecosystem-lesson -->')[1]?.trim() ?? '';
  // Only compact references and the shared lesson enter the overview bundle.
  const known = new Set(CURATED_REPOS.map((repo) => `${repo.owner}/${repo.repo}`.toLowerCase()));
  fs.writeFileSync(
    'src/features/ecosystem/generated-index.json',
    JSON.stringify(
      {
        references: references.filter((edge) => known.has(edge.from) && known.has(edge.to)),
        lesson,
      },
      null,
      2
    ) + '\n'
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) generateEcosystemIndex();
