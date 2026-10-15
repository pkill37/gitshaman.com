import Dagre from '@dagrejs/dagre';
import type { GuideSection } from '@/lib/project-guides';

interface XYPosition {
  x: number;
  y: number;
}

interface Node<Data = unknown> {
  id: string;
  type?: string;
  position: XYPosition;
  data: Data;
}

interface Edge {
  id: string;
  source: string;
  target: string;
  type?: string;
  data?: unknown;
  animated?: boolean;
  style?: Record<string, unknown>;
  label?: string;
}

function layoutFileNodes(nodes: Node[], edges: Edge[]): void {
  const graph = new Dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', nodesep: 72, ranksep: 96, marginx: 36, marginy: 32 });
  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  Dagre.layout(graph);
  for (const node of nodes) {
    const position = graph.node(node.id);
    if (position) {
      node.position = { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 };
    }
  }
}

export interface FileNodeData extends Record<string, unknown> {
  filePath: string;
  fileName: string;
  language: string;
  sectionLabel: string;
  sectionIndex: number;
  color: string;
  isDirectory: boolean;
  isDocumentation: boolean;
  pedagogicalOrder: number;
  pedagogicalOrderLabel: string;
}

const NODE_WIDTH = 336;
const NODE_HEIGHT = 212;

interface GraphFileEntry {
  filePath: string;
  sectionLabel: string;
  sectionIndex: number;
  isDocumentation: boolean;
  pedagogicalOrder: number;
  pedagogicalOrderLabel: string;
}

function getPedagogicalOrderLabel(start: number, end?: number): string {
  return end && end !== start ? `${start}-${end}` : `${start}`;
}

function pushGraphFileEntry(
  files: GraphFileEntry[],
  filePath: string,
  sectionLabel: string,
  sectionIndex: number,
  pedagogicalOrder: number,
  isDocumentation = false
): void {
  files.push({
    filePath,
    sectionLabel,
    sectionIndex,
    isDocumentation,
    pedagogicalOrder,
    pedagogicalOrderLabel: getPedagogicalOrderLabel(pedagogicalOrder),
  });
}

const SECTION_COLORS = [
  '#1d4ed8', // blue
  '#059669', // emerald
  '#d97706', // amber
  '#7c3aed', // violet
  '#db2777', // pink
  '#0891b2', // cyan
  '#65a30d', // lime
  '#dc2626', // red
];

function getLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    py: 'python',
    rs: 'rust',
    js: 'javascript',
    ts: 'typescript',
    tsx: 'tsx',
    rst: 'rst',
    md: 'markdown',
    s: 'asm',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    sh: 'bash',
  };
  return map[ext] ?? 'text';
}

// ─── Core-file filtering ─────────────────────────────────────────────────────

/** Extensions that represent actual source / compiled artefacts worth studying */
const CORE_EXTENSIONS = new Set([
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hh',
  'hpp', // C / C++
  'py',
  'pyx',
  'pxd', // Python / Cython
  'rs', // Rust
  'go', // Go
  'java',
  'kt',
  'scala', // JVM
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs', // JS / TS
  'rb', // Ruby
  'swift',
  'm',
  'mm', // Apple
  'cs', // C#
  's',
  'asm',
  'S', // Assembly
  'lua',
  'pl',
  'php',
  'ex',
  'exs', // Scripting
  'zig',
  'nim',
  'odin', // Systems
  'json',
  'toml',
  'yaml',
  'yml', // Config / schema (sparingly)
  'mk',
  'cmake', // Build files
]);

/** Path segments that indicate documentation / example / test trees */
const NON_CORE_DIR_RE =
  /(?:^|\/)(?:doc|docs|documentation|man|manpages|manual|manuals|help|book|books|tutorial|tutorials|guide|guides|example|examples|sample|samples|demo|demos|test|tests|testing|spec|specs|bench|benchmarks|benchmark|t|xt|fixtures)\//i;

/** Filenames that are documentation regardless of location */
const DOC_FILENAME_RE =
  /^(?:readme|changelog|changes|contributing|contributors|authors|copying|license|licence|notice|todo|notes|credits|history|install|installation|faq|makefile\.doc|codeofconduct|code_of_conduct|security)(?:\..+)?$/i;

/** Extensions that are purely documentation / markup */
const DOC_EXTENSIONS = new Set([
  'md',
  'rst',
  'txt',
  'adoc',
  'asciidoc',
  'texi',
  'texinfo',
  'html',
  'htm',
  'xml',
  'pdf',
  'doc',
  'docx',
  'odt',
]);

