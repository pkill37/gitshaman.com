import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';

import { buildCodeIndex } from '../scripts/code-index-builder';
import { enrichCodeIndexWithClangd } from '../scripts/clangd-semantic-index';
import {
  CODE_INDEX_FILE_NAME,
  CODE_INDEX_MAX_CONTENT_BYTES,
  CODE_INDEX_VERSION,
  findCodeIndexSymbolsByName,
  getCodeIndexCapabilities,
  getCodeIndexDiagnostics,
  getCodeIndexGraphNeighbors,
  getCodeIndexGuideLinks,
  getCodeIndexIncludeChain,
  getCodeIndexMembersForSymbol,
  getCodeIndexReferencesForSymbol,
  getCodeIndexSymbolsForFile,
  searchCodeIndexConcepts,
  searchCodeIndexFiles,
  searchCodeIndexSymbols,
  type CodeIndexDatabaseLike,
  type CodeIndexStatementLike,
  type LoadedCodeIndex,
} from '@/lib/code-index';
import { findSymbolsInFile } from '@/lib/cross-reference';
import { IndexedLanguageBackend } from '@/lib/language-backends';

type BetterSqliteStatementWithParams = {
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
};

type BetterSqliteDatabaseWithParams = {
  prepare(sql: string): BetterSqliteStatementWithParams;
};

class BetterSqliteCodeIndexStatement implements CodeIndexStatementLike {
  private rows: Array<Record<string, unknown>> = [];
  private index = -1;

  constructor(private readonly statement: BetterSqliteStatementWithParams) {}

  bind(values: Array<string | number | null> = []): void {
    this.rows = this.statement.all(...values);
    this.index = -1;
  }

  step(): boolean {
    this.index += 1;
    return this.index < this.rows.length;
  }

  getAsObject(): Record<string, unknown> {
    return this.rows[this.index] ?? {};
  }

  free(): void {}
}

class BetterSqliteCodeIndexDatabase implements CodeIndexDatabaseLike {
  constructor(private readonly db: BetterSqliteDatabaseWithParams) {}

