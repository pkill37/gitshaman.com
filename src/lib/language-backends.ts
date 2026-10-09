import {
  findCodeIndexSymbolsByName,
  getCodeIndexDiagnostics,
  getCodeIndexGraphNeighbors,
  getCodeIndexIncludeChain,
  getCodeIndexMembersForSymbol,
  getCodeIndexReferencesForSymbol,
  getCodeIndexSymbolsForFile,
  type CodeIndexEdgeEntry,
  type CodeIndexSymbolEntry,
  type LoadedCodeIndex,
} from './code-index';
import type { Location, StructMember, SymbolReference } from './cross-reference';
import type {
  BackendDefinition,
  BackendDiagnostic,
  BackendHover,
  LanguageBackend,
  LanguageBackendCapabilities,
  LanguageBackendContext,
  SemanticQuery,
  SemanticQueryKind,
  SemanticQueryResult,
  SemanticRelationship,
  SemanticRelationshipKind,
} from './semantic-backend-contract';

function normalizeSymbolQuery(symbolName: string): string {
  return symbolName
    .trim()
    .replace(/\(\)$/, '')
    .replace(/^(struct|class|enum)\s+/, '');
}

function symbolEntryToDefinition(symbol: CodeIndexSymbolEntry): BackendDefinition {
  return {
    name: symbol.name,
    kind: symbol.kind,
    file: symbol.path,
    line: symbol.startLine,
    column: symbol.startColumn,
    signature: symbol.signature ?? undefined,
    documentation: symbol.doc ?? undefined,
  };
}

function symbolEntryToSymbolReference(
  symbol: CodeIndexSymbolEntry,
  members: StructMember[],
  references: Location[]
): SymbolReference {
  const type =
    symbol.kind === 'struct' ||
    symbol.kind === 'class' ||
    symbol.kind === 'typedef' ||
    symbol.kind === 'macro' ||
    symbol.kind === 'variable'
      ? symbol.kind
      : symbol.kind === 'type'
        ? 'typedef'
        : 'function';

  return {
    name: symbol.name,
    type,
    line: symbol.startLine,
    column: symbol.startColumn,
    file: symbol.path,
    isDefinition: symbol.isDefinition,
    isDeclaration: symbol.isDeclaration,
    signature: symbol.signature ?? undefined,
    documentation: symbol.doc ?? undefined,
    members: members.length > 0 ? members : undefined,
    references,
    relatedSymbols: [],
  };
}

export class IndexedLanguageBackend implements LanguageBackend {
  id = 'indexed';

  languageIds = ['c', 'cpp', 'python', 'typescript', 'javascript'];

  capabilities: LanguageBackendCapabilities = {
    definition: 'available',
    references: 'available',
    hover: 'available',
    diagnostics: 'unavailable',
    documentSymbols: 'available',
    typeMembers: 'available',
    includeChains: 'available',
    relationships: 'available',
  };

  constructor(private readonly codeIndex: LoadedCodeIndex | null) {
    this.capabilities = {
      ...this.capabilities,
      diagnostics: codeIndex && codeIndex.version >= 4 ? 'available' : 'unavailable',
    };
  }

  async query<TKind extends SemanticQueryKind>(
    query: Extract<SemanticQuery, { kind: TKind }>
  ): Promise<SemanticQueryResult<TKind>> {
    const items = (await this.executeQuery(query)) as SemanticQueryResult<TKind>['items'];
    return {
      kind: query.kind as TKind,
      items,
      provider: this.id,
      confidence: 'high',
      complete: Boolean(this.codeIndex),
    };
  }

  private async executeQuery(query: SemanticQuery) {
    switch (query.kind) {
      case 'definition': {
        const definition = await this.getDefinition(query.symbolName, query);
        return definition ? [definition] : [];
      }
      case 'references':
        return this.getReferences(query.symbolName, query);
      case 'hover': {
        const hover = await this.getHover(query.symbolName, query);
        return hover ? [hover] : [];
      }
      case 'diagnostics':
        return this.getDiagnostics(query);
      case 'documentSymbols':
        return this.getDocumentSymbols(query);
      case 'typeMembers':
        return this.getTypeMembers(query.symbolName, query);
      case 'includeChains':
        return this.getIncludeChain(query, {
          direction: query.direction,
          maxDepth: query.maxDepth,
          limit: query.limit,
        });
      case 'relationships':
        return this.getRelationships(query);
    }
  }

