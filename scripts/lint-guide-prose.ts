import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import writeGood from 'write-good';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

interface MarkdownNode {
  type: string;
  value?: string;
  position: {
    start: { offset: number };
    end: { offset: number };
  };
  children?: MarkdownNode[];
}

interface ProseBlock {
  text: string;
  offsets: number[];
}

export interface GuideProseDiagnostic {
  file: string;
  lineNumber: number;
  column: number;
  message: string;
  excerpt: string;
}

const weakInstructionPatterns = [
  {
    pattern:
      /\b(?:you should|you can|you may want to|you might want to|try to|it is useful to|it can be useful to)\b/gi,
    message: 'Use direct guide voice: prefer an imperative verb over hedged instruction.',
  },
  {
    pattern: /\b(?:in order to|due to the fact that|the fact that)\b/gi,
    message: 'Tighten wordy phrasing.',
  },
];

const preferredReplacements = [
  {
    pattern: /\btake a look at\b/gi,
    message: 'Prefer "inspect", "open", "trace", or "compare".',
  },
  {
    pattern: /\bdive into\b/gi,
    message: 'Prefer a concrete action such as "open", "trace", "inspect", or "read".',
  },
  {
    pattern: /\bkeep in mind\b/gi,
    message: 'State the constraint directly.',
  },
  {
    pattern: /\bnote that\b/gi,
    message: 'Usually removable; make the sentence itself carry the emphasis.',
  },
];

// Preserve offsets while removing document and chapter metadata. Code blocks are
// handled by the Markdown parser, including tilde fences and indented code.
function maskMetadata(markdown: string) {
  const mask = (text: string) => text.replace(/[^\r\n]/g, ' ');
  const withoutHeader = markdown.replace(/^---\r?\n[\s\S]*?^---[ \t]*(?=\r?$)/m, (match, offset) =>
    offset === 0 ? mask(match) : match
  );
  const codeRanges: Array<[number, number]> = [];
  const findCode = (node: MarkdownNode) => {
    if (node.type === 'code' || node.type === 'html') {
      codeRanges.push([node.position.start.offset, node.position.end.offset]);
    }
    for (const child of node.children ?? []) findCode(child);
  };
  findCode(fromMarkdown(withoutHeader, markdownOptions) as MarkdownNode);
  return withoutHeader.replace(/^---\r?\n(?=id:)[\s\S]*?^---[ \t]*(?=\r?$)/gm, (match, offset) =>
    codeRanges.some(([start, end]) => offset >= start && offset < end) ? match : mask(match)
  );
}

const markdownOptions = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };

function proseBlocks(markdown: string) {
  const tree = fromMarkdown(maskMetadata(markdown), markdownOptions) as MarkdownNode;
  const blocks: ProseBlock[] = [];

  function collect(node: MarkdownNode, block: ProseBlock) {
    if (node.type === 'text') {
      const start = node.position.start.offset;
      const raw = markdown.slice(start, node.position.end.offset);
      // Decode escapes/entities without losing their original source positions.
      const pattern =
        /\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]|&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);|\r\n/gi;
      let cursor = 0;
      let decodedRaw = '';
      const decodedOffsets: number[] = [];
      const append = (text: string, offset: number, literal = false) => {
        for (let i = 0; i < text.length; i++) {
          decodedRaw += text[i];
          decodedOffsets.push(start + offset + (literal ? i : 0));
        }
      };
      for (const match of raw.matchAll(pattern)) {
        append(raw.slice(cursor, match.index), cursor, true);
        const decoded =
          match[0] === '\r\n'
            ? '\n'
            : (extractFirstTextValue(fromMarkdown(match[0]) as MarkdownNode) ?? match[0]);
        append(decoded, match.index);
        cursor = match.index + match[0].length;
      }
      append(raw.slice(cursor), cursor, true);
      // Text positions can span quote/list prefixes on continuation lines.
      // Align the parser's rendered value with the decoded source to skip them.
      cursor = 0;
      for (const character of (node.value ?? '').replace(/\r\n?/g, '\n').split('')) {
        const index = decodedRaw.indexOf(character, cursor);
        if (index < 0) throw new Error('Cannot map Markdown text to its source position.');
        block.text += character;
        block.offsets.push(decodedOffsets[index]);
        cursor = index + 1;
      }
    } else if (
      node.type === 'inlineCode' ||
      node.type === 'image' ||
      node.type === 'imageReference'
    ) {
      // A code/image boundary must not join unrelated prose into a phrase.
      block.text += '\uFFFC';
      block.offsets.push(node.position.start.offset);
    } else if (node.type === 'break') {
      block.text += ' ';
      block.offsets.push(node.position.start.offset);
    } else if (node.children) {
      for (const child of node.children) collect(child, block);
    }
  }

  function visit(node: MarkdownNode) {
    if (['paragraph', 'heading', 'tableCell'].includes(node.type)) {
      const block: ProseBlock = { text: '', offsets: [] };
      collect(node, block);
      // Normalize rendered whitespace for all rules while retaining source offsets.
      const normalized: ProseBlock = { text: '', offsets: [] };
      for (let i = 0; i < block.text.length; i++) {
        const character = /\s/.test(block.text[i]) ? ' ' : block.text[i];
        if (character === ' ' && normalized.text.endsWith(' ')) continue;
        normalized.text += character;
        normalized.offsets.push(block.offsets[i]);
      }
      block.text = normalized.text;
      block.offsets = normalized.offsets;
      blocks.push(block);
    } else if (node.children) {
      for (const child of node.children) visit(child);
    }
  }
  visit(tree);
  return blocks;
}

