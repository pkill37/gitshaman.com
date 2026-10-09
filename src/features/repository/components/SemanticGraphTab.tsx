'use client';

import { useEffect, useMemo, useState } from 'react';
import SidebarSearchHeader from './SidebarSearchHeader';
import SemanticGraphPanel from './SemanticGraphPanel';
import {
  CODE_INDEX_SEARCH_RESULT_LIMIT,
  getCodeIndexGraphEdges,
  type LoadedCodeIndex,
} from '@/lib/code-index';
import type {
  SemanticRelationship,
  SemanticRelationshipKind,
} from '@/lib/semantic-backend-contract';

interface SemanticGraphTabProps {
  isActive: boolean;
  codeIndex: LoadedCodeIndex | null;
  indexLoading: boolean;
  indexReady: boolean;
  indexError: string | null;
  indexProgress: number;
  indexCached: boolean;
  repoLabel: string;
  onOpenFile?: (path: string) => void;
}

function classifyRelationship(type: string): SemanticRelationshipKind {
  const normalizedType = type.toLowerCase();
  if (normalizedType === 'calls' || normalizedType.includes('call')) return 'call';
  if (/read|write|flow|assign|mutat|produce|consume/.test(normalizedType)) return 'dataflow';
  if (/include|import|depend|use/.test(normalizedType)) return 'dependency';
  return 'other';
}

export default function SemanticGraphTab({
  isActive,
  codeIndex,
  indexLoading,
  indexReady,
  indexError,
  indexProgress,
  indexCached,
  repoLabel,
  onOpenFile,
}: SemanticGraphTabProps) {
  const [graphResult, setGraphResult] = useState<{
    codeIndex: LoadedCodeIndex;
    relationships: SemanticRelationship[];
    error: string | null;
  } | null>(null);
  const currentGraphResult = graphResult?.codeIndex === codeIndex ? graphResult : null;
  const relationships = currentGraphResult?.relationships ?? [];
  const graphError = currentGraphResult?.error ?? null;
  const hasLoadedGraph = currentGraphResult !== null && !graphError;
  const isGraphLoading = isActive && codeIndex !== null && currentGraphResult === null;

  useEffect(() => {
    if (!isActive || !codeIndex || currentGraphResult) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      try {
        const nextRelationships = getCodeIndexGraphEdges(
          codeIndex,
          CODE_INDEX_SEARCH_RESULT_LIMIT * 4
        ).map((edge) => ({
          kind: classifyRelationship(edge.type),
          direction: 'outgoing' as const,
          sourcePath: edge.sourcePath,
          targetPath: edge.targetPath,
          symbols: edge.symbols,
          indexedType: edge.type,
          provider: edge.provider,
          confidence: edge.confidence,
        }));

        setGraphResult({ codeIndex, relationships: nextRelationships, error: null });
      } catch (error) {
        setGraphResult({
          codeIndex,
          relationships: [],
          error: error instanceof Error ? error.message : 'Failed to load semantic graph',
        });
      }
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [codeIndex, currentGraphResult, isActive]);

  const statusLabel = useMemo(() => {
    if (indexError) return 'Semantic index unavailable';
    if (indexLoading) return `${Math.max(0, Math.min(100, indexProgress)).toFixed(1)}% loaded`;
    if (isGraphLoading) return 'Building semantic graph';
    if (hasLoadedGraph) return indexCached ? 'Cached semantic graph ready' : 'Semantic graph ready';
    return 'Semantic graph waits for this tab';
  }, [hasLoadedGraph, indexCached, indexError, indexLoading, indexProgress, isGraphLoading]);

  const badgeLabel = indexError
    ? 'error'
    : indexLoading || isGraphLoading
      ? 'loading'
      : indexCached || hasLoadedGraph
        ? indexCached
          ? 'cached'
          : 'ready'
        : 'idle';

  const isLoading = indexLoading || isGraphLoading;
  const error = indexError || graphError;

  return (
    <div className="explorar-semantic-tab">
      <SidebarSearchHeader
        titleLabel="Semantic Graph"
        query=""
        onQueryChange={() => undefined}
        placeholder=""
        ariaLabel="Semantic graph"
        searchVisible={false}
        statusVisible
        statusLoading={isLoading}
        statusReady={!error && (hasLoadedGraph || indexReady)}
        statusCached={indexCached}
        statusError={!!error}
        statusProgress={
          indexLoading ? indexProgress : isGraphLoading ? 88 : hasLoadedGraph ? 100 : 0
        }
        statusLabel={statusLabel}
        statusBadgeLabel={badgeLabel}
      />
      <div className="explorar-semantic-tab-body">
        {!isActive ? null : !codeIndex && !error ? (
          <div className="vscode-loading">
            <div className="vscode-spinner" />
            <div>Loading semantic index...</div>
          </div>
        ) : (
          <SemanticGraphPanel
            filePath={repoLabel || 'Repository'}
            symbolName={repoLabel || null}
            relationships={relationships}
            isLoading={isLoading}
            error={error}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    </div>
  );
}
