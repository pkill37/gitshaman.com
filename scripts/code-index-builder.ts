import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import matter from 'gray-matter';

import { findSymbolsInFile, type SymbolReference } from '../src/lib/cross-reference';
import { parseSymbols, type FileSymbols } from '../src/lib/code-analysis';
import { extractEntities, type CodeEntity } from '../src/lib/entity-extraction';
import {
  CODE_INDEX_FILE_NAME,
  CODE_INDEX_MAX_CONTENT_BYTES,
  CODE_INDEX_VERSION,
} from '../src/lib/code-index';

type FileTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
};

type IndexedMember = {
  name: string;
  type: string;
  line: number;
  ordinal: number;
};

type IndexedParameter = {
  name: string;
  type: string;
  ordinal: number;
};

type IndexedSymbol = {
  name: string;
  kind: string;
  language: string;
  signature: string | null;
  doc: string | null;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  isDefinition: number;
  isDeclaration: number;
  content: string;
  members: IndexedMember[];
  parameters: IndexedParameter[];
  references: Array<{ line: number; column: number }>;
};

type IndexedGuideLink = {
  guideId: string;
  sectionId: string;
  sectionTitle: string;
  sectionOrder: number;
  path: string;
  symbolName: string | null;
  line: number | null;
  ordinal: number;
};

type IndexedConceptLink = {
  conceptName: string;
  conceptKind: string;
  targetType: 'file' | 'symbol' | 'guide';
  targetPath: string | null;
  targetSymbolName: string | null;
  guideId: string | null;
  sectionId: string | null;
  weight: number;
};

export type CodeIndexBuildStats = {
  dbPath: string;
  durationMs: number;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  truncatedFileCount: number;
};

