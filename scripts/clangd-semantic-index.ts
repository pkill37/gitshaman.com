import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { pathToFileURL, fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { GENERATED_COMMAND_MARKER, prepareCompilationDatabase } from './compilation-database';
import {
  CLANGD_BACKEND_FEATURES,
  type SemanticBackendFeature,
  type SemanticCapabilityStatus,
  type SemanticIndexStats,
} from '../src/lib/semantic-backend-contract';

type JsonRpcMessage = {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: unknown;
};

type LspPosition = { line: number; character: number };
type LspRange = { start: LspPosition; end: LspPosition };
type LspCallItem = { name: string; uri: string; range: LspRange; selectionRange: LspRange };
type LspCall = { from?: LspCallItem; to?: LspCallItem; fromRanges?: LspRange[] };
type LspDocumentSymbol = {
  name: string;
  kind: number;
  detail?: string;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
};
type LspLocation = { uri: string; range: LspRange };
type LspHover = {
  contents?: string | { value?: string } | Array<string | { value?: string }>;
};

type CompileCommand = { file: string; directory: string; gitshaman?: string };

export type ClangdSemanticIndexStats = SemanticIndexStats;

class ClangdClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly notifications: JsonRpcMessage[] = [];

  constructor(
    private readonly executable: string,
    private readonly compileCommandsDir: string
  ) {}

  start(): void {
    this.process = spawn(
      this.executable,
      [`--compile-commands-dir=${this.compileCommandsDir}`, '--background-index=false'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.process.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    // Drain clangd logging so large source-only corpora cannot fill the stderr pipe.
    this.process.stderr.resume();
    this.process.on('error', (error) => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
    });
    this.process.on('exit', (code) => {
      const error = new Error(`clangd exited with code ${code ?? 'unknown'}`);
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
    });
  }

  async request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`clangd request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.send({ jsonrpc: '2.0', id, method, params });
    return response;
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  takeNotifications(method: string): JsonRpcMessage[] {
    const matches = this.notifications.filter((message) => message.method === method);
    for (const match of matches) {
      const index = this.notifications.indexOf(match);
      if (index >= 0) this.notifications.splice(index, 1);
    }
    return matches;
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    try {
      await this.request('shutdown', null, 5_000);
      this.notify('exit', null);
    } finally {
      this.process.kill();
      this.process = null;
    }
  }

  private send(payload: unknown): void {
    if (!this.process) throw new Error('clangd has not been started');
    const body = Buffer.from(JSON.stringify(payload));
    this.process.stdin.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
    this.process.stdin.write(body);
  }

  private consume(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.stdoutBuffer.subarray(0, headerEnd).toString('ascii');
      const length = /Content-Length:\s*(\d+)/i.exec(header)?.[1];
      if (!length) throw new Error('clangd emitted an invalid JSON-RPC frame');
      const bodyLength = Number(length);
      const bodyStart = headerEnd + 4;
      if (this.stdoutBuffer.byteLength < bodyStart + bodyLength) return;
      const body = this.stdoutBuffer.subarray(bodyStart, bodyStart + bodyLength).toString('utf8');
      this.stdoutBuffer = this.stdoutBuffer.subarray(bodyStart + bodyLength);
      this.handle(JSON.parse(body) as JsonRpcMessage);
    }
  }

  private handle(message: JsonRpcMessage): void {
    if (typeof message.id !== 'number') {
      if (message.method) this.notifications.push(message);
      return;
    }
    const request = this.pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  }
}

function flattenDocumentSymbols(symbols: LspDocumentSymbol[]): LspDocumentSymbol[] {
  return symbols.flatMap((symbol) => [symbol, ...flattenDocumentSymbols(symbol.children ?? [])]);
}

function relativeFilePath(repoDir: string, uri: string): string | null {
  try {
    const relativePath = path.relative(repoDir, fileURLToPath(uri)).replaceAll(path.sep, '/');
    return relativePath.startsWith('../') || path.isAbsolute(relativePath) ? null : relativePath;
  } catch {
    return null;
  }
}

function hoverText(hover: LspHover | null): string | null {
  const contents = hover?.contents;
  if (!contents) return null;
  const values = (Array.isArray(contents) ? contents : [contents])
    .map((value) => (typeof value === 'string' ? value : (value.value ?? '')))
    .filter(Boolean);
  return values.length > 0 ? values.join('\n\n') : null;
}

function lspSymbolKindToCodeIndexKind(kind: number): string | null {
  switch (kind) {
    case 5:
      return 'class';
    case 6:
    case 9:
    case 12:
      return 'function';
    case 7:
    case 8:
    case 13:
      return 'variable';
    case 10:
    case 11:
    case 23:
    case 26:
      return 'type';
    case 14:
      return 'macro';
    default:
      return null;
  }
}

function isLspMemberKind(kind: number): boolean {
  return kind === 7 || kind === 8 || kind === 13 || kind === 22;
}

function isLspNavigableSymbolKind(kind: number): boolean {
  return lspSymbolKindToCodeIndexKind(kind) !== null;
}

function recordBackendCapability(
  statement: { run: (...params: unknown[]) => unknown },
  feature: SemanticBackendFeature,
  provider: string,
  status: SemanticCapabilityStatus,
  detail: string
): void {
  statement.run('c-family', feature, provider, status, detail);
}

/** Enriches a completed v4 SQLite index. Failure is recorded as capability metadata. */
export async function enrichCodeIndexWithClangd(
  repoDir: string,
  dbPath: string,
  logger: Pick<Console, 'log' | 'warn'> = console
): Promise<ClangdSemanticIndexStats> {
  repoDir = path.resolve(repoDir);
  const { databasePath: compilationDatabase } = prepareCompilationDatabase(repoDir);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS AnalysisCapabilities (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      Language TEXT NOT NULL,
      Feature TEXT NOT NULL,
      Provider TEXT NOT NULL,
      Status TEXT NOT NULL,
      Detail TEXT,
      UNIQUE(Language, Feature, Provider)
    );
    CREATE TABLE IF NOT EXISTS Diagnostics (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      FileId INTEGER NOT NULL,
      Severity TEXT NOT NULL,
      Message TEXT NOT NULL,
      StartLine INTEGER NOT NULL,
      StartColumn INTEGER NOT NULL,
      EndLine INTEGER NOT NULL,
      EndColumn INTEGER NOT NULL,
      Provider TEXT NOT NULL,
      FOREIGN KEY (FileId) REFERENCES Files(Id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_Diagnostics_File ON Diagnostics(FileId);
  `);
  const recordCapability = db.prepare(
    'INSERT OR REPLACE INTO AnalysisCapabilities(Language, Feature, Provider, Status, Detail) VALUES (?, ?, ?, ?, ?)'
  );
  const finishUnavailable = (detail: string): ClangdSemanticIndexStats => {
    for (const feature of CLANGD_BACKEND_FEATURES) {
      recordBackendCapability(recordCapability, feature, 'clangd', 'unavailable', detail);
    }
    recordBackendCapability(
      recordCapability,
      'includeChains',
      'heuristic-indexer',
      'partial',
      detail
    );
    recordBackendCapability(recordCapability, 'dataflow', 'clang-ast', 'unavailable', detail);
    recordBackendCapability(
      recordCapability,
      'dataflow',
      'heuristic-indexer',
      'partial',
      'Local def-use summaries were inferred from assignments and return statements.'
    );
    db.close();
    return { status: 'unavailable', filesAnalyzed: 0, callEdges: 0, detail };
  };

  if (!compilationDatabase) {
    return finishUnavailable(
      'Not applicable: this snapshot contains no C-family compilation units.'
    );
  }

  const commands = JSON.parse(fs.readFileSync(compilationDatabase, 'utf8')) as CompileCommand[];
  const generated = commands.some((command) => command.gitshaman === GENERATED_COMMAND_MARKER);
  const maxFiles = Number(process.env.SEMANTIC_INDEX_MAX_FILES ?? 0);
  const sourceFiles = Array.from(
    new Set(
      commands
        .map((command) => path.resolve(command.directory, command.file))
        .filter((file) => file.startsWith(`${repoDir}${path.sep}`) && fs.existsSync(file))
    )
  ).slice(0, maxFiles > 0 ? maxFiles : undefined);
  if (sourceFiles.length === 0) {
    return finishUnavailable('The compilation database contains no repository source files.');
  }

  const client = new ClangdClient(
    process.env.CLANGD_PATH || 'clangd',
    path.dirname(compilationDatabase)
  );
  let filesAnalyzed = 0;
  let callEdges = 0;

  try {
    client.start();
    await client.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(repoDir).href,
      capabilities: {
        textDocument: {
          callHierarchy: { dynamicRegistration: false },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
      },
    });
    client.notify('initialized', {});

    const fileIdQuery = db.prepare('SELECT Id AS id FROM Files WHERE Path = ?');
    const insertCompatEdge = db.prepare(
      'INSERT INTO Edges(SourceFileId, TargetFileId, Type, Symbols) VALUES (?, ?, ?, ?)'
    );
    const clearDiagnostics = db.prepare(
      'DELETE FROM Diagnostics WHERE FileId = ? AND Provider = ?'
    );
    const insertDiagnostic = db.prepare(
      'INSERT INTO Diagnostics(FileId, Severity, Message, StartLine, StartColumn, EndLine, EndColumn, Provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertSymbol = db.prepare(
      'INSERT INTO Symbols(FileId, Name, Kind, Language, Signature, Doc, StartLine, StartColumn, EndLine, EndColumn, IsDefinition, IsDeclaration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const symbolIdQuery = db.prepare(`
      SELECT s.Id AS id
      FROM Symbols s
      JOIN Files f ON f.Id = s.FileId
      WHERE f.Path = ? AND s.Name = ?
      ORDER BY s.IsDefinition DESC, s.StartLine
      LIMIT 1
    `);
    const updateSymbol = db.prepare(
      'UPDATE Symbols SET Kind = ?, Signature = COALESCE(?, Signature), Doc = COALESCE(?, Doc), StartLine = ?, StartColumn = ?, EndLine = ?, EndColumn = ?, IsDefinition = 1 WHERE Id = ?'
    );
    const clearMembers = db.prepare('DELETE FROM Members WHERE SymbolId = ?');
    const insertMember = db.prepare(
      'INSERT INTO Members(SymbolId, Name, Type, Line, Ordinal) VALUES (?, ?, ?, ?, ?)'
    );
    const clearReferences = db.prepare('DELETE FROM "References" WHERE SymbolId = ?');
    const insertReference = db.prepare(
      'INSERT INTO "References"(SymbolId, FileId, Line, Column) VALUES (?, ?, ?, ?)'
    );

    for (const absolutePath of sourceFiles) {
      const uri = pathToFileURL(absolutePath).href;
      const text = fs.readFileSync(absolutePath, 'utf8');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'cpp', version: 1, text },
      });
      const symbols = (await client.request('textDocument/documentSymbol', {
        textDocument: { uri },
      })) as LspDocumentSymbol[] | null;
      const relativePath = relativeFilePath(repoDir, uri);
      const fileRow = relativePath
        ? (fileIdQuery.get(relativePath) as { id?: number } | undefined)
        : undefined;
      if (fileRow?.id) {
        const diagnosticNotifications = client
          .takeNotifications('textDocument/publishDiagnostics')
          .map(
            (message) =>
              message.params as {
                uri?: string;
                diagnostics?: Array<{ range: LspRange; severity?: number; message?: string }>;
              }
          )
          .filter((params) => params.uri === uri);
        clearDiagnostics.run(fileRow.id, 'clangd');
        for (const diagnostic of diagnosticNotifications.flatMap(
          (params) => params.diagnostics ?? []
        )) {
          insertDiagnostic.run(
            fileRow.id,
            diagnostic.severity === 1 ? 'error' : diagnostic.severity === 2 ? 'warning' : 'info',
            diagnostic.message ?? 'clangd diagnostic',
            diagnostic.range.start.line + 1,
            diagnostic.range.start.character + 1,
            diagnostic.range.end.line + 1,
            diagnostic.range.end.character + 1,
            'clangd'
          );
        }
      }
      for (const symbol of flattenDocumentSymbols(symbols ?? []).filter((entry) =>
        isLspNavigableSymbolKind(entry.kind)
      )) {
        const codeIndexKind = lspSymbolKindToCodeIndexKind(symbol.kind);
        if (!codeIndexKind || !relativePath || !fileRow?.id) {
          continue;
        }
        const indexedSymbol = symbolIdQuery.get(relativePath, symbol.name) as
          { id?: number } | undefined;
        const symbolId =
          indexedSymbol?.id ??
          Number(
            insertSymbol.run(
              fileRow.id,
              symbol.name,
              codeIndexKind,
              'c-family',
              symbol.detail ?? null,
              null,
              symbol.range.start.line + 1,
              symbol.range.start.character + 1,
              symbol.range.end.line + 1,
              symbol.range.end.character + 1,
              1,
              0
            ).lastInsertRowid
          );

        if (symbolId) {
          const hover = (await client.request('textDocument/hover', {
            textDocument: { uri },
            position: symbol.selectionRange.start,
          })) as LspHover | null;
          updateSymbol.run(
            codeIndexKind,
            symbol.detail ?? null,
            hoverText(hover),
            symbol.range.start.line + 1,
            symbol.range.start.character + 1,
            symbol.range.end.line + 1,
            symbol.range.end.character + 1,
            symbolId
          );

          clearMembers.run(symbolId);
          for (const [ordinal, member] of (symbol.children ?? [])
            .filter((child) => isLspMemberKind(child.kind))
            .entries()) {
            insertMember.run(
              symbolId,
              member.name,
              member.detail ?? lspSymbolKindToCodeIndexKind(member.kind) ?? '',
              member.selectionRange.start.line + 1,
              ordinal
            );
          }

          const references = (await client.request('textDocument/references', {
            textDocument: { uri },
            position: symbol.selectionRange.start,
            context: { includeDeclaration: false },
          })) as LspLocation[] | null;
          clearReferences.run(symbolId);
          const seenReferences = new Set<string>();
          for (const reference of references ?? []) {
            const referencePath = relativeFilePath(repoDir, reference.uri);
            const referenceFile = referencePath
              ? (fileIdQuery.get(referencePath) as { id?: number } | undefined)
              : undefined;
            if (!referenceFile?.id) continue;
            const referenceKey = `${referenceFile.id}:${reference.range.start.line}:${reference.range.start.character}`;
            if (seenReferences.has(referenceKey)) continue;
            seenReferences.add(referenceKey);
            insertReference.run(
              symbolId,
              referenceFile.id,
              reference.range.start.line + 1,
              reference.range.start.character + 1
            );
          }
        }

        const prepared = (await client.request('textDocument/prepareCallHierarchy', {
          textDocument: { uri },
          position: symbol.selectionRange.start,
        })) as LspCallItem[] | null;
        const root = prepared?.[0];
        if (!root) continue;
        const outgoing = (await client.request('callHierarchy/outgoingCalls', { item: root })) as
          LspCall[] | null;
        for (const call of outgoing ?? []) {
          if (!call.to) continue;
          const sourcePath = relativeFilePath(repoDir, root.uri);
          const targetPath = relativeFilePath(repoDir, call.to.uri);
          const sourceFile = sourcePath
            ? (fileIdQuery.get(sourcePath) as { id?: number } | undefined)
            : undefined;
          const targetFile = targetPath
            ? (fileIdQuery.get(targetPath) as { id?: number } | undefined)
            : undefined;
          if (sourceFile?.id && targetFile?.id && sourceFile.id !== targetFile.id) {
            insertCompatEdge.run(sourceFile.id, targetFile.id, 'clangd:calls', call.to.name);
          }
          callEdges++;
        }
      }
      client.notify('textDocument/didClose', { textDocument: { uri } });
      filesAnalyzed++;
    }

    const status = generated || sourceFiles.length < commands.length ? 'partial' : 'available';
    const detail = `clangd analyzed ${filesAnalyzed} compilation units and emitted ${callEdges} call edges.${generated ? ' Source-only compilation commands were generated; native build flags and generated headers may be missing.' : ''}`;
    for (const feature of CLANGD_BACKEND_FEATURES) {
      recordBackendCapability(recordCapability, feature, 'clangd', status, detail);
    }
    recordBackendCapability(
      recordCapability,
      'includeChains',
      'heuristic-indexer',
      'partial',
      'Include/import chains were derived from indexed source relationships.'
    );
    recordBackendCapability(
      recordCapability,
      'dataflow',
      'clang-ast',
      'unavailable',
      'Intraprocedural def-use extraction is not available for this compilation database.'
    );
    recordBackendCapability(
      recordCapability,
      'dataflow',
      'heuristic-indexer',
      'partial',
      'Local def-use summaries were inferred from assignments and return statements.'
    );
    logger.log(`   ${detail}`);
    return { status, filesAnalyzed, callEdges, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(`   clangd semantic indexing unavailable: ${detail}`);
    for (const feature of CLANGD_BACKEND_FEATURES) {
      recordBackendCapability(recordCapability, feature, 'clangd', 'unavailable', detail);
    }
    recordBackendCapability(
      recordCapability,
      'includeChains',
      'heuristic-indexer',
      'partial',
      detail
    );
    recordBackendCapability(recordCapability, 'dataflow', 'clang-ast', 'unavailable', detail);
    recordBackendCapability(
      recordCapability,
      'dataflow',
      'heuristic-indexer',
      'partial',
      'Local def-use summaries were inferred from assignments and return statements.'
    );
    return { status: 'unavailable', filesAnalyzed, callEdges, detail };
  } finally {
    await client.stop().catch(() => undefined);
    db.close();
  }
}
