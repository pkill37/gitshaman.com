'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dagre from '@dagrejs/dagre';
import {
  parseRepoNavigationTarget,
  type RepoNavigationTarget,
} from '../../lib/markdown-navigation';
import { ecosystem, sharedLesson } from './data';
import { neighborhood, type Category, type SourceReference } from './model';
import './ecosystem.css';

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const categoryColors: Record<Category, string> = {
  kernel: '#e8ae79',
  userland: '#9ebf91',
  runtime: '#63d8c9',
  compiler: '#a78bfa',
  platform: '#efc66f',
};

export type OpenEcosystemFile = (
  path: string,
  symbol?: string,
  line?: number,
  scope?: string[],
  repository?: { owner: string; repo: string }
) => void;
export function targetHref(target: RepoNavigationTarget): string {
  const node = ecosystem.nodes.find(
    (node) => node.id === `${target.owner}/${target.repo}`.toLowerCase()
  );
  const params = new URLSearchParams({ file: target.path });
  if (target.searchPattern) params.set('search', target.searchPattern);
  if (target.scrollToLine) params.set('line', String(target.scrollToLine));
  return `${node?.repository?.route ?? '/'}?${params}`;
}
function SourceLink({
  target,
  children,
  onOpen,
}: {
  target: RepoNavigationTarget;
  children: React.ReactNode;
  onOpen?: OpenEcosystemFile;
}) {
  return (
    <a
      href={targetHref(target)}
      onClick={
        onOpen
          ? (event) => {
              event.preventDefault();
              onOpen(
                target.path,
                target.searchPattern,
                target.scrollToLine,
                undefined,
                target.owner && target.repo ? { owner: target.owner, repo: target.repo } : undefined
              );
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}
function SourceTrail({
  sources,
  onOpen,
}: {
  sources: SourceReference[];
  onOpen?: OpenEcosystemFile;
}) {
  return (
    <ul>
      {sources.map((source, index) => (
        <li key={index}>
          {source.target ? (
            <SourceLink target={source.target} onOpen={onOpen}>
              {source.target.path}
              {source.target.searchPattern ? ` · ${source.target.searchPattern}` : ''}
              {source.target.scrollToLine ? `:${source.target.scrollToLine}` : ''}
            </SourceLink>
          ) : source.url ? (
            <a href={source.url}>{source.document}</a>
          ) : (
            source.document
          )}
          <small>
            {' '}
            — {source.document}
            {source.chapter ? ` / ${source.chapter}` : ''}
            {source.line ? `:${source.line}` : ''} ({source.kind})
          </small>
          {source.target && source.url && (
            <>
              {' '}
              · <a href={source.url}>Pinned upstream</a>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
function Lesson({ onOpen }: { onOpen?: OpenEcosystemFile }) {
  return (
    <details className="ecosystem-lesson">
      <summary>How software fits together</summary>
      {sharedLesson
        .split('\n\n')
        .filter((paragraph) => !paragraph.startsWith('##'))
        .map((paragraph, index) => (
          <p key={index}>
            {paragraph.split(/(\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
              const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
              const target = match && parseRepoNavigationTarget(match[2]);
              return match && target ? (
                <SourceLink key={i} target={target} onOpen={onOpen}>
                  {match[1]}
                </SourceLink>
              ) : (
                part
              );
            })}
          </p>
        ))}
    </details>
  );
}
export default function EcosystemMap({
  repositoryId,
  onOpen,
}: {
  repositoryId?: string;
  onOpen?: OpenEcosystemFile;
}) {
  const interactive = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState(repositoryId ?? 'python/cpython');
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const marker = useId().replace(/:/g, '');
  const graph = useMemo(
    () => (repositoryId && !full ? neighborhood(ecosystem, repositoryId.toLowerCase()) : ecosystem),
    [repositoryId, full]
  );
  const layout = useMemo(() => {
    const graphLayout = new dagre.graphlib.Graph({ multigraph: true });
    graphLayout.setGraph({ rankdir: 'LR', ranksep: 170, nodesep: 30, marginx: 20, marginy: 20 });
    graphLayout.setDefaultEdgeLabel(() => ({}));
    graph.nodes.forEach((node) => graphLayout.setNode(node.id, { width: 170, height: 54 }));
    graph.relationships.forEach((edge, index) =>
      graphLayout.setEdge(edge.from, edge.to, { width: 150, height: 48 }, String(index))
    );
    dagre.layout(graphLayout);
    return graphLayout;
  }, [graph]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const position = layout.node(selected);
    if (!canvas || !position) return;
    const scale =
      (Math.max(760, layout.graph().width ?? 760) * zoom) / (layout.graph().width ?? 760);
    canvas.scrollTo({
      left: Math.max(0, position.x * scale - canvas.clientWidth / 2),
      top: Math.max(0, position.y * scale - canvas.clientHeight / 2),
    });
  }, [layout, selected, zoom]);
  const node = graph.nodes.find((node) => node.id === selected);
  const edges = graph.relationships.filter(
    (edge) => edge.from === selected || edge.to === selected
  );
  return (
    <section
      className="ecosystem"
      aria-label="Software ecosystem map"
      aria-busy={!interactive}
      id={repositoryId ? undefined : 'ecosystem'}
    >
      <header className="ecosystem-heading">
        <span className="shaman-kicker">Beyond the repository</span>
        <h2>Software ecosystem</h2>
        <p>
          From language runtimes to the kernel. Explore the connections, then follow them into
          source.
        </p>
      </header>
      <div className="ecosystem-panel">
        <div className="ecosystem-toolbar">
          <div className="ecosystem-map-caption">
            <span aria-hidden="true">◈</span> The connected source map
          </div>
          <div className="ecosystem-controls">
            {repositoryId && (
              <button
                onClick={() => {
                  setFull(!full);
                  setZoom(1);
                }}
              >
                {full ? 'Repository neighborhood' : 'Show full map'}
              </button>
            )}
            <button aria-label="Zoom in" onClick={() => setZoom(Math.min(3, zoom + 0.25))}>
              +
            </button>
            <button aria-label="Zoom out" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>
              −
            </button>
            <button
              onClick={() => {
                setZoom(1);
                canvasRef.current?.scrollTo({ left: 0, top: 0 });
              }}
            >
              Reset zoom
            </button>
          </div>
        </div>
        <div className="ecosystem-legend">
          {Object.entries(categoryColors).map(([category, color]) => (
            <span key={category}>
              <i style={{ background: color }} aria-hidden="true" />
              {category}
            </span>
          ))}
          <span className="ecosystem-reference-key">
            <i aria-hidden="true" /> Guide reference
          </span>
        </div>
        <div className="ecosystem-workspace">
          <div className="ecosystem-map-area">
            <div
              ref={canvasRef}
              className="ecosystem-canvas"
              tabIndex={0}
              role="region"
              aria-label="Scrollable ecosystem diagram"
            >
              <svg
                width={Math.max(760, layout.graph().width ?? 760) * zoom}
                viewBox={`0 0 ${layout.graph().width} ${layout.graph().height}`}
                role="img"
                aria-label="Directed software relationships; select nodes using the list below"
              >
                <defs>
                  <marker
                    id={marker}
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L0,6 L8,3 z" fill="currentColor" />
                  </marker>
                </defs>
                {graph.relationships.map((edge, index) => {
                  const placed = layout.edge({ v: edge.from, w: edge.to, name: String(index) });
                  return (
                    <g
                      key={index}
                      className={`ecosystem-edge ${edge.kind === 'reference' ? 'ecosystem-reference' : ''} ${edge.from === selected || edge.to === selected ? 'is-connected' : ''}`}
                    >
                      <polyline
                        points={placed.points
                          .map((point: { x: number; y: number }) => `${point.x},${point.y}`)
                          .join(' ')}
                        fill="none"
                        stroke="currentColor"
                        markerEnd={`url(#${marker})`}
                      />
                      <text x={placed.x} y={placed.y} textAnchor="middle" fontSize="10">
                        {(edge.label.match(/.{1,25}(?:\s|$)|\S+/g) ?? [edge.label]).map(
                          (line, index) => (
                            <tspan key={index} x={placed.x} dy={index === 0 ? -12 : 12}>
                              {line.trim()}
                            </tspan>
                          )
                        )}
                      </text>
                    </g>
                  );
                })}
                {graph.nodes.map((node) => {
                  const placed = layout.node(node.id);
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${placed.x - 85},${placed.y - 27})`}
                      onClick={() => setSelected(node.id)}
                      className={`ecosystem-graph-node ${selected === node.id ? 'is-selected' : ''}`}
                    >
                      <rect
                        width="170"
                        height="54"
                        rx="8"
                        className="ecosystem-node-surface"
                        stroke={node.color}
                        strokeWidth={selected === node.id ? 2 : 1}
                      />
                      <circle cx="12" cy="12" r="4" fill={categoryColors[node.category]} />
                      <text
                        className="ecosystem-node-name"
                        x="85"
                        y="23"
                        textAnchor="middle"
                        fontSize="13"
                      >
                        {node.name}
                      </text>
                      <text
                        className="ecosystem-node-category"
                        x="85"
                        y="42"
                        textAnchor="middle"
                        fontSize="10"
                      >
                        {node.category}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="ecosystem-projects-label">
              Explore a project <span aria-hidden="true">↗</span>
            </div>
            <div
              className="ecosystem-nodes"
              role="region"
              tabIndex={0}
              aria-label="Select ecosystem node"
            >
              {graph.nodes.map((node) => (
                <button
                  key={node.id}
                  disabled={!interactive}
                  aria-pressed={selected === node.id}
                  onClick={() => setSelected(node.id)}
                >
                  <i aria-hidden="true" style={{ background: node.color }} />
                  {node.name} · {node.category}
                </button>
              ))}
            </div>
          </div>
          <aside className="ecosystem-inspector" aria-label="Selected project details">
            {node && (
              <article aria-live="polite">
                <div className="ecosystem-detail-kicker">
                  Selected project <span> / {node.category}</span>
                </div>
                <h3>{node.name}</h3>
                <p>{node.explanation}</p>
                {node.repository && (
                  <a className="ecosystem-explore-link" href={node.repository.route}>
                    Open {node.name} guide and explorer <span aria-hidden="true">↗</span>
                  </a>
                )}
              </article>
            )}
            <details>
              <summary>Relationships and source trails{node ? ` for ${node.name}` : ''}</summary>
              <ul className="ecosystem-relationships">
                {edges.map((edge, index) => (
                  <li key={index}>
                    <button
                      onClick={() => setSelected(edge.from === selected ? edge.to : edge.from)}
                    >
                      {ecosystem.nodes.find((node) => node.id === edge.from)?.name} →{' '}
                      {ecosystem.nodes.find((node) => node.id === edge.to)?.name}
                    </button>{' '}
                    <strong>{edge.label}</strong> <small>({edge.kind})</small>
                    <SourceTrail sources={edge.sources} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            </details>
          </aside>
        </div>
        <footer className="ecosystem-footer">
          <p>
            Arrows describe execution, compiler backends, source lineage, or comparisons. Dashed
            lines are guide references, not dependencies.
          </p>
          <Lesson onOpen={onOpen} />
        </footer>
      </div>
    </section>
  );
}
