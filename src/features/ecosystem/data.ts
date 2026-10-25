import { CURATED_REPOS, getCuratedRepoAccent, getCuratedRepoPath } from '../../lib/curated-repos';
import index from './generated-index.json';
import {
  mergeRelationships,
  type Category,
  type Ecosystem,
  type EcosystemNode,
  type Relationship,
  type SourceReference,
} from './model';
const categories: Record<string, Category> = {
  miniageos: 'platform',
  cpython: 'runtime',
  'go-language': 'runtime',
  'gnu-c-library': 'userland',
  'llvm-project': 'compiler',
  'typescript-compiler': 'compiler',
  'lineageos-android': 'platform',
  'grapheneos-platform-manifest': 'platform',
};
const nodes: EcosystemNode[] = CURATED_REPOS.map((repo) => ({
  id: `${repo.owner}/${repo.repo}`.toLowerCase(),
  name: repo.displayName,
  category: categories[repo.slug] ?? 'kernel',
  explanation: repo.description,
  color: getCuratedRepoAccent(repo.owner, repo.repo),
  repository: {
    owner: repo.owner,
    repo: repo.repo,
    route: getCuratedRepoPath(repo.owner, repo.repo),
  },
}));
nodes.push(
  {
    id: 'rust',
    name: 'Rust',
    category: 'compiler',
    color: '#d79b72',
    explanation:
      'Context: rustc normally uses LLVM for code generation; alternative backends exist. This is a compiler relationship, not a runtime dependency.',
  },
  {
    id: 'swift',
    name: 'Swift',
    category: 'compiler',
    color: '#f28b67',
    explanation:
      'Context: the Swift compiler lowers Swift intermediate language to LLVM IR for optimization and machine code generation.',
  }
);
function source(id: string, path: string, searchPattern?: string): SourceReference {
  const node = nodes.find((node) => node.id === id)!;
  const repo = CURATED_REPOS.find((repo) => `${repo.owner}/${repo.repo}`.toLowerCase() === id)!;
  return {
    kind: 'technical',
    document: `${repo.owner}/${repo.repo}@${repo.revision}`,
    target: { owner: node.repository!.owner, repo: node.repository!.repo, path, searchPattern },
    url: `https://github.com/${repo.owner}/${repo.repo}/blob/${repo.revision}/${path}`,
  };
}
const authored: Relationship[] = [
  {
    from: 'python/cpython',
    to: 'bminor/glibc',
    kind: 'execution',
    label: 'C library services on glibc Linux builds',
    sources: [
      source('python/cpython', 'Python/fileutils.c', '_Py_read'),
      source('bminor/glibc', 'sysdeps/unix/sysv/linux/read.c', '__libc_read'),
    ],
  },
  {
    from: 'bminor/glibc',
    to: 'torvalds/linux',
    kind: 'execution',
    label: 'Linux port: syscall boundary',
    sources: [
      source('bminor/glibc', 'sysdeps/unix/sysv/linux/read.c', '__libc_read'),
      source('torvalds/linux', 'fs/read_write.c', 'ksys_read'),
    ],
  },
  {
    from: 'golang/go',
    to: 'torvalds/linux',
    kind: 'execution',
    label: 'Linux runtime: direct syscalls (amd64 example)',
    sources: [source('golang/go', 'src/runtime/sys_linux_amd64.s')],
  },
  {
    from: 'golang/go',
    to: 'bminor/glibc',
    kind: 'execution',
    label: 'Optional cgo on glibc Linux: C / pthread integration',
    sources: [source('golang/go', 'src/runtime/cgo/pthread_unix.c')],
  },
  {
    from: 'rust',
    to: 'llvm/llvm-project',
    kind: 'compiler',
    label: 'Usual rustc code generation backend',
    sources: [
      {
        kind: 'technical',
        document: 'Rust Compiler Development Guide',
        url: 'https://rustc-dev-guide.rust-lang.org/backend/codegen.html',
      },
    ],
  },
  {
    from: 'swift',
    to: 'llvm/llvm-project',
    kind: 'compiler',
    label: 'LLVM IR and machine code generation',
    sources: [
      {
        kind: 'technical',
        document: 'Swift compiler architecture',
        url: 'https://www.swift.org/documentation/swift-compiler/',
      },
    ],
  },
  {
    from: 'ghostbsd/ghostbsd-src',
    to: 'freebsd/freebsd-src',
    kind: 'ancestry',
    label: 'FreeBSD source lineage',
    sources: [source('ghostbsd/ghostbsd-src', 'README.md')],
  },
  {
    from: 'apple-oss-distributions/xnu',
    to: 'freebsd/freebsd-src',
    kind: 'ancestry',
    label: 'Contains FreeBSD components (alongside Mach)',
    sources: [source('apple-oss-distributions/xnu', 'README.md')],
  },
  {
    from: 'nextbsd-redux/nextbsd-kernel',
    to: 'freebsd/freebsd-src',
    kind: 'ancestry',
    label: 'FreeBSD kernel configuration and patch lineage',
    sources: [
      source('nextbsd-redux/nextbsd-kernel', 'config/NEXTBSD'),
      source('nextbsd-redux/nextbsd-kernel', '.github/workflows/build.yml'),
    ],
  },
  {
    from: 'lineageos/android',
    to: 'grapheneos/platform_manifest',
    kind: 'comparison',
    label: 'Android distribution composition comparison',
    sources: [
      source('lineageos/android', 'default.xml'),
      source('grapheneos/platform_manifest', 'default.xml'),
    ],
  },
];
export const ecosystem: Ecosystem = {
  nodes,
  relationships: mergeRelationships([...authored, ...(index.references as Relationship[])]),
};
export const sharedLesson = index.lesson;
