import type { FileNode } from '@/types';

export const ANDROID_CORE_PROJECTS = [
  'frameworks/base',
  'frameworks/native',
  'frameworks/av',
  'art',
  'bionic',
  'libcore',
  'system/core',
  'system/sepolicy',
  'build/make',
  'build/soong',
  'packages/apps/Settings',
];

export type AndroidMapping = { kind: 'copyfile' | 'linkfile'; src: string; dest: string };
export type AndroidProject = {
  path: string;
  name: string;
  url: string;
  revision: string;
  mappings: AndroidMapping[];
};
export type AndroidLockedProject = AndroidProject & { commit: string };
export type AndroidWorkspaceLock = {
  version: 1;
  owner: string;
  repo: string;
  manifestCommit: string;
  projects: AndroidLockedProject[];
};
export type AndroidWorkspace = Omit<AndroidWorkspaceLock, 'projects'> & {
  snapshot: string;
  projects: (AndroidLockedProject & {
    id: string;
    tree: FileNode[];
    fileCount: number;
    truncatedFileCount: number;
  })[];
  aliases: { path: string; target: string }[];
  manifestTree: FileNode[];
};

export function safeAndroidPath(value: string): string {
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    /[\x00-\x1f?#:]/.test(value)
  ) {
    throw new Error(`Unsafe Android path: ${value}`);
  }
  return value;
}

export function androidProjectForPath(workspace: AndroidWorkspace, path: string) {
  return workspace.projects
    .filter((project) => path === project.path || path.startsWith(`${project.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

export function resolveAndroidAlias(workspace: AndroidWorkspace, path: string): string {
  const alias = workspace.aliases
    .filter((entry) => path === entry.path || path.startsWith(`${entry.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return alias ? alias.target + path.slice(alias.path.length) : path;
}

export function mergeAndroidTrees(trees: FileNode[][]): FileNode[] {
  const result: FileNode[] = [];
  for (const tree of trees) {
    for (const node of tree) {
      const existing = result.find((entry) => entry.name === node.name);
      if (existing) {
        if (existing.type !== 'directory' || node.type !== 'directory')
          throw new Error(`Conflicting Android tree path: ${node.path}`);
        existing.children = mergeAndroidTrees([existing.children ?? [], node.children ?? []]);
      } else
        result.push({
          ...node,
          children: node.children ? mergeAndroidTrees([node.children]) : undefined,
        });
    }
  }
  return result.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1
  );
}

export function androidSourceTree(workspace: AndroidWorkspace): FileNode[] {
  const tree = mergeAndroidTrees(workspace.projects.map((project) => project.tree));
  for (const alias of workspace.aliases) {
    let entries = tree;
    const parts = alias.target.split('/');
    let target: FileNode | undefined;
    for (const part of parts) {
      target = entries.find((node) => node.name === part);
      entries = target?.children ?? [];
    }
    if (!target) continue;
    const relocate = (node: FileNode, path: string): FileNode => ({
      ...node,
      name: path.split('/').at(-1)!,
      path,
      children: node.children?.map((child) => relocate(child, `${path}/${child.name}`)),
    });
    let branch = relocate(target, alias.path);
    const parents = alias.path.split('/').slice(0, -1);
    while (parents.length) {
      const path = parents.join('/');
      branch = { name: parents.pop()!, path, type: 'directory', children: [branch] };
    }
    const merged = mergeAndroidTrees([tree, [branch]]);
    tree.splice(0, tree.length, ...merged);
  }
  return tree;
}

export function androidUpstreamUrl(
  project: AndroidLockedProject,
  file: string,
  line?: number
): string {
  const relative = file
    .slice(project.path.length + 1)
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const base = project.url.replace(/\.git$/, '');
  if (new URL(base).hostname === 'android.googlesource.com')
    return `${base}/+/${project.commit}/${relative}${line ? `#${line}` : ''}`;
  return `${base}/blob/${project.commit}/${relative}${line ? `#L${line}` : ''}`;
}
