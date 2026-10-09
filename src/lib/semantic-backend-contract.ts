import type { CodeIndexEdgeEntry } from './code-index';
import type { Location, StructMember, SymbolReference } from './cross-reference';

export type SemanticCapabilityStatus = 'available' | 'partial' | 'unavailable';
export type SemanticConfidence = 'high' | 'medium' | 'low';

export type SemanticBackendFeature =
  | 'definition'
  | 'references'
  | 'hover'
  | 'diagnostics'
  | 'documentSymbols'
  | 'typeMembers'
  | 'includeChains'
  | 'relationships'
  | 'calls'
  | 'dataflow';

export type SemanticQueryKind =
  | 'definition'
  | 'references'
  | 'hover'
  | 'diagnostics'
  | 'documentSymbols'
  | 'typeMembers'
  | 'includeChains'
  | 'relationships';

export interface BackendDefinition {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  signature?: string;
  documentation?: string;
}

export interface BackendHover {
  markdown: string[];
}

export interface BackendDiagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export type SemanticRelationshipKind = 'call' | 'dependency' | 'dataflow' | 'other';

export interface SemanticRelationship {
  kind: SemanticRelationshipKind;
  direction: 'incoming' | 'outgoing';
  sourcePath: string;
  targetPath: string;
  symbols: string[];
  indexedType: string;
  provider: string;
  confidence: SemanticConfidence;
}

export type LanguageBackendCapabilities = Partial<
  Record<SemanticQueryKind, SemanticCapabilityStatus>
>;

export interface LanguageBackendContext {
  filePath: string;
  content: string;
  workspaceFilePaths: string[];
  /** One-based cursor position. End positions in backend results are exclusive. */
  position?: { line: number; column: number };
  includeDeclaration?: boolean;
}

export type SemanticQuery =
  | (LanguageBackendContext & { kind: 'definition'; symbolName: string })
  | (LanguageBackendContext & {
      kind: 'references';
      symbolName: string;
      includeDeclaration?: boolean;
    })
  | (LanguageBackendContext & { kind: 'hover'; symbolName: string })
  | (LanguageBackendContext & { kind: 'diagnostics' })
  | (LanguageBackendContext & { kind: 'documentSymbols' })
  | (LanguageBackendContext & { kind: 'typeMembers'; symbolName: string })
  | (LanguageBackendContext & {
      kind: 'includeChains';
      direction?: 'incoming' | 'outgoing' | 'both';
      maxDepth?: number;
      limit?: number;
    })
  | (LanguageBackendContext & { kind: 'relationships' });

export interface SemanticQueryResult<TKind extends SemanticQueryKind = SemanticQueryKind> {
  kind: TKind;
  items: SemanticQueryItems<TKind>;
  provider: string;
  confidence: SemanticConfidence;
  complete: boolean;
}

export type SemanticQueryItems<TKind extends SemanticQueryKind> = TKind extends 'definition'
  ? BackendDefinition[]
  : TKind extends 'references'
    ? Location[]
    : TKind extends 'hover'
      ? BackendHover[]
      : TKind extends 'diagnostics'
        ? BackendDiagnostic[]
        : TKind extends 'documentSymbols'
          ? SymbolReference[]
          : TKind extends 'typeMembers'
            ? StructMember[]
            : TKind extends 'includeChains'
              ? CodeIndexEdgeEntry[]
              : TKind extends 'relationships'
                ? SemanticRelationship[]
                : never;

export interface LanguageBackend {
  id: string;
  languageIds: string[];
  capabilities: LanguageBackendCapabilities;
  query<TKind extends SemanticQueryKind>(
    query: Extract<SemanticQuery, { kind: TKind }>
  ): Promise<SemanticQueryResult<TKind>>;
  getDefinition(
    symbolName: string,
    context: LanguageBackendContext
  ): Promise<BackendDefinition | null>;
  getReferences(symbolName: string, context: LanguageBackendContext): Promise<Location[]>;
  getHover(symbolName: string, context: LanguageBackendContext): Promise<BackendHover | null>;
  getDiagnostics(context: LanguageBackendContext): Promise<BackendDiagnostic[]>;
  getDocumentSymbols(context: LanguageBackendContext): Promise<SymbolReference[]>;
  getRelationships(context: LanguageBackendContext): Promise<SemanticRelationship[]>;
}

export interface SemanticIndexStats {
  status: SemanticCapabilityStatus;
  filesAnalyzed: number;
  callEdges: number;
  detail: string;
}

export type SemanticCapabilityRecord = {
  language: string;
  feature: SemanticBackendFeature;
  provider: string;
  status: SemanticCapabilityStatus;
  detail: string | null;
};

export const CLANGD_BACKEND_FEATURES = [
  'definition',
  'references',
  'hover',
  'diagnostics',
  'documentSymbols',
  'typeMembers',
  'calls',
] as const satisfies readonly SemanticBackendFeature[];
