import type { FileNode } from '@/types';

/** Sort each level in place, with directories first and names in alphabetical order. */
export function sortFileNodes(nodes: FileNode[]): FileNode[] {
  return nodes
    .sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    })
    .map((node) => (node.children ? { ...node, children: sortFileNodes(node.children) } : node));
}
