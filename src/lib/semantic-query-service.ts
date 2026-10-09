import type { CodeIndexEdgeEntry } from './code-index';
import type { Location, StructMember, SymbolReference } from './cross-reference';
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
} from './semantic-backend-contract';

export interface SemanticQueryServiceOptions {
  debugLog?: (message: string, details?: Record<string, unknown>) => void;
}

export class SemanticQueryService {
  private readonly backendsByLanguage = new Map<string, LanguageBackend[]>();

  constructor(
    backends: LanguageBackend[] = [],
    private readonly options: SemanticQueryServiceOptions = {}
  ) {
    for (const backend of backends) {
      this.register(backend);
    }
  }

  register(backend: LanguageBackend): void {
    for (const languageId of backend.languageIds) {
      const registered = (this.backendsByLanguage.get(languageId) ?? []).filter(
        (registeredBackend) => registeredBackend.id !== backend.id
      );
      registered.push(backend);
      this.backendsByLanguage.set(languageId, this.sortBackends(registered));
    }
  }

  getBackends(languageId: string): LanguageBackend[] {
    return this.backendsByLanguage.get(languageId) ?? [];
  }

  async findDefinition(
    languageId: string,
    symbolName: string,
    context: LanguageBackendContext
  ): Promise<BackendDefinition | null> {
    const result = await this.firstResult(languageId, {
      ...context,
      kind: 'definition',
      symbolName,
    });
    return result?.items[0] ?? null;
  }

  async findReferences(
    languageId: string,
    symbolName: string,
    context: LanguageBackendContext & { includeDeclaration?: boolean }
  ): Promise<Location[]> {
    const results = await this.mergedResults(languageId, {
      ...context,
      kind: 'references',
      symbolName,
      includeDeclaration: context.includeDeclaration,
    });
    return dedupeBy(
      results.flatMap((result) => result.items),
      locationKey
    );
  }

  async getHover(
    languageId: string,
    symbolName: string,
    context: LanguageBackendContext
  ): Promise<BackendHover | null> {
    const result = await this.firstResult(languageId, { ...context, kind: 'hover', symbolName });
    return result?.items[0] ?? null;
  }

  async getDiagnostics(
    languageId: string,
    context: LanguageBackendContext
  ): Promise<BackendDiagnostic[]> {
    const results = await this.mergedResults(languageId, { ...context, kind: 'diagnostics' });
    return results.flatMap((result) => result.items);
  }

  async getDocumentSymbols(
    languageId: string,
    context: LanguageBackendContext
  ): Promise<SymbolReference[]> {
    const result = await this.firstResult(languageId, { ...context, kind: 'documentSymbols' });
    return result?.items ?? [];
  }

  async getRelationships(
    languageId: string,
    context: LanguageBackendContext
  ): Promise<SemanticRelationship[]> {
    const results = await this.mergedResults(languageId, { ...context, kind: 'relationships' });
    return dedupeBy(
      results.flatMap((result) => result.items),
      relationshipKey
    );
  }

  async getTypeMembers(
    languageId: string,
    symbolName: string,
    context: LanguageBackendContext
  ): Promise<StructMember[]> {
    const result = await this.firstResult(languageId, {
      ...context,
      kind: 'typeMembers',
      symbolName,
    });
    return result?.items ?? [];
  }

  async getIncludeChain(
    languageId: string,
    context: LanguageBackendContext,
    options?: { direction?: 'incoming' | 'outgoing' | 'both'; maxDepth?: number; limit?: number }
  ): Promise<CodeIndexEdgeEntry[]> {
    const result = await this.firstResult(languageId, {
      ...context,
      kind: 'includeChains',
      ...options,
    });
    return result?.items ?? [];
  }

  private async firstResult<TKind extends SemanticQueryKind>(
    languageId: string,
    query: Extract<SemanticQuery, { kind: TKind }>
  ): Promise<SemanticQueryResult<TKind> | null> {
    for (const backend of this.capableBackends(languageId, query.kind)) {
      const result = await this.queryBackend(backend, query);
      if (result && result.items.length > 0) {
        return result;
      }
    }
    return null;
  }

  private async mergedResults<TKind extends SemanticQueryKind>(
    languageId: string,
    query: Extract<SemanticQuery, { kind: TKind }>
  ): Promise<SemanticQueryResult<TKind>[]> {
    const results = await Promise.all(
      this.capableBackends(languageId, query.kind).map((backend) =>
        this.queryBackend(backend, query)
      )
    );
    return results.filter((result): result is SemanticQueryResult<TKind> => Boolean(result));
  }

  private capableBackends(languageId: string, kind: SemanticQueryKind): LanguageBackend[] {
    return this.getBackends(languageId).filter(
      (backend) => backend.capabilities[kind] !== 'unavailable'
    );
  }

  private async queryBackend<TKind extends SemanticQueryKind>(
    backend: LanguageBackend,
    query: Extract<SemanticQuery, { kind: TKind }>
  ): Promise<SemanticQueryResult<TKind> | null> {
    try {
      return await backend.query(query);
    } catch (error) {
      this.options.debugLog?.('[explorar:semantic] backend-error', {
        backend: backend.id,
        query: query.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private sortBackends(backends: LanguageBackend[]): LanguageBackend[] {
    return [...backends].sort((left, right) => backendRank(left) - backendRank(right));
  }
}

function backendRank(backend: LanguageBackend): number {
  if (backend.id === 'indexed') return 0;
  if (backend.id === 'heuristic') return 100;
  return 50;
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  return Array.from(new Map(items.map((item) => [getKey(item), item])).values());
}

function locationKey(location: Location): string {
  return `${location.file}:${location.line}:${location.column}`;
}

function relationshipKey(relationship: SemanticRelationship): string {
  return `${relationship.indexedType}:${relationship.sourcePath}:${relationship.targetPath}:${relationship.symbols.join(',')}`;
}