  prepare(sql: string): CodeIndexStatementLike {
    return new BetterSqliteCodeIndexStatement(this.db.prepare(sql));
  }
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root: string, relativePath: string, content: string): void {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function createSyntheticRepo(): { tempDir: string; repoDir: string } {
  const tempDir = makeTempDir('explorar-code-index-builder-');
  const repoDir = path.join(tempDir, 'example-owner', 'example-repo', 'v1.0.0');
  fs.mkdirSync(repoDir, { recursive: true });

  writeFile(
    repoDir,
    'include/foo.h',
    '#pragma once\n\nstruct Config {\n  int enabled;\n  int mode;\n};\n\nint helper(int value);\n'
  );
  writeFile(
    repoDir,
    'src/foo.c',
    '#include "foo.h"\n\nint helper(int value) {\n  return value + 1;\n}\n'
  );
  writeFile(
    repoDir,
    'src/main.c',
    '#include "foo.h"\n\nint main(void) {\n  return helper(41);\n}\n'
  );
  writeFile(
    repoDir,
    'lib/util.py',
    'def python_helper(value: int) -> int:\n    return value + 1\n'
  );
  writeFile(repoDir, 'docs/notes.md', '# Notes\n\nThe helper path is `src/foo.c`.\n');
  writeFile(repoDir, 'large.txt', 'x'.repeat(CODE_INDEX_MAX_CONTENT_BYTES + 128));
  writeFile(repoDir, 'search-index.json', '{"legacy":true}\n');

  return { tempDir, repoDir };
}

test.describe('code index builder', () => {
  test('indexes Linux SYSCALL_DEFINE wrappers as jumpable function definitions', () => {
    const sourcePath = path.join(process.cwd(), 'repos/torvalds/linux/v6.1/fs/readdir.c');
    test.skip(!fs.existsSync(sourcePath), 'Linux v6.1 corpus is not available locally');

    const symbols = findSymbolsInFile(fs.readFileSync(sourcePath, 'utf8'), 'fs/readdir.c');
    expect(
      symbols.find(
        (symbol) => symbol.name === 'getdents' && symbol.type === 'function' && symbol.isDefinition
      )
    ).toEqual(expect.objectContaining({ line: 271 }));
  });

  test('builds SQLite metadata, search rows, symbols, references, and graph edges', () => {
    const { tempDir, repoDir } = createSyntheticRepo();

    try {
      const stats = buildCodeIndex(
        repoDir,
        [
          {
            name: 'include',
            path: 'include',
            type: 'directory',
            children: [{ name: 'foo.h', path: 'include/foo.h', type: 'file' }],
          },
          {
            name: 'src',
            path: 'src',
            type: 'directory',
            children: [
              { name: 'foo.c', path: 'src/foo.c', type: 'file' },
              { name: 'main.c', path: 'src/main.c', type: 'file' },
            ],
          },
          {
            name: 'lib',
            path: 'lib',
            type: 'directory',
            children: [{ name: 'util.py', path: 'lib/util.py', type: 'file' }],
          },
          {
            name: 'docs',
            path: 'docs',
            type: 'directory',
            children: [{ name: 'notes.md', path: 'docs/notes.md', type: 'file' }],
          },
          { name: 'large.txt', path: 'large.txt', type: 'file' },
          { name: 'search-index.json', path: 'search-index.json', type: 'file' },
        ],
        'synthetic-build-signature'
      );

      expect(stats).toMatchObject({
        dbPath: path.join(repoDir, CODE_INDEX_FILE_NAME),
        fileCount: 6,
        symbolCount: expect.any(Number),
        edgeCount: expect.any(Number),
        truncatedFileCount: 1,
      });
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);

      expect(fs.existsSync(path.join(repoDir, CODE_INDEX_FILE_NAME))).toBe(true);
      expect(fs.existsSync(path.join(repoDir, 'search-index.json'))).toBe(false);

      const db = new Database(path.join(repoDir, CODE_INDEX_FILE_NAME), {
        readonly: false,
        fileMustExist: true,
      });

      try {
        const metadata = db
          .prepare(
            'SELECT Version AS version, BuildSignature AS buildSignature, Owner AS owner, Repo AS repo, Branch AS branch, FileCount AS fileCount FROM Metadata LIMIT 1'
          )
          .get() as Record<string, unknown>;
        expect(metadata).toMatchObject({
          version: CODE_INDEX_VERSION,
          buildSignature: 'synthetic-build-signature',
          owner: 'example-owner',
          repo: 'example-repo',
          branch: 'v1.0.0',
          fileCount: 6,
        });

        expect(
          db
            .prepare('SELECT Path FROM Files ORDER BY Path')
            .all()
            .map((row) => row.Path)
        ).toEqual([
          'docs/notes.md',
          'include/foo.h',
          'large.txt',
          'lib/util.py',
          'src/foo.c',
          'src/main.c',
        ]);
        expect(
          db.prepare('SELECT ContentTruncated FROM Files WHERE Path = ?').get('large.txt')
        ).toMatchObject({ ContentTruncated: 1 });
        const largeSearchRow = db
          .prepare('SELECT length(Content) AS contentLength FROM FileSearch WHERE Path = ?')
          .get('large.txt') as Record<string, unknown>;
        expect(Number(largeSearchRow.contentLength)).toBeLessThan(CODE_INDEX_MAX_CONTENT_BYTES);
        expect(db.prepare('SELECT COUNT(*) AS count FROM Symbols').get()).toMatchObject({
          count: expect.any(Number),
        });
        expect(db.prepare('SELECT COUNT(*) AS count FROM Edges').get()).toMatchObject({
          count: expect.any(Number),
        });

        const handle: LoadedCodeIndex = {
          db: new BetterSqliteCodeIndexDatabase(db as unknown as BetterSqliteDatabaseWithParams),
          version: Number(metadata.version),
          fileCount: Number(metadata.fileCount),
          buildSignature: String(metadata.buildSignature),
        };

        expect(searchCodeIndexFiles(handle, 'notes').map((entry) => entry.path)).toContain(
          'docs/notes.md'
        );
        expect(searchCodeIndexFiles(handle, 'foo').slice(0, 2)).toEqual([
          expect.objectContaining({ path: 'include/foo.h', matchType: 'filename' }),
          expect.objectContaining({ path: 'src/foo.c', matchType: 'filename' }),
        ]);
        expect(searchCodeIndexFiles(handle, '"src/foo.c"')[0]).toMatchObject({
          path: 'docs/notes.md',
          matchType: 'quoted',
          relevanceScore: expect.any(Number),
        });

        const helperSymbols = findCodeIndexSymbolsByName(handle, 'helper', {
          definitionOnly: true,
        });
        expect(helperSymbols).toHaveLength(1);
        expect(helperSymbols[0]).toMatchObject({
          name: 'helper',
          path: 'src/foo.c',
          kind: 'function',
        });

        expect(searchCodeIndexSymbols(handle, 'helper')).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'helper',
              path: 'src/foo.c',
            }),
          ])
        );

        expect(getCodeIndexReferencesForSymbol(handle, helperSymbols[0].symbolId, true)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: 'src/foo.c',
              line: helperSymbols[0].startLine,
              column: helperSymbols[0].startColumn,
            }),
          ])
        );

        expect(getCodeIndexGraphNeighbors(handle, 'src/main.c')).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourcePath: 'src/main.c',
              targetPath: 'include/foo.h',
              type: 'includes',
              symbols: ['foo.h'],
            }),
            expect.objectContaining({
              sourcePath: 'src/main.c',
              targetPath: 'include/foo.h',
              type: 'calls',
              symbols: ['helper'],
            }),
          ])
        );

        expect(searchCodeIndexConcepts(handle, 'helper')).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'helper',
              kind: 'symbol',
            }),
          ])
        );
        expect(getCodeIndexSymbolsForFile(handle, 'include/foo.h')).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'Config',
              kind: 'struct',
              path: 'include/foo.h',
            }),
          ])
        );
        const configSymbols = findCodeIndexSymbolsByName(handle, 'Config', {
          definitionOnly: true,
        });
        expect(configSymbols).toHaveLength(1);
        expect(getCodeIndexMembersForSymbol(handle, configSymbols[0].symbolId)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'enabled', type: 'int' }),
            expect.objectContaining({ name: 'mode', type: 'int' }),
          ])
        );
        expect(getCodeIndexIncludeChain(handle, 'src/main.c')).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourcePath: 'src/main.c',
              targetPath: 'include/foo.h',
              type: 'includes',
              symbols: ['foo.h'],
            }),
          ])
        );

        db.exec(`
          CREATE TABLE IF NOT EXISTS AnalysisCapabilities (
            Language TEXT NOT NULL,
            Feature TEXT NOT NULL,
            Provider TEXT NOT NULL,
            Status TEXT NOT NULL,
            Detail TEXT,
            PRIMARY KEY (Language, Feature, Provider)
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
            Provider TEXT NOT NULL
          );
        `);
        db.prepare(
          'INSERT INTO AnalysisCapabilities(Language, Feature, Provider, Status, Detail) VALUES (?, ?, ?, ?, ?)'
        ).run('c-family', 'references', 'clangd', 'available', 'synthetic semantic fixture');
        const mainFile = db
          .prepare('SELECT Id AS id FROM Files WHERE Path = ?')
          .get('src/main.c') as { id: number } | undefined;
        expect(mainFile).toBeTruthy();
        db.prepare(
          'INSERT INTO Diagnostics(FileId, Severity, Message, StartLine, StartColumn, EndLine, EndColumn, Provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(mainFile!.id, 'warning', 'synthetic warning', 4, 10, 4, 16, 'clangd');

        expect(getCodeIndexCapabilities(handle)).toEqual([
          expect.objectContaining({
            language: 'c-family',
            feature: 'references',
            provider: 'clangd',
            status: 'available',
          }),
        ]);
        expect(getCodeIndexDiagnostics(handle, 'src/main.c')).toEqual([
          expect.objectContaining({
            path: 'src/main.c',
            severity: 'warning',
            message: 'synthetic warning',
            provider: 'clangd',
          }),
        ]);
        expect(getCodeIndexGuideLinks(handle)).toEqual([]);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('serves live editor definition, reference, hover, and relationship queries from the index', async () => {
    const { tempDir, repoDir } = createSyntheticRepo();

    try {
      buildCodeIndex(
        repoDir,
        [
          {
            name: 'include',
            path: 'include',
            type: 'directory',
            children: [{ name: 'foo.h', path: 'include/foo.h', type: 'file' }],
          },
          {
            name: 'src',
            path: 'src',
            type: 'directory',
            children: [
              { name: 'foo.c', path: 'src/foo.c', type: 'file' },
              { name: 'main.c', path: 'src/main.c', type: 'file' },
            ],
          },
        ],
        'synthetic-live-editor-signature',
        { log: () => {}, warn: () => {} }
      );

      const db = new Database(path.join(repoDir, CODE_INDEX_FILE_NAME), {
        readonly: false,
        fileMustExist: true,
      });

      try {
        const metadata = db
          .prepare(
            'SELECT Version AS version, BuildSignature AS buildSignature, FileCount AS fileCount FROM Metadata LIMIT 1'
          )
          .get() as Record<string, unknown>;
        const helperSymbol = db
          .prepare(
            'SELECT s.Id AS symbolId FROM Symbols s JOIN Files f ON f.Id = s.FileId WHERE s.Name = ? AND f.Path = ? AND s.IsDefinition = 1 LIMIT 1'
          )
          .get('helper', 'src/foo.c') as { symbolId: number } | undefined;
        const mainFile = db
          .prepare('SELECT Id AS fileId FROM Files WHERE Path = ?')
          .get('src/main.c') as { fileId: number } | undefined;
        expect(helperSymbol).toBeTruthy();
        expect(mainFile).toBeTruthy();
        db.prepare(
          'INSERT INTO "References"(SymbolId, FileId, Line, Column) VALUES (?, ?, ?, ?)'
        ).run(helperSymbol!.symbolId, mainFile!.fileId, 4, 10);
        db.exec(`
          CREATE TABLE IF NOT EXISTS Diagnostics (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            FileId INTEGER NOT NULL,
            Severity TEXT NOT NULL,
            Message TEXT NOT NULL,
            StartLine INTEGER NOT NULL,
            StartColumn INTEGER NOT NULL,
            EndLine INTEGER NOT NULL,
            EndColumn INTEGER NOT NULL,
            Provider TEXT NOT NULL
          );
        `);
        db.prepare(
          'INSERT INTO Diagnostics(FileId, Severity, Message, StartLine, StartColumn, EndLine, EndColumn, Provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(mainFile!.fileId, 'info', 'parser-backed diagnostic', 4, 10, 4, 16, 'clangd');

        const handle: LoadedCodeIndex = {
          db: new BetterSqliteCodeIndexDatabase(db as unknown as BetterSqliteDatabaseWithParams),
          version: Number(metadata.version),
          fileCount: Number(metadata.fileCount),
          buildSignature: String(metadata.buildSignature),
        };
        const backend = new IndexedLanguageBackend(handle);
        const context = {
          filePath: 'src/main.c',
          content: fs.readFileSync(path.join(repoDir, 'src/main.c'), 'utf8'),
          workspaceFilePaths: ['include/foo.h', 'src/foo.c', 'src/main.c'],
        };

        await expect(backend.getDefinition('helper', context)).resolves.toMatchObject({
          name: 'helper',
          kind: 'function',
          file: 'src/foo.c',
        });

        await expect(
          backend.getReferences('helper', { ...context, includeDeclaration: true })
        ).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ file: 'src/foo.c' }),
            expect.objectContaining({ file: 'src/main.c' }),
          ])
        );

        await expect(backend.getHover('helper', context)).resolves.toMatchObject({
          markdown: expect.arrayContaining([
            expect.stringContaining('**helper**'),
            expect.stringContaining('Line'),
          ]),
        });

        await expect(backend.getRelationships(context)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'dependency',
              direction: 'outgoing',
              sourcePath: 'src/main.c',
              targetPath: 'include/foo.h',
              symbols: ['foo.h'],
            }),
            expect.objectContaining({
              kind: 'call',
              direction: 'outgoing',
              sourcePath: 'src/main.c',
              targetPath: 'include/foo.h',
              symbols: ['helper'],
            }),
          ])
        );

        await expect(backend.getDiagnostics(context)).resolves.toEqual([
          expect.objectContaining({
            file: 'src/main.c',
            severity: 'info',
            message: 'parser-backed diagnostic',
          }),
        ]);

        await expect(
          backend.getDocumentSymbols({
            ...context,
            filePath: 'include/foo.h',
            content: fs.readFileSync(path.join(repoDir, 'include/foo.h'), 'utf8'),
          })
        ).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'Config',
              type: 'struct',
              members: expect.arrayContaining([
                expect.objectContaining({ name: 'enabled', type: 'int' }),
                expect.objectContaining({ name: 'mode', type: 'int' }),
              ]),
            }),
          ])
        );

        await expect(
          backend.getTypeMembers('Config', {
            ...context,
            filePath: 'include/foo.h',
            content: fs.readFileSync(path.join(repoDir, 'include/foo.h'), 'utf8'),
          })
        ).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'enabled', type: 'int' }),
            expect.objectContaining({ name: 'mode', type: 'int' }),
          ])
        );

        await expect(backend.getIncludeChain(context)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourcePath: 'src/main.c',
              targetPath: 'include/foo.h',
              type: 'includes',
            }),
          ])
        );
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('semantic enrichment records C-family analysis as not applicable without C-family sources', async () => {
    const { tempDir, repoDir } = createSyntheticRepo();

    try {
      fs.rmSync(path.join(repoDir, 'src'), { recursive: true });
      buildCodeIndex(
        repoDir,
        [
          {
            name: 'lib',
            path: 'lib',
            type: 'directory',
            children: [{ name: 'util.py', path: 'lib/util.py', type: 'file' }],
          },
        ],
        'synthetic-semantic-unavailable-signature',
        { log: () => {}, warn: () => {} }
      );

      const stats = await enrichCodeIndexWithClangd(
        repoDir,
        path.join(repoDir, CODE_INDEX_FILE_NAME),
        { log: () => {}, warn: () => {} }
      );

      expect(stats).toMatchObject({
        status: 'unavailable',
        filesAnalyzed: 0,
        callEdges: 0,
        detail: 'Not applicable: this snapshot contains no C-family compilation units.',
      });

      const db = new Database(path.join(repoDir, CODE_INDEX_FILE_NAME), {
        readonly: true,
        fileMustExist: true,
      });
      try {
        const handle: LoadedCodeIndex = {
          db: new BetterSqliteCodeIndexDatabase(db as unknown as BetterSqliteDatabaseWithParams),
          version: CODE_INDEX_VERSION,
          fileCount: 1,
          buildSignature: 'synthetic-semantic-unavailable-signature',
        };
        expect(getCodeIndexCapabilities(handle)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              language: 'c-family',
              feature: 'calls',
              provider: 'clangd',
              status: 'unavailable',
              detail: 'Not applicable: this snapshot contains no C-family compilation units.',
            }),
            expect.objectContaining({
              language: 'c-family',
              feature: 'includeChains',
              provider: 'heuristic-indexer',
              status: 'partial',
            }),
          ])
        );
        expect(getCodeIndexDiagnostics(handle, 'src/main.c')).toEqual([]);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
