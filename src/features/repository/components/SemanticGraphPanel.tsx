'use client';

import { useMemo, useState } from 'react';
import type {
  SemanticRelationship,
  SemanticRelationshipKind,
} from '@/lib/semantic-backend-contract';

type GraphKind = Exclude<SemanticRelationshipKind, 'other'>;
type Direction = 'both' | 'incoming' | 'outgoing';

interface SemanticGraphPanelProps {
  filePath: string;
  symbolName?: string | null;
  relationships: SemanticRelationship[];
  isLoading: boolean;
  error: string | null;
  onClose?: () => void;
  onOpenFile?: (path: string) => void;
}

const GRAPH_KINDS: Array<{ id: GraphKind; label: string }> = [
  { id: 'call', label: 'Calls' },
  { id: 'dataflow', label: 'Data flow' },
  { id: 'dependency', label: 'Dependencies' },
];

function basename(path: string): string {
  return path.split('/').pop() || path;
}

export default function SemanticGraphPanel({
  filePath,
  symbolName,
  relationships,
  isLoading,
  error,
  onClose,
  onOpenFile,
}: SemanticGraphPanelProps) {
  const [kind, setKind] = useState<GraphKind>('call');
  const [direction, setDirection] = useState<Direction>('both');

  const visibleRelationships = useMemo(
    () =>
      relationships.filter(
        (relationship) =>
          relationship.kind === kind &&
          (direction === 'both' || relationship.direction === direction) &&
          (!symbolName ||
            kind === 'dependency' ||
            relationship.symbols.length === 0 ||
            relationship.symbols.some((symbol) =>
              symbol
                .split('→')
                .map((part) => part.trim())
                .includes(symbolName)
            ))
      ),
    [direction, kind, relationships, symbolName]
  );

  const relatedPaths = useMemo(
    () =>
      Array.from(
        new Set(
          visibleRelationships.flatMap((relationship) =>
            kind === 'dataflow'
              ? relationship.symbols
              : [
                  relationship.direction === 'outgoing'
                    ? relationship.targetPath
                    : relationship.sourcePath,
                ]
          )
        )
      ).slice(0, 100),
    [kind, visibleRelationships]
  );

  return (
    <aside className="explorar-semantic-panel" aria-label="Semantic graph">
      <div className="explorar-xref-panel-header">
        <div className="explorar-xref-panel-title-wrap">
          <div className="explorar-xref-panel-label">Semantic graph</div>
          <div className="explorar-xref-panel-title">
            {symbolName || basename(filePath)}
            {!isLoading && (
              <span className="explorar-xref-panel-count">{visibleRelationships.length}</span>
            )}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            className="explorar-xref-panel-close"
            aria-label="Close semantic graph"
            onClick={onClose}
          >
            ✕
          </button>
        )}
      </div>

      <div className="explorar-semantic-toolbar" role="toolbar" aria-label="Graph controls">
        <div className="explorar-semantic-tabs" role="tablist" aria-label="Relationship type">
          {GRAPH_KINDS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={kind === entry.id}
              className={kind === entry.id ? 'is-active' : undefined}
              onClick={() => setKind(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Relationship direction"
          value={direction}
          onChange={(event) => setDirection(event.target.value as Direction)}
        >
          <option value="both">Incoming and outgoing</option>
          <option value="incoming">Incoming</option>
          <option value="outgoing">Outgoing</option>
        </select>
      </div>

      <div className="explorar-semantic-graph-body">
        {isLoading ? (
          <div className="explorar-xref-panel-empty">Loading semantic relationships…</div>
        ) : error ? (
          <div className="explorar-xref-panel-empty">{error}</div>
        ) : kind === 'dataflow' && visibleRelationships.length === 0 ? (
          <div className="explorar-xref-panel-empty">
            Compiler-backed def-use data is unavailable for this symbol.
          </div>
        ) : visibleRelationships.length === 0 ? (
          <div className="explorar-xref-panel-empty">
            No {kind === 'call' ? 'call' : 'dependency'} relationships match this selection.
          </div>
        ) : (
          <>
            <svg
              className="explorar-semantic-graph"
              viewBox={`0 0 760 ${Math.max(180, relatedPaths.length * 54 + 32)}`}
              role="img"
              aria-label={`${kind} graph for ${symbolName || basename(filePath)}`}
            >
              <g className="explorar-semantic-edges">
                {relatedPaths.map((relatedPath, index) => (
                  <line key={relatedPath} x1="260" y1={90} x2="510" y2={48 + index * 54} />
                ))}
              </g>
              <g className="explorar-semantic-root">
                <rect x="24" y="66" width="236" height="48" rx="7" />
                <text x="38" y="95">
                  {symbolName || basename(filePath)}
                </text>
              </g>
              {relatedPaths.map((relatedPath, index) => (
                <g key={relatedPath} className="explorar-semantic-node">
                  <rect x="510" y={24 + index * 54} width="226" height="44" rx="7" />
                  <text x="524" y={51 + index * 54}>
                    {basename(relatedPath)}
                  </text>
                </g>
              ))}
            </svg>
            <div className="explorar-semantic-result-list" aria-label="Graph nodes">
              {visibleRelationships.map((relationship, index) => {
                const relatedPath =
                  relationship.direction === 'outgoing'
                    ? relationship.targetPath
                    : relationship.sourcePath;
                return (
                  <button
                    key={`${relationship.indexedType}:${relatedPath}:${index}`}
                    type="button"
                    onClick={() => onOpenFile?.(relatedPath)}
                  >
                    <span className={`explorar-relationship-kind is-${relationship.kind}`}>
                      {relationship.direction}
                    </span>
                    <span className="explorar-relationship-detail">
                      <span>{relatedPath}</span>
                      <small>
                        {relationship.symbols.slice(0, 3).join(', ') || relationship.indexedType}
                        {' · '}
                        {relationship.provider} ({relationship.confidence})
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