function extractFirstTextValue(node: MarkdownNode): string | undefined {
  if (node.type === 'text') return node.value;
  for (const child of node.children ?? []) {
    const value = extractFirstTextValue(child);
    if (value !== undefined) return value;
  }
  return undefined;
}

// Retain the original technical vocabulary exceptions and the language name Objective-C.
// Match whole terms ourselves: write-good's whitelist skips offset zero and
// suppresses substring matches in unrelated words (e.g. "simply" vs "simply-typed").
const technicalTerms =
  /\b(?:read-only|user-space|kernel-space|single|only|simple|simply-typed|Objective-C)\b/gi;

export function lintMarkdown(file: string, markdown: string): GuideProseDiagnostic[] {
  const diagnostics: GuideProseDiagnostic[] = [];
  const lineStarts = [0];
  for (let i = 0; i < markdown.length; i++) {
    if (markdown[i] === '\n') lineStarts.push(i + 1);
  }
  for (const block of proseBlocks(markdown)) {
    const add = (index: number, length: number, message: string) => {
      const offset = block.offsets[index];
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      diagnostics.push({
        file,
        lineNumber: line + 1,
        column: offset - lineStarts[line] + 1,
        message,
        excerpt: block.text.slice(index, index + length),
      });
    };
    for (const rule of [...weakInstructionPatterns, ...preferredReplacements]) {
      const pattern = new RegExp(rule.pattern.source.replaceAll(' ', '\\s+'), rule.pattern.flags);
      for (const match of block.text.matchAll(pattern))
        add(match.index ?? 0, match[0].length, rule.message);
    }
    const exceptions = [...block.text.matchAll(technicalTerms)];
    for (const suggestion of writeGood(block.text, { passive: false })) {
      if (
        exceptions.some(
          (match) =>
            suggestion.index >= match.index &&
            suggestion.index + suggestion.offset <= match.index + match[0].length
        )
      )
        continue;
      add(suggestion.index, suggestion.offset, suggestion.reason);
    }
  }
  return diagnostics.filter(
    (diagnostic, index) =>
      !diagnostics
        .slice(0, index)
        .some(
          (previous) =>
            previous.lineNumber === diagnostic.lineNumber &&
            previous.column === diagnostic.column &&
            previous.excerpt === diagnostic.excerpt
        )
  );
}

export function lintFiles(
  fileNames: string[],
  { docsDir = join(process.cwd(), 'docs') }: { docsDir?: string } = {}
) {
  return fileNames.flatMap((file) => lintMarkdown(file, readFileSync(join(docsDir, file), 'utf8')));
}

export function formatDiagnostics(diagnostics: GuideProseDiagnostic[]) {
  return diagnostics.map(
    (diagnostic) =>
      `${join('docs', diagnostic.file)}:${diagnostic.lineNumber}:${diagnostic.column} ${diagnostic.message} (${diagnostic.excerpt})`
  );
}

export function run() {
  const docsDir = join(process.cwd(), 'docs');
  const files = readdirSync(docsDir, { recursive: true })
    .filter(
      (file): file is string =>
        typeof file === 'string' && file.endsWith('.md') && !/(^|[/\\])_template\.md$/.test(file)
    )
    .sort();
  if (files.length === 0) {
    console.error('No guide Markdown files found in docs/.');
    return 1;
  }
  const diagnostics = lintFiles(files, { docsDir });
  if (diagnostics.length > 0) {
    for (const line of formatDiagnostics(diagnostics)) console.log(line);
    console.log(`\n${diagnostics.length} guide prose issue(s) found.`);
    return 1;
  }
  console.log(`Validated ${files.length} guide files for direct, command-ready prose.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