  async getDefinition(
    symbolName: string,
    context: LanguageBackendContext
  ): Promise<BackendDefinition | null> {
    if (!this.codeIndex) {
      return null;
    }

    const normalizedSymbol = normalizeSymbolQuery(symbolName);
    const localDefinitions = findCodeIndexSymbolsByName(this.codeIndex, normalizedSymbol, {
      path: context.filePath,
      definitionOnly: true,
      limit: 1,
    });
    const workspaceDefinitions =
      localDefinitions.length > 0
        ? localDefinitions
        : findCodeIndexSymbolsByName(this.codeIndex, normalizedSymbol, {
            definitionOnly: true,
            limit: 10,
          });
    const definition = workspaceDefinitions[0];
    return definition ? symbolEntryToDefinition(definition) : null;
  }

  async getReferences(symbolName: string, context: LanguageBackendContext): Promise<Location[]> {
    if (!this.codeIndex) {
      return [];
    }

    const normalizedSymbol = normalizeSymbolQuery(symbolName);
    const definitions = findCodeIndexSymbolsByName(this.codeIndex, normalizedSymbol, {
      definitionOnly: true,
      limit: 20,
    });
    const fallbackSymbols =
      definitions.length > 0
        ? definitions
        : findCodeIndexSymbolsByName(this.codeIndex, normalizedSymbol, { limit: 20 });

    const references = fallbackSymbols.flatMap((symbol) =>
      getCodeIndexReferencesForSymbol(
        this.codeIndex!,
        symbol.symbolId,
        Boolean(context.includeDeclaration)
      )
    );

    return Array.from(
      new Map(
        references.map((reference) => [
          `${reference.path}:${reference.line}:${reference.column}`,
          {
            file: reference.path,
            line: reference.line,
            column: reference.column,
          },
        ])
      ).values()
    );
  }

  async getHover(
    symbolName: string,
    context: LanguageBackendContext
  ): Promise<BackendHover | null> {
    if (!this.codeIndex) {
      return null;
    }

    const definition = await this.getDefinition(symbolName, context);
    if (!definition) {
      return null;
    }

    const markdown = [`**${definition.name}** \`${definition.kind}\``];
    if (definition.signature) {
      markdown.push('```c\n' + definition.signature + '\n```');
    }
    if (definition.documentation) {
      markdown.push(`*${definition.documentation}*`);
    }
    markdown.push(`Line ${definition.line} in ${definition.file.split('/').pop()}`);
    return { markdown };
  }

  async getDiagnostics(context: LanguageBackendContext): Promise<BackendDiagnostic[]> {
    if (!this.codeIndex) return [];
    return getCodeIndexDiagnostics(this.codeIndex, context.filePath).map((diagnostic) => ({
      file: diagnostic.path,
      line: diagnostic.startLine,
      column: diagnostic.startColumn,
      message: diagnostic.message,
      severity: diagnostic.severity,
    }));
  }

  async getDocumentSymbols(context: LanguageBackendContext): Promise<SymbolReference[]> {
    if (!this.codeIndex) {
      return [];
    }

    const symbols = getCodeIndexSymbolsForFile(this.codeIndex, context.filePath, {
      limit: 1_000,
    });
    return symbols.map((symbol) =>
      symbolEntryToSymbolReference(
        symbol,
        getCodeIndexMembersForSymbol(this.codeIndex!, symbol.symbolId).map((member) => ({
          name: member.name,
          type: member.type,
          line: member.line,
        })),
        getCodeIndexReferencesForSymbol(this.codeIndex!, symbol.symbolId).map((reference) => ({
          file: reference.path,
          line: reference.line,
          column: reference.column,
        }))
      )
    );
  }

  async getRelationships(context: LanguageBackendContext): Promise<SemanticRelationship[]> {
    if (!this.codeIndex) {
      return [];
    }

    return getCodeIndexGraphNeighbors(this.codeIndex, context.filePath).map((edge) => ({
      kind: classifyIndexedRelationship(edge.type),
      direction: edge.sourcePath === context.filePath ? 'outgoing' : 'incoming',
      sourcePath: edge.sourcePath,
      targetPath: edge.targetPath,
      symbols: edge.symbols,
      indexedType: edge.type,
      provider: edge.provider,
      confidence: edge.confidence,
    }));
  }