const TEXTUAL_DOC_EXTENSIONS = new Set([
  'md',
  'rst',
  'txt',
  'adoc',
  'asciidoc',
  'texi',
  'texinfo',
  'html',
  'htm',
  'xml',
]);

function isCoreSourceFile(filePath: string): boolean {
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1];
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  // Reject non-files and http links
  if (!fileName.includes('.') || filePath.startsWith('http') || filePath.startsWith('#')) {
    return false;
  }

  // Reject images / fonts / binary artefacts
  if (
    /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|so|a|o|pyc|class|jar|bin|exe|dll)$/i.test(
      fileName
    )
  ) {
    return false;
  }

  // Reject pure doc extensions
  if (DOC_EXTENSIONS.has(ext)) return false;

  // Reject known doc filenames
  if (DOC_FILENAME_RE.test(fileName)) return false;

  // Reject doc / test / example directory trees
  const pathWithSlash = '/' + filePath;
  if (NON_CORE_DIR_RE.test(pathWithSlash)) return false;

  // Must be a recognised source extension (or a build config)
  return CORE_EXTENSIONS.has(ext);
}

function isFilePath(path: string): boolean {
  const last = path.split('/').pop() ?? '';
  return (
    last.includes('.') &&
    !path.startsWith('http') &&
    !path.startsWith('#') &&
    last.length > 2 &&
    !/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i.test(last)
  );
}

function isGuideRecommendedFile(filePath: string, includeDocs: boolean): boolean {
  if (filePath.endsWith('/')) {
    return !filePath.startsWith('http') && !filePath.startsWith('#');
  }

  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1];
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (!fileName || filePath.startsWith('http') || filePath.startsWith('#')) {
    return false;
  }

  if (
    /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|so|a|o|pyc|class|jar|bin|exe|dll)$/i.test(
      fileName
    )
  ) {
    return false;
  }

  if (isCoreSourceFile(filePath)) return true;
  if (!includeDocs) return false;

  return DOC_FILENAME_RE.test(fileName) || TEXTUAL_DOC_EXTENSIONS.has(ext);
}

function getDisplayName(filePath: string): string {
  const trimmed = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath;
  return trimmed.split('/').pop() ?? trimmed;
}

function isDocumentationPath(filePath: string): boolean {
  if (filePath.endsWith('/')) {
    return NON_CORE_DIR_RE.test('/' + filePath);
  }
  return !isCoreSourceFile(filePath);
}

function getSectionNarrativePaths(section: GuideSection, includeDocs: boolean): string[] {
  return (section.narrativePaths ?? []).filter((path) => isGuideRecommendedFile(path, includeDocs));
}

function buildGraphDataFromFileEntries(files: GraphFileEntry[]): {
  nodes: Node<FileNodeData>[];
  edges: Edge[];
} {
  console.log(`[graph-data] parsed ${files.length} file refs from guide`);

  // Group by section
  const bySection = new Map<string, typeof files>();
  for (const f of files) {
    if (!bySection.has(f.sectionLabel)) bySection.set(f.sectionLabel, []);
    bySection.get(f.sectionLabel)!.push(f);
  }

  // Assign colors per top-level directory (files in the same folder share a color)
  const folderColorMap = new Map<string, string>();
  let ci = 0;
  for (const f of files) {
    const folder = f.filePath.includes('/') ? f.filePath.split('/')[0] : '';
    if (!folderColorMap.has(folder)) {
      folderColorMap.set(folder, SECTION_COLORS[ci % SECTION_COLORS.length]);
      ci++;
    }
  }

  const nodes: Node<FileNodeData>[] = [];
  const edges: Edge[] = [];

  for (const f of files) {
    const folder = f.filePath.includes('/') ? f.filePath.split('/')[0] : '';
    const color = folderColorMap.get(folder) ?? '#1d4ed8';
    nodes.push({
      id: f.filePath,
      type: 'fileNode',
      position: { x: 0, y: 0 }, // dagre will set this
      data: {
        filePath: f.filePath,
        fileName: getDisplayName(f.filePath),
        language: getLang(f.filePath),
        sectionLabel: f.sectionLabel,
        sectionIndex: f.sectionIndex,
        color,
        isDirectory: f.filePath.endsWith('/'),
        isDocumentation: isDocumentationPath(f.filePath),
        pedagogicalOrder: f.pedagogicalOrder,
        pedagogicalOrderLabel: f.pedagogicalOrderLabel,
      },
    });
  }

  // Edges within sections (connect consecutive files)
  for (const [, sf] of bySection) {
    const folder = sf[0].filePath.includes('/') ? sf[0].filePath.split('/')[0] : '';
    const color = folderColorMap.get(folder) ?? '#1d4ed8';
    for (let i = 0; i < sf.length - 1; i++) {
      edges.push({
        id: `e-${sf[i].filePath}→${sf[i + 1].filePath}`,
        source: sf[i].filePath,
        target: sf[i + 1].filePath,
        type: 'smoothstep',
        style: { stroke: color, strokeOpacity: 0.35, strokeWidth: 1.5 },
      });
    }
  }

  const orderedSections = [...bySection.entries()].sort(
    (a, b) => a[1][0].sectionIndex - b[1][0].sectionIndex
  );
  for (let i = 0; i < orderedSections.length - 1; i++) {
    const currentFiles = orderedSections[i][1];
    const nextFiles = orderedSections[i + 1][1];
    const currentLast = currentFiles[currentFiles.length - 1];
    const nextFirst = nextFiles[0];
    if (!currentLast || !nextFirst) continue;
    edges.push({
      id: `bridge-${currentLast.filePath}→${nextFirst.filePath}`,
      source: currentLast.filePath,
      target: nextFirst.filePath,
      type: 'smoothstep',
      style: {
        stroke: '#6b7280',
        strokeOpacity: 0.28,
        strokeWidth: 1.2,
        strokeDasharray: '4 4',
      },
    });
  }

  // Dagre layout
  console.time('[graph-data] dagre layout');
  layoutFileNodes(nodes, edges);
  console.timeEnd('[graph-data] dagre layout');
  return { nodes, edges };
}

