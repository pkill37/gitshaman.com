import { expect, test } from '@playwright/test';
import { SemanticQueryService } from '@/lib/semantic-query-service';
import type {
  BackendDefinition,
  BackendDiagnostic,
  BackendHover,
  LanguageBackend,
  LanguageBackendContext,
  SemanticQuery,
  SemanticQueryKind,
  SemanticQueryResult,
  SemanticRelationship,
} from '@/lib/semantic-backend-contract';

const context: LanguageBackendContext = {
  filePath: 'src/main.c',
  content: 'int main(void) { return helper(); }',
  workspaceFilePaths: ['src/main.c', 'src/helper.c'],
};

test('indexed definition wins over heuristic definition', async () => {
  const service = new SemanticQueryService([
    backend({
      id: 'heuristic',
      definition: [{ name: 'helper', kind: 'function', file: 'src/main.c', line: 1, column: 24 }],
    }),
    backend({
      id: 'indexed',
      definition: [{ name: 'helper', kind: 'function', file: 'src/helper.c', line: 3, column: 5 }],
    }),
  ]);

  await expect(service.findDefinition('c', 'helper', context)).resolves.toMatchObject({
    file: 'src/helper.c',
  });
});

test('heuristic definition is used when indexed data is absent', async () => {
  const service = new SemanticQueryService([
    backend({ id: 'indexed', definition: [] }),
    backend({
      id: 'heuristic',
      definition: [{ name: 'helper', kind: 'function', file: 'src/main.c', line: 1, column: 24 }],
    }),
  ]);

  await expect(service.findDefinition('c', 'helper', context)).resolves.toMatchObject({
    file: 'src/main.c',
  });
});

test('hover follows indexed-first precedence', async () => {
  const service = new SemanticQueryService([
    backend({ id: 'heuristic', hover: [{ markdown: ['heuristic'] }] }),
    backend({ id: 'indexed', hover: [{ markdown: ['indexed'] }] }),
  ]);

  await expect(service.getHover('c', 'helper', context)).resolves.toEqual({
    markdown: ['indexed'],
  });
});

test('references merge and deduplicate backend results', async () => {
  const service = new SemanticQueryService([
    backend({
      id: 'indexed',
      references: [
        { file: 'src/helper.c', line: 3, column: 5 },
        { file: 'src/main.c', line: 1, column: 24 },
      ],
    }),
    backend({
      id: 'heuristic',
      references: [
        { file: 'src/main.c', line: 1, column: 24 },
        { file: 'src/other.c', line: 9, column: 2 },
      ],
    }),
  ]);

  await expect(service.findReferences('c', 'helper', context)).resolves.toEqual([
    { file: 'src/helper.c', line: 3, column: 5 },
    { file: 'src/main.c', line: 1, column: 24 },
    { file: 'src/other.c', line: 9, column: 2 },
  ]);
});

test('diagnostics use capable providers only', async () => {
  const service = new SemanticQueryService([
    backend({
      id: 'indexed',
      diagnostics: [
        { file: 'src/main.c', line: 1, column: 1, message: 'parser diagnostic', severity: 'info' },
      ],
    }),
    backend({ id: 'heuristic', capabilities: { diagnostics: 'unavailable' }, diagnostics: [] }),
  ]);

  await expect(service.getDiagnostics('c', context)).resolves.toEqual([
    { file: 'src/main.c', line: 1, column: 1, message: 'parser diagnostic', severity: 'info' },
  ]);
});

test('unsupported capabilities return empty results', async () => {
  const service = new SemanticQueryService([
    backend({
      id: 'heuristic',
      capabilities: { typeMembers: 'unavailable', includeChains: 'unavailable' },
      typeMembers: [{ name: 'field', type: 'int', line: 4 }],
    }),
  ]);

  await expect(service.getTypeMembers('c', 'Config', context)).resolves.toEqual([]);
  await expect(service.getIncludeChain('c', context)).resolves.toEqual([]);
});

test('backend failures do not prevent other backends from answering', async () => {
  const service = new SemanticQueryService([
    failingBackend('indexed'),
    backend({
      id: 'heuristic',
      definition: [{ name: 'helper', kind: 'function', file: 'src/main.c', line: 1, column: 24 }],
    }),
  ]);

  await expect(service.findDefinition('c', 'helper', context)).resolves.toMatchObject({
    file: 'src/main.c',
  });
});

type BackendFixture = {
  id: string;
  capabilities?: Partial<LanguageBackend['capabilities']>;
  definition?: BackendDefinition[];
  references?: Awaited<ReturnType<SemanticQueryService['findReferences']>>;
  hover?: BackendHover[];
  diagnostics?: BackendDiagnostic[];
  documentSymbols?: Awaited<ReturnType<SemanticQueryService['getDocumentSymbols']>>;
  typeMembers?: Awaited<ReturnType<SemanticQueryService['getTypeMembers']>>;
  includeChains?: Awaited<ReturnType<SemanticQueryService['getIncludeChain']>>;
  relationships?: SemanticRelationship[];
};

function backend(fixture: BackendFixture): LanguageBackend {
  const itemsByKind = {
    definition: fixture.definition ?? [],
    references: fixture.references ?? [],
    hover: fixture.hover ?? [],
    diagnostics: fixture.diagnostics ?? [],
    documentSymbols: fixture.documentSymbols ?? [],
    typeMembers: fixture.typeMembers ?? [],
    includeChains: fixture.includeChains ?? [],
    relationships: fixture.relationships ?? [],
  };

  return {
    id: fixture.id,
    languageIds: ['c'],
    capabilities: {
      definition: 'available',
      references: 'available',
      hover: 'available',
      diagnostics: 'available',
      documentSymbols: 'available',
      typeMembers: 'available',
      includeChains: 'available',
      relationships: 'available',
      ...fixture.capabilities,
    },
    async query<TKind extends SemanticQueryKind>(
      query: Extract<SemanticQuery, { kind: TKind }>
    ): Promise<SemanticQueryResult<TKind>> {
      return {
        kind: query.kind as TKind,
        items: itemsByKind[query.kind] as SemanticQueryResult<TKind>['items'],
        provider: fixture.id,
        confidence: fixture.id === 'indexed' ? 'high' : 'low',
        complete: fixture.id === 'indexed',
      };
    },
    async getDefinition() {
      return fixture.definition?.[0] ?? null;
    },
    async getReferences() {
      return fixture.references ?? [];
    },
    async getHover() {
      return fixture.hover?.[0] ?? null;
    },
    async getDiagnostics() {
      return fixture.diagnostics ?? [];
    },
    async getDocumentSymbols() {
      return fixture.documentSymbols ?? [];
    },
    async getRelationships() {
      return fixture.relationships ?? [];
    },
  };
}

function failingBackend(id: string): LanguageBackend {
  return {
    ...backend({ id }),
    async query() {
      throw new Error('boom');
    },
  };
}
