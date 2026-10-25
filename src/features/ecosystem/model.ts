import type { RepoNavigationTarget } from '../../lib/markdown-navigation';
export type Category = 'kernel' | 'userland' | 'runtime' | 'compiler' | 'platform';
export interface SourceReference {
  document: string;
  chapter?: string;
  line?: number;
  kind: 'prose' | 'recommendation' | 'technical';
  target?: RepoNavigationTarget;
  url?: string;
}
export interface EcosystemNode {
  id: string;
  name: string;
  category: Category;
  explanation: string;
  color: string;
  repository?: { owner: string; repo: string; route: string };
}
export interface Relationship {
  from: string;
  to: string;
  kind: 'execution' | 'compiler' | 'ancestry' | 'comparison' | 'reference';
  label: string;
  sources: SourceReference[];
}
export interface Ecosystem {
  nodes: EcosystemNode[];
  relationships: Relationship[];
}
export function mergeRelationships(relationships: Relationship[]): Relationship[] {
  const merged = new Map<string, Relationship>();
  for (const relationship of relationships) {
    const key = JSON.stringify([
      relationship.from,
      relationship.to,
      relationship.kind,
      relationship.label,
    ]);
    const previous = merged.get(key);
    const sources = [...(previous?.sources ?? []), ...relationship.sources];
    merged.set(key, {
      ...relationship,
      sources: [...new Map(sources.map((source) => [JSON.stringify(source), source])).values()],
    });
  }
  return [...merged.values()];
}
export function neighborhood(ecosystem: Ecosystem, id: string): Ecosystem {
  const relationships = ecosystem.relationships.filter(
    (edge) => edge.from === id || edge.to === id
  );
  const ids = new Set([id, ...relationships.flatMap((edge) => [edge.from, edge.to])]);
  return { nodes: ecosystem.nodes.filter((node) => ids.has(node.id)), relationships };
}