export function buildGraphDataFromSections(
  guideSections: GuideSection[],
  options?: { includeDocs?: boolean }
): {
  nodes: Node<FileNodeData>[];
  edges: Edge[];
} {
  console.time('[graph-data] buildGraphDataFromSections total');
  const files: GraphFileEntry[] = [];
  const seen = new Set<string>();
  const includeDocs = options?.includeDocs ?? false;
  let pedagogicalOrder = 1;

  guideSections.forEach((section, index) => {
    const sectionLabel = section.title.replace(/^Chapter\s+\d+\s*[—\-–]\s*/, '').trim();
    const narrativePaths = getSectionNarrativePaths(section, includeDocs);
    for (const path of narrativePaths) {
      const currentOrder = pedagogicalOrder++;
      if (seen.has(path)) continue;
      seen.add(path);
      files.push({
        filePath: path,
        sectionLabel,
        sectionIndex: index + 1,
        isDocumentation: !isCoreSourceFile(path),
        pedagogicalOrder: currentOrder,
        pedagogicalOrderLabel: getPedagogicalOrderLabel(currentOrder),
      });
    }
  });

  const result = buildGraphDataFromFileEntries(files);
  console.timeEnd('[graph-data] buildGraphDataFromSections total');
  return result;
}

export function buildGraphData(guideContent: string): {
  nodes: Node<FileNodeData>[];
  edges: Edge[];
} {
  console.time('[graph-data] buildGraphData total');
  const files: GraphFileEntry[] = [];
  const seen = new Set<string>();

  const lines = guideContent.split('\n');
  let sectionLabel = 'Overview';
  let sectionIndex = 0;
  let pedagogicalOrder = 1;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      sectionLabel = h2[1].replace(/^Chapter\s+\d+\s*[—\-–]\s*/, '').trim();
      sectionIndex++;
      continue;
    }

    // Markdown links: [text](path)
    const linkRe = /\[([^\]]+)\]\(([^)#\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(line)) !== null) {
      const p = m[2];
      if (isFilePath(p) && isCoreSourceFile(p) && !seen.has(p)) {
        seen.add(p);
        pushGraphFileEntry(files, p, sectionLabel, sectionIndex, pedagogicalOrder);
        pedagogicalOrder++;
      }
    }

    // Backtick paths with directory separator: `kernel/fork.c`
    const btRe = /`([a-zA-Z0-9_./-]+\/[a-zA-Z0-9_./-]+\.[a-zA-Z]{1,4})`/g;
    while ((m = btRe.exec(line)) !== null) {
      const p = m[1];
      if (isFilePath(p) && isCoreSourceFile(p) && !seen.has(p)) {
        seen.add(p);
        pushGraphFileEntry(files, p, sectionLabel, sectionIndex, pedagogicalOrder);
        pedagogicalOrder++;
      }
    }
  }

  const result = buildGraphDataFromFileEntries(files.slice(0, 60));
  console.log(
    `[graph-data] buildGraphData → ${result.nodes.length} nodes, ${result.edges.length} edges`
  );
  console.timeEnd('[graph-data] buildGraphData total');
  return result;
}
