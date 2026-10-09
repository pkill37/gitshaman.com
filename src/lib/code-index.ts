import type {
  SemanticBackendFeature,
  SemanticCapabilityStatus,
  SemanticConfidence,
} from './semantic-backend-contract';

export const CODE_INDEX_VERSION = 4;
export const MIN_SUPPORTED_CODE_INDEX_VERSION = 2;
export const CODE_INDEX_FILE_NAME = 'code-index.sqlite';
export const CODE_INDEX_SEARCH_RESULT_LIMIT = 200;
export const CODE_INDEX_PREVIEW_ENRICH_LIMIT = 20;
export const CODE_INDEX_MAX_CONTENT_BYTES = 64 * 1024;

export type CodeIndexFileMatchType = 'filename' | 'quoted' | 'content';

export interface CodeIndexFileEntry {
  path: string;
  size: number;
  isDocumentation: boolean;
  matchType: CodeIndexFileMatchType;
  relevanceScore: number;
}

export interface CodeIndexMetadata {
  version: number;
  buildSignature: string;
  createdAt: string;
  repo: {
    owner: string;
    repo: string;
    branch: string;
  };
  fileCount: number;
}

export interface CodeIndexDatabaseLike {
  prepare(sql: string): CodeIndexStatementLike;
}

export interface CodeIndexStatementLike {
  bind(values?: Array<string | number | null>): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

export interface LoadedCodeIndex {
  db: CodeIndexDatabaseLike;
  version: number;
  fileCount: number;
  buildSignature: string;
}

export interface SearchPreview {
  line: number;
  column: number;
  preview: string;
}

export interface CodeIndexSymbolEntry {
  symbolId: number;
  fileId: number;
  path: string;
  name: string;
  kind: string;
  language: string;
  signature: string | null;
  doc: string | null;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  isDefinition: boolean;
  isDeclaration: boolean;
}

export interface CodeIndexReferenceEntry {
  symbolId: number;
  path: string;
  line: number;
  column: number;
}

export interface CodeIndexMemberEntry {
  symbolId: number;
  name: string;
  type: string;
  line: number;
  ordinal: number;
}

export interface CodeIndexEdgeEntry {
  sourcePath: string;
  targetPath: string;
  type: string;
  symbols: string[];
  provider: string;
  confidence: SemanticConfidence;
}

export type SemanticGraphKind = 'call' | 'dependency' | 'dataflow' | 'other';

export interface CodeIndexCapabilityEntry {
  language: string;
  feature: SemanticBackendFeature;
  provider: string;
  status: SemanticCapabilityStatus;
  detail: string | null;
}

export interface CodeIndexDiagnosticEntry {
  path: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  provider: string;
}

export interface CodeIndexGuideLinkEntry {
  guideId: string;
  sectionId: string;
  sectionTitle: string;
  path: string;
  symbolName: string | null;
  line: number | null;
}

export interface CodeIndexConceptEntry {
  conceptId: number;
  name: string;
  kind: string;
}

function normalizeSearchTerms(query: string): string[] {
  return (
    query
      .trim()
      .toLowerCase()
      .match(/[a-z0-9_]+/g)
      ?.filter(Boolean)
      .map((term) => term.replace(/"/g, '""')) ?? []
  );
}

function extractQuotedPhrases(query: string): string[] {
  const phrases: string[] = [];
  const regex = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(query)) !== null) {
    const phrase = match[1]?.trim().toLowerCase();
    if (phrase) phrases.push(phrase);
  }
  return phrases;
}

function getFileName(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

function getFileSearchRelevanceScore({
  fileName,
  path,
  content,
  terms,
  quotedPhrases,
  matchType,
}: {
  fileName: string;
  path: string;
  content: string;
  terms: string[];
  quotedPhrases: string[];
  matchType: CodeIndexFileMatchType;
}): number {
  let score = matchType === 'quoted' ? 90 : matchType === 'filename' ? 70 : 30;
  if (terms.some((term) => fileName === term)) score += 20;
  if (terms.some((term) => fileName.startsWith(term))) score += 12;
  score += terms.filter((term) => fileName.includes(term)).length * 6;
  score += terms.filter((term) => path.includes(term)).length * 2;
  score += quotedPhrases.filter((phrase) => content.includes(phrase)).length * 10;
  return Math.min(100, score);
}

function normalizeSemanticFeature(feature: string): SemanticBackendFeature {
  switch (feature) {
    case 'definitions':
      return 'definition';
    case 'definition':
    case 'references':
    case 'hover':
    case 'diagnostics':
    case 'documentSymbols':
    case 'typeMembers':
    case 'includeChains':
    case 'relationships':
    case 'calls':
    case 'dataflow':
      return feature;
    default:
      return 'relationships';
  }
}

export function buildFtsQuery(query: string): string | null {
  const terms = normalizeSearchTerms(query);
  if (terms.length === 0) {
    return null;
  }

  return terms.map((term) => `${term}*`).join(' AND ');
}

export function searchCodeIndexFiles(
  handle: LoadedCodeIndex,
  query: string,
  limit: number = CODE_INDEX_SEARCH_RESULT_LIMIT
): CodeIndexFileEntry[] {
  const terms = normalizeSearchTerms(query);
  const quotedPhrases = extractQuotedPhrases(query);
  if (terms.length === 0) {
    return [];
  }

  const results: CodeIndexFileEntry[] = [];
  const seen = new Set<string>();

  const whereClause = terms
    .map(() => '(lower(f.Path) LIKE ? OR lower(fs.Content) LIKE ?)')
    .join(' AND ');
  const bindValues = terms.flatMap((term) => [`%${term}%`, `%${term}%`]);
  const statement = handle.db.prepare(`
    SELECT
      f.Path AS path,
      f.Size AS size,
      f.IsDocumentation AS isDocumentation,
      fs.Content AS content
    FROM FileSearch fs
    JOIN Files f ON f.Id = fs.rowid
    WHERE ${whereClause}
    LIMIT ?
  `);

  try {
    statement.bind([...bindValues, limit]);
    while (statement.step()) {
      const row = statement.getAsObject();
      const path = String(row.path ?? '');
      if (!path || seen.has(path)) {
        continue;
      }
      seen.add(path);

      const fileName = getFileName(path).toLowerCase();
      const pathLower = path.toLowerCase();
      const contentLower = String(row.content ?? '').toLowerCase();

      let matchType: CodeIndexFileMatchType = 'content';
      if (quotedPhrases.length > 0) {
        if (quotedPhrases.some((phrase) => contentLower.includes(phrase))) {
          matchType = 'quoted';
        }
      }
      if (matchType === 'content') {
        if (terms.some((term) => fileName.includes(term))) {
          matchType = 'filename';
        } else if (terms.some((term) => pathLower.includes(term))) {
          matchType = 'filename';
        }
      }

      results.push({
        path,
        size: Number(row.size ?? 0),
        isDocumentation: Boolean(row.isDocumentation),
        matchType,
        relevanceScore: getFileSearchRelevanceScore({
          fileName,
          path: pathLower,
          content: contentLower,
          terms,
          quotedPhrases,
          matchType,
        }),
      });
    }
  } finally {
    statement.free();
  }

  const matchTypeRank: Record<CodeIndexFileMatchType, number> = {
    quoted: 0,
    filename: 1,
    content: 2,
  };

  results.sort((a, b) => {
    const rankDiff = matchTypeRank[a.matchType] - matchTypeRank[b.matchType];
    if (rankDiff !== 0) return rankDiff;
    const scoreDiff = b.relevanceScore - a.relevanceScore;
    if (scoreDiff !== 0) return scoreDiff;
    return a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
  });

  return results.slice(0, limit);
}

export function searchCodeIndexSymbols(
  handle: LoadedCodeIndex,
  query: string,
  limit: number = CODE_INDEX_SEARCH_RESULT_LIMIT
): CodeIndexSymbolEntry[] {
  const terms = normalizeSearchTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const whereClause = terms
    .map(() => '(lower(ss.Name) LIKE ? OR lower(ss.Content) LIKE ? OR lower(ss.Path) LIKE ?)')
    .join(' AND ');
  const bindValues = terms.flatMap((term) => [`%${term}%`, `%${term}%`, `%${term}%`]);
  const statement = handle.db.prepare(`
    SELECT
      s.Id AS symbolId,
      s.FileId AS fileId,
      f.Path AS path,
      s.Name AS name,
      s.Kind AS kind,
      s.Language AS language,
      s.Signature AS signature,
      s.Doc AS doc,
      s.StartLine AS startLine,
      s.StartColumn AS startColumn,
      s.EndLine AS endLine,
      s.EndColumn AS endColumn,
      s.IsDefinition AS isDefinition,
      s.IsDeclaration AS isDeclaration
    FROM SymbolSearch ss
    JOIN Symbols s ON s.Id = ss.rowid
    JOIN Files f ON f.Id = s.FileId
    WHERE ${whereClause}
    ORDER BY
      CASE WHEN lower(s.Name) = ? THEN 0 WHEN lower(s.Name) LIKE ? THEN 1 ELSE 2 END,
      s.Name COLLATE NOCASE,
      f.Path COLLATE NOCASE
    LIMIT ?
  `);

  try {
    const normalizedQuery = query.trim().toLowerCase();
    statement.bind([...bindValues, normalizedQuery, `${normalizedQuery}%`, limit]);
    return readSymbolRows(statement);
  } finally {
    statement.free();
  }
}

export function findCodeIndexSymbolsByName(
  handle: LoadedCodeIndex,
  symbolName: string,
  options?: {
    path?: string;
    definitionOnly?: boolean;
    limit?: number;
  }
): CodeIndexSymbolEntry[] {
  const normalizedName = symbolName.trim();
  if (!normalizedName) {
    return [];
  }

  const clauses = ['s.Name = ?'];
  const bindValues: Array<string | number | null> = [normalizedName];
  if (options?.path) {
    clauses.push('f.Path = ?');
    bindValues.push(options.path);
  }
  if (options?.definitionOnly) {
    clauses.push('s.IsDefinition = 1');
  }

  const statement = handle.db.prepare(`
    SELECT
      s.Id AS symbolId,
      s.FileId AS fileId,
      f.Path AS path,
      s.Name AS name,
      s.Kind AS kind,
      s.Language AS language,
      s.Signature AS signature,
      s.Doc AS doc,
      s.StartLine AS startLine,
      s.StartColumn AS startColumn,
      s.EndLine AS endLine,
      s.EndColumn AS endColumn,
      s.IsDefinition AS isDefinition,
      s.IsDeclaration AS isDeclaration
    FROM Symbols s
    JOIN Files f ON f.Id = s.FileId
    WHERE ${clauses.join(' AND ')}
    ORDER BY s.IsDefinition DESC, f.Path COLLATE NOCASE, s.StartLine
    LIMIT ?
  `);

  try {
    statement.bind([...bindValues, options?.limit ?? CODE_INDEX_SEARCH_RESULT_LIMIT]);
    return readSymbolRows(statement);
  } finally {
    statement.free();
  }
}

export function getCodeIndexSymbolsForFile(
  handle: LoadedCodeIndex,
  path: string,
  options?: {
    definitionOnly?: boolean;
    limit?: number;
  }
): CodeIndexSymbolEntry[] {
  if (!path.trim()) {
    return [];
  }

  const clauses = ['f.Path = ?'];
  const bindValues: Array<string | number | null> = [path];
  if (options?.definitionOnly) {
    clauses.push('s.IsDefinition = 1');
  }

  const statement = handle.db.prepare(`
    SELECT
      s.Id AS symbolId,
      s.FileId AS fileId,
      f.Path AS path,
      s.Name AS name,
      s.Kind AS kind,
      s.Language AS language,
      s.Signature AS signature,
      s.Doc AS doc,
      s.StartLine AS startLine,
      s.StartColumn AS startColumn,
      s.EndLine AS endLine,
      s.EndColumn AS endColumn,
      s.IsDefinition AS isDefinition,
      s.IsDeclaration AS isDeclaration
    FROM Symbols s
    JOIN Files f ON f.Id = s.FileId
    WHERE ${clauses.join(' AND ')}
    ORDER BY s.StartLine, s.StartColumn, s.Name COLLATE NOCASE
    LIMIT ?
  `);

  try {
    statement.bind([...bindValues, options?.limit ?? CODE_INDEX_SEARCH_RESULT_LIMIT]);
    return readSymbolRows(statement);
  } finally {
    statement.free();
  }
}

export function getCodeIndexMembersForSymbol(
  handle: LoadedCodeIndex,
  symbolId: number
): CodeIndexMemberEntry[] {
  const statement = handle.db.prepare(`
    SELECT
      SymbolId AS symbolId,
      Name AS name,
      Type AS type,
      Line AS line,
      Ordinal AS ordinal
    FROM Members
    WHERE SymbolId = ?
    ORDER BY Ordinal, Line, Name COLLATE NOCASE
  `);

  try {
    statement.bind([symbolId]);
    const members: CodeIndexMemberEntry[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      members.push({
        symbolId: Number(row.symbolId ?? symbolId),
        name: String(row.name ?? ''),
        type: String(row.type ?? ''),
        line: Number(row.line ?? 1),
        ordinal: Number(row.ordinal ?? 0),
      });
    }
    return members;
  } finally {
    statement.free();
  }
}

export function getCodeIndexReferencesForSymbol(
  handle: LoadedCodeIndex,
  symbolId: number,
  includeDeclaration: boolean = false
): CodeIndexReferenceEntry[] {
  const references: CodeIndexReferenceEntry[] = [];
  const statement = handle.db.prepare(`
    SELECT
      r.SymbolId AS symbolId,
      f.Path AS path,
      r.Line AS line,
      r.Column AS column
    FROM "References" r
    JOIN Files f ON f.Id = r.FileId
    WHERE r.SymbolId = ?
    ORDER BY f.Path COLLATE NOCASE, r.Line, r.Column
  `);

  try {
    statement.bind([symbolId]);
    while (statement.step()) {
      const row = statement.getAsObject();
      references.push({
        symbolId: Number(row.symbolId ?? symbolId),
        path: String(row.path ?? ''),
        line: Number(row.line ?? 1),
        column: Number(row.column ?? 1),
      });
    }
  } finally {
    statement.free();
  }

  if (!includeDeclaration) {
    return references;
  }

  const declaration = getCodeIndexSymbolById(handle, symbolId);
  if (!declaration) {
    return references;
  }

  return [
    {
      symbolId,
      path: declaration.path,
      line: declaration.startLine,
      column: declaration.startColumn,
    },
    ...references,
  ];
}

export function getCodeIndexGraphNeighbors(
  handle: LoadedCodeIndex,
  path: string,
  limit: number = CODE_INDEX_SEARCH_RESULT_LIMIT
): CodeIndexEdgeEntry[] {
  const statement = handle.db.prepare(`
    SELECT
      sf.Path AS sourcePath,
      tf.Path AS targetPath,
      e.Type AS type,
      e.Symbols AS symbols
    FROM Edges e
    JOIN Files sf ON sf.Id = e.SourceFileId
    JOIN Files tf ON tf.Id = e.TargetFileId
    WHERE sf.Path = ? OR tf.Path = ?
    ORDER BY e.Type, sf.Path COLLATE NOCASE, tf.Path COLLATE NOCASE
    LIMIT ?
  `);

  try {
    statement.bind([path, path, limit]);
    const edges: CodeIndexEdgeEntry[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      edges.push({
        sourcePath: String(row.sourcePath ?? ''),
        targetPath: String(row.targetPath ?? ''),
        type: String(row.type ?? ''),
        symbols: String(row.symbols ?? '')
          .split('\n')
          .filter(Boolean),
        provider: String(row.type ?? '').startsWith('clangd:') ? 'clangd' : 'heuristic-indexer',
        confidence: String(row.type ?? '').startsWith('clangd:') ? 'high' : 'low',
      });
    }
    return edges;
  } finally {
    statement.free();
  }
}

export function getCodeIndexGraphEdges(
  handle: LoadedCodeIndex,
  limit: number = CODE_INDEX_SEARCH_RESULT_LIMIT
): CodeIndexEdgeEntry[] {
  const statement = handle.db.prepare(`
    SELECT
      sf.Path AS sourcePath,
      tf.Path AS targetPath,
      e.Type AS type,
      e.Symbols AS symbols
    FROM Edges e
    JOIN Files sf ON sf.Id = e.SourceFileId
    JOIN Files tf ON tf.Id = e.TargetFileId
    ORDER BY e.Type, sf.Path COLLATE NOCASE, tf.Path COLLATE NOCASE
    LIMIT ?
  `);

  try {
    statement.bind([limit]);
    const edges: CodeIndexEdgeEntry[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      edges.push({
        sourcePath: String(row.sourcePath ?? ''),
        targetPath: String(row.targetPath ?? ''),
        type: String(row.type ?? ''),
        symbols: String(row.symbols ?? '')
          .split('\n')
          .filter(Boolean),
        provider: String(row.type ?? '').startsWith('clangd:') ? 'clangd' : 'heuristic-indexer',
        confidence: String(row.type ?? '').startsWith('clangd:') ? 'high' : 'low',
      });
    }
    return edges;
  } finally {
    statement.free();
  }
}

export function getCodeIndexIncludeChain(
  handle: LoadedCodeIndex,
  path: string,
  options?: {
    direction?: 'incoming' | 'outgoing' | 'both';
    maxDepth?: number;
    limit?: number;
  }
): CodeIndexEdgeEntry[] {
  const direction = options?.direction ?? 'outgoing';
  const maxDepth = Math.max(1, options?.maxDepth ?? 4);
  const limit = Math.max(1, options?.limit ?? CODE_INDEX_SEARCH_RESULT_LIMIT);
  const edges: CodeIndexEdgeEntry[] = [];
  const seenEdges = new Set<string>();
  const seenPaths = new Set<string>([path]);
  let frontier = [path];

  for (let depth = 0; depth < maxDepth && frontier.length > 0 && edges.length < limit; depth++) {
    const nextFrontier: string[] = [];
    for (const currentPath of frontier) {
      for (const edge of getCodeIndexGraphNeighbors(handle, currentPath, limit)) {
        if (!/include|import|depend|use/i.test(edge.type)) {
          continue;
        }

        const outgoing = edge.sourcePath === currentPath;
        const incoming = edge.targetPath === currentPath;
        const matchesDirection =
          direction === 'both' ||
          (direction === 'outgoing' && outgoing) ||
          (direction === 'incoming' && incoming);
        if (!matchesDirection) {
          continue;
        }

        const edgeKey = `${edge.type}:${edge.sourcePath}:${edge.targetPath}:${edge.symbols.join('\n')}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          edges.push(edge);
        }
        if (edges.length >= limit) {
          break;
        }

        const neighbor = outgoing ? edge.targetPath : edge.sourcePath;
        if (!seenPaths.has(neighbor)) {
          seenPaths.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
      if (edges.length >= limit) {
        break;
      }
    }
    frontier = nextFrontier;
  }

  return edges;
}

export function getCodeIndexCapabilities(handle: LoadedCodeIndex): CodeIndexCapabilityEntry[] {
  if (handle.version < 4) {
    return [];
  }

  let statement: CodeIndexStatementLike;
  try {
    statement = handle.db.prepare(`
    SELECT
      Language AS language,
      Feature AS feature,
      Provider AS provider,
      Status AS status,
      Detail AS detail
    FROM AnalysisCapabilities
    ORDER BY Language, Feature, Provider
    `);
  } catch {
    return [];
  }

  try {
    statement.bind([]);
    const capabilities: CodeIndexCapabilityEntry[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      const status = String(row.status ?? 'unavailable');
      capabilities.push({
        language: String(row.language ?? ''),
        feature: normalizeSemanticFeature(String(row.feature ?? 'relationships')),
        provider: String(row.provider ?? ''),
        status: status === 'available' || status === 'partial' ? status : 'unavailable',
        detail: row.detail == null ? null : String(row.detail),
      });
    }
    return capabilities;
  } finally {
    statement.free();
  }
}

export function getCodeIndexDiagnostics(
  handle: LoadedCodeIndex,
  path: string
): CodeIndexDiagnosticEntry[] {
  if (handle.version < 4) return [];
  let statement: CodeIndexStatementLike;
  try {
    statement = handle.db.prepare(`
      SELECT
        f.Path AS path,
        d.Severity AS severity,
        d.Message AS message,
        d.StartLine AS startLine,
        d.StartColumn AS startColumn,
        d.EndLine AS endLine,
        d.EndColumn AS endColumn,
        d.Provider AS provider
      FROM Diagnostics d
      JOIN Files f ON f.Id = d.FileId
      WHERE f.Path = ?
      ORDER BY d.StartLine, d.StartColumn
    `);
  } catch {
    return [];
  }

  try {
    statement.bind([path]);
    const diagnostics: CodeIndexDiagnosticEntry[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      const severity = String(row.severity ?? 'info');
      diagnostics.push({
        path: String(row.path ?? path),
        severity: severity === 'error' || severity === 'warning' ? severity : 'info',
        message: String(row.message ?? ''),
        startLine: Number(row.startLine ?? 1),
        startColumn: Number(row.startColumn ?? 1),
        endLine: Number(row.endLine ?? row.startLine ?? 1),
        endColumn: Number(row.endColumn ?? row.startColumn ?? 1),
        provider: String(row.provider ?? 'unknown'),
      });
    }
    return diagnostics;
  } finally {
    statement.free();
  }
}

export function getCodeIndexGuideLinks(
  handle: LoadedCodeIndex,
  guideId?: string
): CodeIndexGuideLinkEntry[] {
  const clauses: string[] = [];
  const bindValues: Array<string | number | null> = [];
  if (guideId) {
    clauses.push('gl.GuideId = ?');
    bindValues.push(guideId);
  }

  const statement = handle.db.prepare(`
    SELECT
      gl.GuideId AS guideId,
      gl.SectionId AS sectionId,
      gl.SectionTitle AS sectionTitle,
      gl.Path AS path,
      gl.SymbolName AS symbolName,
      gl.Line AS line
    FROM GuideLinks gl
    ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY gl.GuideId, gl.SectionOrder, gl.Ordinal
  `);

  try {
    statement.bind(bindValues);
    const links: CodeIndexGuideLinkEntry[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      links.push({
        guideId: String(row.guideId ?? ''),
        sectionId: String(row.sectionId ?? ''),
        sectionTitle: String(row.sectionTitle ?? ''),
        path: String(row.path ?? ''),
        symbolName: row.symbolName == null ? null : String(row.symbolName),
        line: row.line == null ? null : Number(row.line),
      });
    }
    return links;
  } finally {
    statement.free();
  }
}

export function searchCodeIndexConcepts(
  handle: LoadedCodeIndex,
  query: string,
  limit: number = CODE_INDEX_SEARCH_RESULT_LIMIT
): CodeIndexConceptEntry[] {
  const terms = normalizeSearchTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const statement = handle.db.prepare(`
    SELECT Id AS conceptId, Name AS name, Kind AS kind
    FROM Concepts
    WHERE ${terms.map(() => 'lower(Name) LIKE ?').join(' AND ')}
    ORDER BY Name COLLATE NOCASE
    LIMIT ?
  `);

  try {
    statement.bind([...terms.map((term) => `%${term}%`), limit]);
    const concepts: CodeIndexConceptEntry[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      concepts.push({
        conceptId: Number(row.conceptId ?? 0),
        name: String(row.name ?? ''),
        kind: String(row.kind ?? ''),
      });
    }
    return concepts;
  } finally {
    statement.free();
  }
}

function getCodeIndexSymbolById(
  handle: LoadedCodeIndex,
  symbolId: number
): CodeIndexSymbolEntry | null {
  const statement = handle.db.prepare(`
    SELECT
      s.Id AS symbolId,
      s.FileId AS fileId,
      f.Path AS path,
      s.Name AS name,
      s.Kind AS kind,
      s.Language AS language,
      s.Signature AS signature,
      s.Doc AS doc,
      s.StartLine AS startLine,
      s.StartColumn AS startColumn,
      s.EndLine AS endLine,
      s.EndColumn AS endColumn,
      s.IsDefinition AS isDefinition,
      s.IsDeclaration AS isDeclaration
    FROM Symbols s
    JOIN Files f ON f.Id = s.FileId
    WHERE s.Id = ?
    LIMIT 1
  `);

  try {
    statement.bind([symbolId]);
    const rows = readSymbolRows(statement);
    return rows[0] ?? null;
  } finally {
    statement.free();
  }
}

function readSymbolRows(statement: CodeIndexStatementLike): CodeIndexSymbolEntry[] {
  const results: CodeIndexSymbolEntry[] = [];
  while (statement.step()) {
    const row = statement.getAsObject();
    results.push({
      symbolId: Number(row.symbolId ?? 0),
      fileId: Number(row.fileId ?? 0),
      path: String(row.path ?? ''),
      name: String(row.name ?? ''),
      kind: String(row.kind ?? ''),
      language: String(row.language ?? ''),
      signature: row.signature == null ? null : String(row.signature),
      doc: row.doc == null ? null : String(row.doc),
      startLine: Number(row.startLine ?? 1),
      startColumn: Number(row.startColumn ?? 1),
      endLine: Number(row.endLine ?? row.startLine ?? 1),
      endColumn: Number(row.endColumn ?? row.startColumn ?? 1),
      isDefinition: Boolean(row.isDefinition),
      isDeclaration: Boolean(row.isDeclaration),
    });
  }
  return results;
}

export function buildSearchPreview(content: string, query: string): SearchPreview | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return null;
  }

  const terms = normalizedQuery.match(/[a-z0-9_]+/g)?.filter(Boolean) ?? [];
  const quotedPhrases = extractQuotedPhrases(query);
  if (terms.length === 0) {
    return null;
  }

  const lines = content.split('\n');

  const findMatch = (predicate: (line: string) => boolean): SearchPreview | null => {
    for (let index = 0; index < lines.length; index += 1) {
      const originalLine = lines[index] ?? '';
      if (!predicate(originalLine.toLowerCase())) {
        continue;
      }

      const preview = originalLine.trim() || '(empty line)';
      const searchLine = originalLine.toLowerCase();
      const firstTerm =
        quotedPhrases.find((phrase) => searchLine.includes(phrase)) ??
        terms.find((term) => searchLine.includes(term));
      const column = firstTerm !== undefined ? searchLine.indexOf(firstTerm) + 1 : 1;

      return {
        line: index + 1,
        column,
        preview,
      };
    }

    return null;
  };

  if (quotedPhrases.length > 0) {
    const quotedMatch = findMatch((line) => quotedPhrases.some((phrase) => line.includes(phrase)));
    if (quotedMatch) {
      return quotedMatch;
    }
  }

  const exactMatch = findMatch((line) => terms.every((term) => line.includes(term)));
  if (exactMatch) {
    return exactMatch;
  }

  const partialMatch = findMatch((line) => terms.some((term) => line.includes(term)));
  if (partialMatch) {
    return partialMatch;
  }

  const fallbackPreview = lines[0]?.trim() || '(empty file)';
  return {
    line: 1,
    column: 1,
    preview: fallbackPreview,
  };
}