  async getTypeMembers(
    symbolName: string,
    context: LanguageBackendContext
  ): Promise<StructMember[]> {
    if (!this.codeIndex) {
      return [];
    }

    const normalizedSymbol = normalizeSymbolQuery(symbolName);
    const candidates = [
      ...findCodeIndexSymbolsByName(this.codeIndex, normalizedSymbol, {
        path: context.filePath,
        definitionOnly: true,
        limit: 5,
      }),
      ...findCodeIndexSymbolsByName(this.codeIndex, normalizedSymbol, {
        definitionOnly: true,
        limit: 20,
      }),
    ];
    const typeSymbol = candidates.find((symbol) =>
      ['struct', 'class', 'type', 'typedef'].includes(symbol.kind)
    );
    if (!typeSymbol) {
      return [];
    }

    return getCodeIndexMembersForSymbol(this.codeIndex, typeSymbol.symbolId).map((member) => ({
      name: member.name,
      type: member.type,
      line: member.line,
    }));
  }

  async getIncludeChain(
    context: LanguageBackendContext,
    options?: { direction?: 'incoming' | 'outgoing' | 'both'; maxDepth?: number; limit?: number }
  ): Promise<CodeIndexEdgeEntry[]> {
    if (!this.codeIndex) {
      return [];
    }
    return getCodeIndexIncludeChain(this.codeIndex, context.filePath, options);
  }
}

function classifyIndexedRelationship(type: string): SemanticRelationshipKind {
  const normalizedType = type.toLowerCase();
  if (normalizedType === 'calls' || normalizedType.includes('call')) return 'call';
  if (/read|write|flow|assign|mutat|produce|consume/.test(normalizedType)) return 'dataflow';
  if (/include|import|depend|use/.test(normalizedType)) return 'dependency';
  return 'other';
}

export class HeuristicLanguageBackend implements LanguageBackend {
  id = 'heuristic';

  languageIds = ['c', 'cpp', 'python', 'typescript', 'javascript'];

  capabilities: LanguageBackendCapabilities = {
    definition: 'available',
    references: 'available',
    hover: 'available',
    diagnostics: 'unavailable',
    documentSymbols: 'available',
    relationships: 'unavailable',
  };

  constructor(
    private readonly implementation: Pick<
      LanguageBackend,
      'getDefinition' | 'getReferences' | 'getHover' | 'getDiagnostics' | 'getDocumentSymbols'
    >
  ) {}

  async query<TKind extends SemanticQueryKind>(
    query: Extract<SemanticQuery, { kind: TKind }>
  ): Promise<SemanticQueryResult<TKind>> {
    const items = (await this.executeQuery(query)) as SemanticQueryResult<TKind>['items'];
    return {
      kind: query.kind as TKind,
      items,
      provider: this.id,
      confidence: 'low',
      complete: false,
    };
  }

  private async executeQuery(query: SemanticQuery) {
    switch (query.kind) {
      case 'definition': {
        const definition = await this.getDefinition(query.symbolName, query);
        return definition ? [definition] : [];
      }
      case 'references':
        return this.getReferences(query.symbolName, query);
      case 'hover': {
        const hover = await this.getHover(query.symbolName, query);
        return hover ? [hover] : [];
      }
      case 'diagnostics':
        return this.getDiagnostics(query);
      case 'documentSymbols':
        return this.getDocumentSymbols(query);
      case 'relationships':
      case 'typeMembers':
      case 'includeChains':
        return [];
    }
  }

  getDefinition(
    symbolName: string,
    context: LanguageBackendContext
  ): Promise<BackendDefinition | null> {
    return this.implementation.getDefinition(symbolName, context);
  }

  getReferences(symbolName: string, context: LanguageBackendContext): Promise<Location[]> {
    return this.implementation.getReferences(symbolName, context);
  }

  getHover(symbolName: string, context: LanguageBackendContext): Promise<BackendHover | null> {
    return this.implementation.getHover(symbolName, context);
  }

  getDiagnostics(context: LanguageBackendContext): Promise<BackendDiagnostic[]> {
    return this.implementation.getDiagnostics(context);
  }

  getDocumentSymbols(context: LanguageBackendContext): Promise<SymbolReference[]> {
    return this.implementation.getDocumentSymbols(context);
  }

  async getRelationships(): Promise<SemanticRelationship[]> {
    return [];
  }
}