export type CodeIndexBuildLogger = {
  log: (message: string) => void;
  warn: (message: string) => void;
};

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Metadata (
  Version INTEGER NOT NULL,
  BuildSignature TEXT NOT NULL,
  CreatedAt TEXT NOT NULL,
  Owner TEXT NOT NULL,
  Repo TEXT NOT NULL,
  Branch TEXT NOT NULL,
  FileCount INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS Files (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Path TEXT NOT NULL UNIQUE,
  Size INTEGER NOT NULL,
  IsDocumentation INTEGER NOT NULL,
  Language TEXT NOT NULL,
  Extension TEXT NOT NULL,
  ContentTruncated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS Symbols (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  FileId INTEGER NOT NULL,
  Name TEXT NOT NULL,
  Kind TEXT NOT NULL,
  Language TEXT NOT NULL,
  Signature TEXT,
  Doc TEXT,
  StartLine INTEGER NOT NULL,
  StartColumn INTEGER NOT NULL,
  EndLine INTEGER NOT NULL,
  EndColumn INTEGER NOT NULL,
  IsDefinition INTEGER NOT NULL,
  IsDeclaration INTEGER NOT NULL,
  FOREIGN KEY (FileId) REFERENCES Files(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Members (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  SymbolId INTEGER NOT NULL,
  Name TEXT NOT NULL,
  Type TEXT NOT NULL,
  Line INTEGER NOT NULL,
  Ordinal INTEGER NOT NULL,
  FOREIGN KEY (SymbolId) REFERENCES Symbols(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Parameters (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  SymbolId INTEGER NOT NULL,
  Name TEXT NOT NULL,
  Type TEXT NOT NULL,
  Ordinal INTEGER NOT NULL,
  FOREIGN KEY (SymbolId) REFERENCES Symbols(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "References" (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  SymbolId INTEGER NOT NULL,
  FileId INTEGER NOT NULL,
  Line INTEGER NOT NULL,
  Column INTEGER NOT NULL,
  FOREIGN KEY (SymbolId) REFERENCES Symbols(Id) ON DELETE CASCADE,
  FOREIGN KEY (FileId) REFERENCES Files(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS FileSearch (
  rowid INTEGER PRIMARY KEY,
  Path TEXT NOT NULL,
  Content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_FileSearch_Path ON FileSearch(Path);

CREATE TABLE IF NOT EXISTS SymbolSearch (
  rowid INTEGER PRIMARY KEY,
  Name TEXT NOT NULL,
  Signature TEXT,
  Doc TEXT,
  Path TEXT NOT NULL,
  Content TEXT NOT NULL,
  Kind TEXT NOT NULL,
  Language TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_SymbolSearch_Name ON SymbolSearch(Name);
CREATE INDEX IF NOT EXISTS idx_SymbolSearch_Path ON SymbolSearch(Path);

CREATE TABLE IF NOT EXISTS Edges (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  SourceFileId INTEGER NOT NULL,
  TargetFileId INTEGER NOT NULL,
  Type TEXT NOT NULL,
  Symbols TEXT NOT NULL,
  FOREIGN KEY (SourceFileId) REFERENCES Files(Id) ON DELETE CASCADE,
  FOREIGN KEY (TargetFileId) REFERENCES Files(Id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_Edges_Source ON Edges(SourceFileId);
CREATE INDEX IF NOT EXISTS idx_Edges_Target ON Edges(TargetFileId);
CREATE INDEX IF NOT EXISTS idx_Edges_Type ON Edges(Type);

CREATE TABLE IF NOT EXISTS GuideLinks (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  GuideId TEXT NOT NULL,
  SectionId TEXT NOT NULL,
  SectionTitle TEXT NOT NULL,
  SectionOrder INTEGER NOT NULL,
  Path TEXT NOT NULL,
  FileId INTEGER,
  SymbolName TEXT,
  SymbolId INTEGER,
  Line INTEGER,
  Ordinal INTEGER NOT NULL,
  FOREIGN KEY (FileId) REFERENCES Files(Id) ON DELETE SET NULL,
  FOREIGN KEY (SymbolId) REFERENCES Symbols(Id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_GuideLinks_Guide ON GuideLinks(GuideId, SectionOrder);
CREATE INDEX IF NOT EXISTS idx_GuideLinks_File ON GuideLinks(FileId);
CREATE INDEX IF NOT EXISTS idx_GuideLinks_Symbol ON GuideLinks(SymbolName);

CREATE TABLE IF NOT EXISTS Concepts (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Name TEXT NOT NULL UNIQUE,
  Kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ConceptLinks (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  ConceptId INTEGER NOT NULL,
  TargetType TEXT NOT NULL,
  FileId INTEGER,
  SymbolId INTEGER,
  GuideId TEXT,
  SectionId TEXT,
  Weight INTEGER NOT NULL,
  FOREIGN KEY (ConceptId) REFERENCES Concepts(Id) ON DELETE CASCADE,
  FOREIGN KEY (FileId) REFERENCES Files(Id) ON DELETE CASCADE,
  FOREIGN KEY (SymbolId) REFERENCES Symbols(Id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ConceptLinks_Concept ON ConceptLinks(ConceptId);
CREATE INDEX IF NOT EXISTS idx_ConceptLinks_File ON ConceptLinks(FileId);
CREATE INDEX IF NOT EXISTS idx_ConceptLinks_Symbol ON ConceptLinks(SymbolId);

CREATE VIEW IF NOT EXISTS Functions AS
SELECT
  s.Id AS SymbolId,
  s.FileId AS FileId,
  f.Path AS Path,
  s.Name AS Name,
  s.Signature AS Signature,
  s.Doc AS Doc,
  s.StartLine AS StartLine,
  s.EndLine AS EndLine,
  s.StartColumn AS StartColumn,
  s.EndColumn AS EndColumn,
  s.Language AS Language,
  s.Kind AS Kind,
  s.IsDefinition AS IsDefinition,
  s.IsDeclaration AS IsDeclaration
FROM Symbols s
JOIN Files f ON f.Id = s.FileId
WHERE s.Kind = 'function';

CREATE VIEW IF NOT EXISTS Structs AS
SELECT
  s.Id AS SymbolId,
  s.FileId AS FileId,
  f.Path AS Path,
  s.Name AS Name,
  s.Signature AS Signature,
  s.Doc AS Doc,
  s.StartLine AS StartLine,
  s.EndLine AS EndLine,
  s.StartColumn AS StartColumn,
  s.EndColumn AS EndColumn,
  s.Language AS Language,
  s.Kind AS Kind,
  s.IsDefinition AS IsDefinition,
  s.IsDeclaration AS IsDeclaration
FROM Symbols s
JOIN Files f ON f.Id = s.FileId
WHERE s.Kind = 'struct';

CREATE VIEW IF NOT EXISTS Classes AS
SELECT
  s.Id AS SymbolId,
  s.FileId AS FileId,
  f.Path AS Path,
  s.Name AS Name,
  s.Signature AS Signature,
  s.Doc AS Doc,
  s.StartLine AS StartLine,
  s.EndLine AS EndLine,
  s.StartColumn AS StartColumn,
  s.EndColumn AS EndColumn,
  s.Language AS Language,
  s.Kind AS Kind,
  s.IsDefinition AS IsDefinition,
  s.IsDeclaration AS IsDeclaration
FROM Symbols s
JOIN Files f ON f.Id = s.FileId
WHERE s.Kind = 'class';

CREATE VIEW IF NOT EXISTS Interfaces AS
SELECT
  s.Id AS SymbolId,
  s.FileId AS FileId,
  f.Path AS Path,
  s.Name AS Name,
  s.Signature AS Signature,
  s.Doc AS Doc,
  s.StartLine AS StartLine,
  s.EndLine AS EndLine,
  s.StartColumn AS StartColumn,
  s.EndColumn AS EndColumn,
  s.Language AS Language,
  s.Kind AS Kind,
  s.IsDefinition AS IsDefinition,
  s.IsDeclaration AS IsDeclaration
FROM Symbols s
JOIN Files f ON f.Id = s.FileId
WHERE s.Kind = 'interface';

CREATE VIEW IF NOT EXISTS Types AS
SELECT
  s.Id AS SymbolId,
  s.FileId AS FileId,
  f.Path AS Path,
  s.Name AS Name,
  s.Signature AS Signature,
  s.Doc AS Doc,
  s.StartLine AS StartLine,
  s.EndLine AS EndLine,
  s.StartColumn AS StartColumn,
  s.EndColumn AS EndColumn,
  s.Language AS Language,
  s.Kind AS Kind,
  s.IsDefinition AS IsDefinition,
  s.IsDeclaration AS IsDeclaration
FROM Symbols s
JOIN Files f ON f.Id = s.FileId
WHERE s.Kind IN ('type', 'typedef', 'enum');

CREATE VIEW IF NOT EXISTS Macros AS
SELECT
  s.Id AS SymbolId,
  s.FileId AS FileId,
  f.Path AS Path,
  s.Name AS Name,
  s.Signature AS Signature,
  s.Doc AS Doc,
  s.StartLine AS StartLine,
  s.EndLine AS EndLine,
  s.StartColumn AS StartColumn,
  s.EndColumn AS EndColumn,
  s.Language AS Language,
  s.Kind AS Kind,
  s.IsDefinition AS IsDefinition,
  s.IsDeclaration AS IsDeclaration
FROM Symbols s
JOIN Files f ON f.Id = s.FileId
WHERE s.Kind = 'macro';
`;

const MAX_CALL_EDGES_PER_FILE = 64;
const MAX_FILES_FOR_HEURISTIC_CALL_EDGES = 5_000;
const CODE_INDEX_MAX_SEARCH_CONTENT_BYTES = 16 * 1024;

type RelationshipIndexes = {
  byBasename: Map<string, string[]>;
  functionFile: Map<string, string>;
  shouldBuildCallEdges: boolean;
};

type EdgeInsertCandidate = {
  source: string;
  target: string;
  type: string;
  symbols: string[];
};

function readFileContent(absolutePath: string): { content: string; truncated: boolean } {
  const fd = fs.openSync(absolutePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(CODE_INDEX_MAX_CONTENT_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, CODE_INDEX_MAX_CONTENT_BYTES, 0);
    const truncated = fs.statSync(absolutePath).size > CODE_INDEX_MAX_CONTENT_BYTES;
    return {
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function getSearchContent(content: string): string {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= CODE_INDEX_MAX_SEARCH_CONTENT_BYTES) {
    return content;
  }

  return content.slice(0, CODE_INDEX_MAX_SEARCH_CONTENT_BYTES);
}

function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase().replace(/^\./, '');
}

function detectLanguage(filePath: string): string {
  const ext = getFileExtension(filePath);
  switch (ext) {
    case 'py':
      return 'python';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'c':
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'h':
    case 'hh':
    case 'hpp':
    case 'hxx':
    case 'inc':
    case 'inl':
      return 'c-family';
    case 'md':
    case 'markdown':
    case 'rst':
    case 'txt':
    case 'adoc':
    case 'asciidoc':
      return 'documentation';
    default:
      return 'text';
  }
}

function extractParameters(signature: string | null): IndexedParameter[] {
  if (!signature) {
    return [];
  }

  const openParen = signature.indexOf('(');
  const closeParen = signature.lastIndexOf(')');
  if (openParen < 0 || closeParen <= openParen + 1) {
    return [];
  }

  const body = signature.slice(openParen + 1, closeParen).trim();
  if (!body || body === 'void') {
    return [];
  }

  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of body) {
    if (char === '(' || char === '<' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === '>' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
    }

    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.flatMap((part, ordinal) => {
    const trimmed = part.replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed === '...') {
      return [];
    }

    const match = trimmed.match(/^(.*?)([A-Za-z_]\w*)$/);
    if (!match) {
      return [{ name: `arg${ordinal + 1}`, type: trimmed, ordinal }];
    }

    const type = match[1].trim().replace(/\s+\*$/, '*');
    const name = match[2];
    return [{ name, type: type || '', ordinal }];
  });
}

function symbolKindToViewKind(symbol: SymbolReference): string {
  switch (symbol.type) {
    case 'typedef':
      return 'type';
    default:
      return symbol.type;
  }
}

function symbolToIndexedSymbol(symbol: SymbolReference): IndexedSymbol {
  const kind = symbolKindToViewKind(symbol);
  const language = 'c-family';
  const signature = symbol.signature?.trim() || null;
  const doc = symbol.documentation?.trim() || null;
  return {
    name: symbol.name,
    kind,
    language,
    signature,
    doc,
    startLine: symbol.line,
    startColumn: symbol.column,
    endLine: symbol.line,
    endColumn: symbol.column + symbol.name.length,
    isDefinition: symbol.isDefinition ? 1 : 0,
    isDeclaration: symbol.isDeclaration ? 1 : 0,
    content: [
      symbol.signature,
      symbol.documentation,
      symbol.members?.map((m) => `${m.name}: ${m.type}`).join('\n'),
    ]
      .filter(Boolean)
      .join('\n')
      .trim(),
    members:
      symbol.members?.map((member, index) => ({
        name: member.name,
        type: member.type,
        line: member.line,
        ordinal: index,
      })) ?? [],
    parameters: extractParameters(signature),
    references: symbol.references.map((reference) => ({
      line: reference.line,
      column: reference.column,
    })),
  };
}

function entityToIndexedSymbol(entity: CodeEntity & { line: number }): IndexedSymbol {
  const signature =
    entity.fields.length > 0
      ? `${entity.kind} ${entity.name} { ${entity.fields
          .map((field) => `${field.name}: ${field.type}`)
          .join('; ')} }`
      : `${entity.kind} ${entity.name}`;

  return {
    name: entity.name,
    kind: entity.kind === 'enum' ? 'type' : entity.kind,
    language: entity.language,
    signature,
    doc: null,
    startLine: entity.line,
    startColumn: 1,
    endLine: entity.line,
    endColumn: Math.max(1, entity.name.length),
    isDefinition: 1,
    isDeclaration: 0,
    content: signature,
    members: entity.fields.map((field, index) => ({
      name: field.name,
      type: field.type,
      line: entity.line,
      ordinal: index,
    })),
    parameters: [],
    references: [],
  };
}

function collectFileEntries(nodes: FileTreeNode[], parentPath: string = ''): string[] {
  const entries: string[] = [];

  for (const node of nodes) {
    const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.type === 'file') {
      if (
        node.name !== 'repo-manifest.json' &&
        node.name !== CODE_INDEX_FILE_NAME &&
        node.name !== 'search-index.json'
      ) {
        entries.push(currentPath);
      }
      continue;
    }

    if (node.children?.length) {
      entries.push(...collectFileEntries(node.children, currentPath));
    }
  }

  return entries;
}

function getGuideMarkdownPath(owner: string, repo: string): string | null {
  const docsPath = path.join(process.cwd(), 'docs', `${owner}_${repo}.md`);
  return fs.existsSync(docsPath) ? docsPath : null;
}

function parseSectionBlocks(content: string): Array<{ frontmatter: string; content: string }> {
  const sections: Array<{ frontmatter: string; content: string }> = [];
  const lines = content.split('\n');
  let index = 0;

  while (index < lines.length) {
    if (lines[index]?.trim() !== '---') {
      index++;
      continue;
    }

    index++;
    while (index < lines.length && lines[index]?.trim() === '') index++;

    const frontmatterLines: string[] = [];
    while (index < lines.length && lines[index]?.trim() !== '---') {
      frontmatterLines.push(lines[index] ?? '');
      index++;
    }

    if (index < lines.length && lines[index]?.trim() === '---') index++;
    while (index < lines.length && lines[index]?.trim() === '') index++;

    const contentLines: string[] = [];
    while (index < lines.length && lines[index]?.trim() !== '---') {
      contentLines.push(lines[index] ?? '');
      index++;
    }

    const frontmatter = frontmatterLines.join('\n').trim();
    if (
      frontmatter.includes('id:') ||
      frontmatter.includes('title:') ||
      frontmatter.includes('fileRecommendations:')
    ) {
      sections.push({
        frontmatter,
        content: contentLines.join('\n').trim(),
      });
    }
  }

  return sections;
}

function normalizeGuidePath(
  rawPath: string
): { path: string; symbolName: string | null; line: number | null } | null {
  const trimmed = rawPath.trim().replace(/^['"]|['"]$/g, '');
  if (
    !trimmed ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('#')
  ) {
    return null;
  }

  const [pathAndMaybeSymbol, hash] = trimmed.split('#', 2);
  const [pathPart, query] = pathAndMaybeSymbol.split('?', 2);
  const pathValue = pathPart.replace(/^\.\//, '');
  if (!pathValue || pathValue.startsWith('#')) {
    return null;
  }

  const params = new URLSearchParams(query ?? '');
  const symbolName = params.get('symbol') ?? params.get('search') ?? null;
  const lineParam = params.get('line') ?? params.get('L') ?? hash?.match(/^L?(\d+)$/)?.[1] ?? null;
  const line = lineParam ? Number(lineParam) : null;

  return {
    path: pathValue,
    symbolName,
    line: Number.isFinite(line) ? line : null,
  };
}

function collectGuidePaths(
  sectionContent: string,
  sectionMeta: Record<string, unknown>
): Array<{
  path: string;
  symbolName: string | null;
  line: number | null;
}> {
  const output: Array<{ path: string; symbolName: string | null; line: number | null }> = [];
  const seen = new Set<string>();
  const push = (rawPath: unknown) => {
    if (typeof rawPath !== 'string') return;
    const normalized = normalizeGuidePath(rawPath);
    if (!normalized) return;
    const key = `${normalized.path}:${normalized.symbolName ?? ''}:${normalized.line ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  };

  const recommendations = sectionMeta.fileRecommendations as
    Record<string, Array<{ path?: unknown }> | undefined> | undefined;
  for (const list of Object.values(recommendations ?? {})) {
    for (const item of list ?? []) {
      push(item.path);
    }
  }

  const markdownLinkRe = /\[[^\]]+\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkRe.exec(sectionContent)) !== null) {
    push(match[1]);
  }

  const codeSpanRe = /`([^`\n]+)`/g;
  while ((match = codeSpanRe.exec(sectionContent)) !== null) {
    push(match[1]);
  }

  return output;
}

function extractGuideLinks(owner: string, repo: string): IndexedGuideLink[] {
  const markdownPath = getGuideMarkdownPath(owner, repo);
  if (!markdownPath) {
    return [];
  }

  const markdown = fs.readFileSync(markdownPath, 'utf8');
  const { data, content } = matter(markdown);
  const guideId = String(data.guideId ?? `${owner}-${repo}`);
  const links: IndexedGuideLink[] = [];

  parseSectionBlocks(content).forEach((section, sectionIndex) => {
    const sectionMeta = matter(`---\n${section.frontmatter}\n---\n`).data as Record<
      string,
      unknown
    >;
    const sectionId = String(sectionMeta.id ?? `section-${sectionIndex + 1}`);
    const sectionTitle = String(sectionMeta.title ?? sectionId);
    const paths = collectGuidePaths(section.content, sectionMeta);
    paths.forEach((target, ordinal) => {
      links.push({
        guideId,
        sectionId,
        sectionTitle,
        sectionOrder: sectionIndex,
        path: target.path,
        symbolName: target.symbolName,
        line: target.line,
        ordinal,
      });
    });
  });

  return links;
}

function normalizeConceptName(name: string): string {
  return name
    .trim()
    .replace(/\(\)$/, '')
    .replace(/^(struct|class|enum)\s+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function shouldIndexConcept(name: string): boolean {
  const normalized = normalizeConceptName(name);
  if (normalized.length < 3 || normalized.length > 80) {
    return false;
  }
  if (/^(the|and|for|with|from|into|this|that|chapter|overview)$/i.test(normalized)) {
    return false;
  }
  return /[A-Za-z]/.test(normalized);
}

function buildRelationshipIndexes(
  symbolsMap: Map<string, FileSymbols>,
  allFilePaths: string[]
): RelationshipIndexes {
  const byBasename = new Map<string, string[]>();
  const functionFile = new Map<string, string>();
  const shouldBuildCallEdges = symbolsMap.size <= MAX_FILES_FOR_HEURISTIC_CALL_EDGES;

  for (const filePath of allFilePaths) {
    const basename = path.basename(filePath);
    const stem = basename.replace(/\.[^.]+$/, '');
    for (const key of [basename, stem]) {
      const paths = byBasename.get(key) ?? [];
      paths.push(filePath);
      byBasename.set(key, paths);
    }
  }

  for (const [filePath, symbols] of symbolsMap) {
    for (const functionName of symbols.functions) {
      if (!functionFile.has(functionName)) {
        functionFile.set(functionName, filePath);
      }
    }
  }

  return {
    byBasename,
    functionFile,
    shouldBuildCallEdges,
  };
}

function collectRelationshipsForFile(
  sourcePath: string,
  symbols: FileSymbols,
  content: string,
  indexes: RelationshipIndexes
): EdgeInsertCandidate[] {
  const relationships: EdgeInsertCandidate[] = [];
  const seen = new Set<string>();
  const addRelationship = (relationship: EdgeInsertCandidate) => {
    if (relationship.source === relationship.target) return;
    const key = `${relationship.source}:${relationship.target}:${relationship.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    relationships.push(relationship);
  };

  for (const rawPath of [...symbols.rawIncludes, ...symbols.rawImports]) {
    const isInclude = symbols.rawIncludes.includes(rawPath);
    const relationshipType = isInclude ? 'includes' : 'imports';
    const basename = path.basename(rawPath);
    const stem = basename.replace(/\.[^.]+$/, '');
    const basenameCandidates = [
      ...(indexes.byBasename.get(basename) ?? []),
      ...(indexes.byBasename.get(stem) ?? []),
    ];
    const candidates = new Set(
      basenameCandidates.filter(
        (filePath) =>
          filePath.endsWith(rawPath) ||
          filePath.endsWith(`${rawPath}.h`) ||
          filePath.endsWith(`${rawPath}.py`) ||
          filePath.endsWith(`${rawPath}.ts`) ||
          path.basename(filePath) === basename ||
          path.basename(filePath) === stem
      )
    );

    for (const targetPath of candidates) {
      addRelationship({
        source: sourcePath,
        target: targetPath,
        type: relationshipType,
        symbols: [rawPath],
      });
    }
  }

  if (!indexes.shouldBuildCallEdges) {
    return relationships;
  }

  const callPattern = /\b([A-Za-z_]\w{3,})\s*\(/g;
  let callEdgeCount = 0;
  let match: RegExpExecArray | null;
  while (callEdgeCount < MAX_CALL_EDGES_PER_FILE && (match = callPattern.exec(content)) !== null) {
    const functionName = match[1];
    const targetPath = indexes.functionFile.get(functionName);
    if (!targetPath || targetPath === sourcePath) {
      continue;
    }
    addRelationship({
      source: sourcePath,
      target: targetPath,
      type: 'calls',
      symbols: [functionName],
    });
    callEdgeCount++;
  }

  return relationships;
}

const DATAFLOW_IGNORED_IDENTIFIERS = new Set([
  'return',
  'sizeof',
  'true',
  'false',
  'NULL',
  'nullptr',
]);

function collectIntraproceduralDefUse(content: string): string[] {
  const relationships: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    if (!seen.has(value)) {
      seen.add(value);
      relationships.push(value);
    }
  };

  for (const line of content.split('\n')) {
    const assignment = line.match(
      /^\s*(?:(?:const|volatile|static|unsigned|signed|struct\s+\w+|[A-Za-z_]\w*)\s+)+(?:\*\s*)?([A-Za-z_]\w*)\s*=\s*(.+?);\s*$/
    );
    if (assignment) {
      const target = assignment[1];
      for (const source of assignment[2].match(/\b[A-Za-z_]\w*\b/g) ?? []) {
        if (source !== target && !DATAFLOW_IGNORED_IDENTIFIERS.has(source)) {
          add(`${source}→${target}`);
        }
      }
      continue;
    }

    const simpleAssignment = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.+?);\s*$/);
    if (simpleAssignment) {
      for (const source of simpleAssignment[2].match(/\b[A-Za-z_]\w*\b/g) ?? []) {
        if (source !== simpleAssignment[1] && !DATAFLOW_IGNORED_IDENTIFIERS.has(source)) {
          add(`${source}→${simpleAssignment[1]}`);
        }
      }
    }

    const returned = line.match(/^\s*return\s+(.+?);\s*$/);
    for (const source of returned?.[1].match(/\b[A-Za-z_]\w*\b/g) ?? []) {
      if (!DATAFLOW_IGNORED_IDENTIFIERS.has(source)) add(`${source}→return`);
    }
  }

  return relationships.slice(0, 200);
}

function flattenSymbols(content: string, filePath: string): IndexedSymbol[] {
  const indexed: IndexedSymbol[] = [];
  const ext = getFileExtension(filePath);

  if (['c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'hxx', 'inc', 'inl'].includes(ext)) {
    for (const symbol of findSymbolsInFile(content, filePath)) {
      if (
        symbol.isDefinition &&
        (symbol.type === 'function' ||
          symbol.type === 'struct' ||
          symbol.type === 'class' ||
          symbol.type === 'typedef' ||
          symbol.type === 'macro')
      ) {
        indexed.push(symbolToIndexedSymbol(symbol));
      }
    }
    return indexed;
  }

  const extractedEntities = extractEntities(filePath, content);
  for (const entity of extractedEntities) {
    indexed.push(entityToIndexedSymbol(entity));
  }
  return indexed;
}

export function buildCodeIndex(
  repoDir: string,
  tree: FileTreeNode[],
  buildSignature: string,
  logger: CodeIndexBuildLogger = console
): CodeIndexBuildStats {
  const startedAt = Date.now();
  const dbPath = path.join(repoDir, CODE_INDEX_FILE_NAME);
  const legacySearchIndexPath = path.join(repoDir, 'search-index.json');
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { force: true });
  }
  if (fs.existsSync(legacySearchIndexPath)) {
    fs.rmSync(legacySearchIndexPath, { force: true });
  }

  logger.log(`   Code index start: ${repoDir}`);
  logger.log(`   Code index database: ${dbPath}`);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.exec(SCHEMA_SQL);

  const insertMetadata = db.prepare(
    'INSERT INTO Metadata(Version, BuildSignature, CreatedAt, Owner, Repo, Branch, FileCount) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertFile = db.prepare(
    'INSERT INTO Files(Path, Size, IsDocumentation, Language, Extension, ContentTruncated) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertSymbol = db.prepare(
    'INSERT INTO Symbols(FileId, Name, Kind, Language, Signature, Doc, StartLine, StartColumn, EndLine, EndColumn, IsDefinition, IsDeclaration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertFileSearch = db.prepare(
    'INSERT INTO FileSearch(rowid, Path, Content) VALUES (?, ?, ?)'
  );
  const insertSymbolSearch = db.prepare(
    'INSERT INTO SymbolSearch(rowid, Name, Signature, Doc, Path, Content, Kind, Language) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertMember = db.prepare(
    'INSERT INTO Members(SymbolId, Name, Type, Line, Ordinal) VALUES (?, ?, ?, ?, ?)'
  );
  const insertParameter = db.prepare(
    'INSERT INTO Parameters(SymbolId, Name, Type, Ordinal) VALUES (?, ?, ?, ?)'
  );
  const insertReference = db.prepare(
    'INSERT INTO "References"(SymbolId, FileId, Line, Column) VALUES (?, ?, ?, ?)'
  );
  const insertEdge = db.prepare(
    'INSERT INTO Edges(SourceFileId, TargetFileId, Type, Symbols) VALUES (?, ?, ?, ?)'
  );
  const insertGuideLink = db.prepare(
    'INSERT INTO GuideLinks(GuideId, SectionId, SectionTitle, SectionOrder, Path, FileId, SymbolName, SymbolId, Line, Ordinal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertConcept = db.prepare(
    'INSERT INTO Concepts(Name, Kind) VALUES (?, ?) ON CONFLICT(Name) DO UPDATE SET Kind = excluded.Kind RETURNING Id'
  );
  const insertConceptLink = db.prepare(
    'INSERT INTO ConceptLinks(ConceptId, TargetType, FileId, SymbolId, GuideId, SectionId, Weight) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const filePaths = collectFileEntries(tree).sort((a, b) => a.localeCompare(b));
  let processed = 0;
  let truncatedFiles = 0;
  let totalSymbols = 0;
  let totalEdges = 0;

  const owner = path.basename(path.dirname(path.dirname(repoDir)));
  const repo = path.basename(path.dirname(repoDir));
  const branch = path.basename(repoDir);
  const fileIdByPath = new Map<string, number>();
  const symbolIdByPathAndName = new Map<string, number>();
  const relationshipSymbolsMap = new Map<string, ReturnType<typeof parseSymbols>>();
  const conceptLinks: IndexedConceptLink[] = [];

  logger.log(`   Code index scan: ${filePaths.length.toLocaleString('en-US')} candidate files`);

  insertMetadata.run(
    CODE_INDEX_VERSION,
    buildSignature,
    new Date().toISOString(),
    owner,
    repo,
    branch,
    filePaths.length
  );

  const batchSize = 100;
  const progressEvery = Math.max(100, Math.floor(filePaths.length / 20));
  let lastProgressAt = 0;
  const batches: Array<{
    filePath: string;
    size: number;
    isDocumentation: boolean;
    language: string;
    extension: string;
    searchContent: string;
    contentTruncated: boolean;
    symbols: IndexedSymbol[];
  }> = [];

  const flushBatch = db.transaction(
    (
      records: Array<{
        filePath: string;
        size: number;
        isDocumentation: boolean;
        language: string;
        extension: string;
        searchContent: string;
        contentTruncated: boolean;
        symbols: IndexedSymbol[];
      }>
    ) => {
      for (const record of records) {
        const fileResult = insertFile.run(
          record.filePath,
          record.size,
          record.isDocumentation ? 1 : 0,
          record.language,
          record.extension,
          record.contentTruncated ? 1 : 0
        );
        const fileId = Number(fileResult.lastInsertRowid);
        fileIdByPath.set(record.filePath, fileId);

        insertFileSearch.run(fileId, record.filePath, record.searchContent);

        for (const symbol of record.symbols) {
          const symbolResult = insertSymbol.run(
            fileId,
            symbol.name,
            symbol.kind,
            symbol.language,
            symbol.signature,
            symbol.doc,
            symbol.startLine,
            symbol.startColumn,
            symbol.endLine,
            symbol.endColumn,
            symbol.isDefinition,
            symbol.isDeclaration
          );
          const symbolId = Number(symbolResult.lastInsertRowid);
          symbolIdByPathAndName.set(`${record.filePath}:${symbol.name}`, symbolId);
          totalSymbols++;

          insertSymbolSearch.run(
            symbolId,
            symbol.name,
            symbol.signature,
            symbol.doc,
            record.filePath,
            symbol.content,
            symbol.kind,
            symbol.language
          );

          for (const member of symbol.members) {
            insertMember.run(symbolId, member.name, member.type, member.line, member.ordinal);
          }

          for (const parameter of symbol.parameters) {
            insertParameter.run(symbolId, parameter.name, parameter.type, parameter.ordinal);
          }

          for (const reference of symbol.references) {
            insertReference.run(symbolId, fileId, reference.line, reference.column);
          }

          if (shouldIndexConcept(symbol.name)) {
            conceptLinks.push({
              conceptName: normalizeConceptName(symbol.name),
              conceptKind: 'symbol',
              targetType: 'symbol',
              targetPath: record.filePath,
              targetSymbolName: symbol.name,
              guideId: null,
              sectionId: null,
              weight: 80,
            });
          }
        }
      }
    }
  );

  for (const relativePath of filePaths) {
    const absolutePath = path.join(repoDir, relativePath);
    try {
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) {
        continue;
      }

      const { content, truncated } = readFileContent(absolutePath);
      const extension = getFileExtension(relativePath);
      const language = detectLanguage(relativePath);
      const symbols = flattenSymbols(content, relativePath);
      const isDocumentation = /\.(md|rst|txt|adoc|asciidoc)$/i.test(relativePath);
      const searchContent = getSearchContent(content);
      const relationshipSymbols = parseSymbols(relativePath, content);
      if (
        relationshipSymbols.functions.length > 0 ||
        relationshipSymbols.rawIncludes.length > 0 ||
        relationshipSymbols.rawImports.length > 0
      ) {
        relationshipSymbolsMap.set(relativePath, relationshipSymbols);
      }

      batches.push({
        filePath: relativePath,
        size: stat.size,
        isDocumentation,
        language,
        extension,
        searchContent,
        contentTruncated: truncated,
        symbols,
      });

      if (truncated) {
        truncatedFiles++;
      }

      processed++;
      if (batches.length >= batchSize) {
        flushBatch(batches);
        batches.length = 0;
      }

      if (processed - lastProgressAt >= progressEvery || processed === filePaths.length) {
        lastProgressAt = processed;
        const percent =
          filePaths.length > 0 ? Math.round((processed / filePaths.length) * 100) : 100;
        logger.log(
          `   Code index files: ${processed.toLocaleString('en-US')}/${filePaths.length.toLocaleString(
            'en-US'
          )} (${percent}%), ${totalSymbols.toLocaleString('en-US')} symbols, ${truncatedFiles.toLocaleString(
            'en-US'
          )} truncated`
        );
      }
    } catch (error) {
      logger.warn(
        `   Skipping code index entry for ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (batches.length > 0) {
    flushBatch(batches);
  }

  logger.log(
    `   Code index relationships: analyzing ${relationshipSymbolsMap.size.toLocaleString('en-US')} file(s) with imports/functions`
  );
  const relationshipIndexes = buildRelationshipIndexes(relationshipSymbolsMap, filePaths);
  const insertEdgeBatch = db.transaction((edgeRecords: EdgeInsertCandidate[]) => {
    for (const edge of edgeRecords) {
      const sourceFileId = fileIdByPath.get(edge.source);
      const targetFileId = fileIdByPath.get(edge.target);
      if (!sourceFileId || !targetFileId) {
        continue;
      }
      insertEdge.run(sourceFileId, targetFileId, edge.type, edge.symbols.join('\n'));
      totalEdges++;
    }
  });

  const edgeBatch: EdgeInsertCandidate[] = [];
  for (const [relativePath, relationshipSymbols] of relationshipSymbolsMap) {
    const absolutePath = path.join(repoDir, relativePath);
    let content = '';
    try {
      content = readFileContent(absolutePath).content;
    } catch {
      content = '';
    }

    edgeBatch.push(
      ...collectRelationshipsForFile(
        relativePath,
        relationshipSymbols,
        content,
        relationshipIndexes
      )
    );
    const defUseRelationships = collectIntraproceduralDefUse(content);
    if (defUseRelationships.length > 0) {
      edgeBatch.push({
        source: relativePath,
        target: relativePath,
        type: 'dataflow',
        symbols: defUseRelationships,
      });
    }

    if (edgeBatch.length >= 1_000) {
      insertEdgeBatch(edgeBatch);
      edgeBatch.length = 0;
      logger.log(`   Code index edges: ${totalEdges.toLocaleString('en-US')} inserted so far`);
    }
  }
  if (edgeBatch.length > 0) {
    insertEdgeBatch(edgeBatch);
  }

  logger.log(`   Code index edges: ${totalEdges.toLocaleString('en-US')} inserted total`);

  const insertDerivedData = db.transaction(
    (guideLinks: IndexedGuideLink[], pendingConceptLinks: IndexedConceptLink[]) => {
      for (const link of guideLinks) {
        const fileId = fileIdByPath.get(link.path) ?? null;
        const symbolId =
          link.symbolName && fileId
            ? (symbolIdByPathAndName.get(`${link.path}:${link.symbolName}`) ?? null)
            : null;
        insertGuideLink.run(
          link.guideId,
          link.sectionId,
          link.sectionTitle,
          link.sectionOrder,
          link.path,
          fileId,
          link.symbolName,
          symbolId,
          link.line,
          link.ordinal
        );

        if (shouldIndexConcept(link.sectionTitle)) {
          pendingConceptLinks.push({
            conceptName: normalizeConceptName(link.sectionTitle),
            conceptKind: 'guide',
            targetType: 'guide',
            targetPath: link.path,
            targetSymbolName: link.symbolName,
            guideId: link.guideId,
            sectionId: link.sectionId,
            weight: 40,
          });
        }
      }

      const seenConceptLinks = new Set<string>();
      for (const link of pendingConceptLinks) {
        if (!shouldIndexConcept(link.conceptName)) {
          continue;
        }

        const fileId = link.targetPath ? (fileIdByPath.get(link.targetPath) ?? null) : null;
        const symbolId =
          link.targetPath && link.targetSymbolName
            ? (symbolIdByPathAndName.get(`${link.targetPath}:${link.targetSymbolName}`) ?? null)
            : null;
        if (link.targetType === 'file' && !fileId) {
          continue;
        }
        if (link.targetType === 'symbol' && !symbolId) {
          continue;
        }

        const conceptRow = insertConcept.get(link.conceptName, link.conceptKind) as
          { Id: number } | undefined;
        const conceptId = Number(conceptRow?.Id ?? 0);
        if (!conceptId) {
          continue;
        }

        const dedupeKey = [
          conceptId,
          link.targetType,
          fileId ?? '',
          symbolId ?? '',
          link.guideId ?? '',
          link.sectionId ?? '',
        ].join(':');
        if (seenConceptLinks.has(dedupeKey)) {
          continue;
        }
        seenConceptLinks.add(dedupeKey);
        insertConceptLink.run(
          conceptId,
          link.targetType,
          fileId,
          symbolId,
          link.guideId,
          link.sectionId,
          link.weight
        );
      }
    }
  );

  const guideLinks = extractGuideLinks(owner, repo);
  logger.log(
    `   Code index derived data: ${guideLinks.length.toLocaleString('en-US')} guide links, ${conceptLinks.length.toLocaleString(
      'en-US'
    )} pending concept links`
  );
  for (const link of guideLinks) {
    if (fileIdByPath.has(link.path)) {
      conceptLinks.push({
        conceptName: normalizeConceptName(path.basename(link.path).replace(/\.[^.]+$/, '')),
        conceptKind: 'file',
        targetType: 'file',
        targetPath: link.path,
        targetSymbolName: null,
        guideId: link.guideId,
        sectionId: link.sectionId,
        weight: 30,
      });
    }
  }
  insertDerivedData(guideLinks, conceptLinks);

  db.prepare('UPDATE Metadata SET FileCount = ?').run(processed);
  logger.log(`   Code index optimize: running ANALYZE`);
  db.exec('ANALYZE;');
  db.close();

  const sizeNote = truncatedFiles > 0 ? `, truncated ${truncatedFiles} large files` : '';
  logger.log(
    `   Code index: ${dbPath} (${processed} files, ${totalSymbols} symbols, ${totalEdges} edges${sizeNote})`
  );
  return {
    dbPath,
    durationMs: Date.now() - startedAt,
    fileCount: processed,
    symbolCount: totalSymbols,
    edgeCount: totalEdges,
    truncatedFileCount: truncatedFiles,
  };
}
