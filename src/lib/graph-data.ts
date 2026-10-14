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

function projectCwdEdges(
  cwd: string,
  nodes: Node<FileNodeData>[],
  edges: Edge[],
  surfacedDocumentationPaths: Set<string>,
  pairRemap: Map<string, string> = new Map()
): Edge[] {
  function getRepresentative(filePath: string): string | null {
    if (surfacedDocumentationPaths.has(filePath)) return filePath;
    if (cwd !== '' && !filePath.startsWith(cwd + '/')) return null;
    const relPath = cwd === '' ? filePath : filePath.slice(cwd.length + 1);
    const firstSlash = relPath.indexOf('/');
    if (firstSlash === -1) return filePath;
    const subdir = relPath.slice(0, firstSlash);
    return `folder:${cwd === '' ? subdir : `${cwd}/${subdir}`}`;
  }

  const edgeAgg = new Map<
    string,
    { source: string; target: string; color: string; count: number }
  >();
  for (const edge of edges) {
    let source = getRepresentative(edge.source);
    let target = getRepresentative(edge.target);
    if (!source || !target) continue;
    source = pairRemap.get(source) ?? source;
    target = pairRemap.get(target) ?? target;
    if (source === target) continue;
    const key = `${source}|||${target}`;
    if (!edgeAgg.has(key)) {
      const color = nodes.find((node) => node.id === edge.source)?.data.color ?? '#555';
      edgeAgg.set(key, { source, target, color, count: 0 });
    }
    edgeAgg.get(key)!.count++;
  }
  return [...edgeAgg.values()].map(({ source, target, color, count }) => ({
    id: `cwd|||${source}|||${target}`,
    source,
    target,
    type: 'smoothstep',
    style: {
      stroke: color,
      strokeOpacity: 0.6,
      strokeWidth: Math.min(1 + count * 0.3, 3.5),
    },
  }));
}

export interface FolderNodeData extends Record<string, unknown> {
  folderName: string;
  folderPath: string; // full path from root (e.g. 'kernel/sched')
  fileCount: number;
  color: string; // dominant section color
  filePaths: string[]; // file node IDs in this folder
}

export const FOLDER_NODE_WIDTH = 220;
export const FOLDER_NODE_HEIGHT = 136;

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

export const NODE_WIDTH = 336;
export const NODE_HEIGHT = 212;

export interface PairedNodeData extends Record<string, unknown> {
  primaryPath: string; // .c file
  headerPath: string; // .h file
  primaryName: string;
  headerName: string;
  language: string;
  sectionLabel: string;
  sectionIndex: number;
  color: string;
  pedagogicalOrder: number;
  pedagogicalOrderEnd: number;
  pedagogicalOrderLabel: string;
}

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

/**
 * Merge paired .c/.h nodes (same base stem) into a single PairedNode.
 * Edges that referenced either individual node are remapped to the paired id.
 * Intra-pair edges are dropped.
 */
function mergeCHPairs(
  nodes: Node<FileNodeData>[],
  edges: Edge[]
): { nodes: Node<FileNodeData | PairedNodeData>[]; edges: Edge[] } {
  const cNodes = nodes.filter((n) => /\.c$/i.test(n.data.filePath));
  const hNodes = nodes.filter((n) => /\.h$/i.test(n.data.filePath));

  const pairedIds = new Set<string>();
  const idRemap = new Map<string, string>(); // old id → paired node id
  const pairedNodes: Node<PairedNodeData>[] = [];

  for (const cNode of cNodes) {
    if (pairedIds.has(cNode.id)) continue;
    const cStem = cNode.data.fileName.replace(/\.c$/i, '').toLowerCase();

    const hNode = hNodes.find((h) => {
      if (pairedIds.has(h.id)) return false;
      return h.data.fileName.replace(/\.h$/i, '').toLowerCase() === cStem;
    });
    if (!hNode) continue;

    pairedIds.add(cNode.id);
    pairedIds.add(hNode.id);

    const pairedId = `${cNode.id}|||${hNode.id}`;
    idRemap.set(cNode.id, pairedId);
    idRemap.set(hNode.id, pairedId);

    pairedNodes.push({
      id: pairedId,
      type: 'pairedNode',
      position: { x: 0, y: 0 },
      data: {
        primaryPath: cNode.data.filePath,
        headerPath: hNode.data.filePath,
        primaryName: cNode.data.fileName,
        headerName: hNode.data.fileName,
        language: 'c',
        sectionLabel: cNode.data.sectionLabel,
        sectionIndex: cNode.data.sectionIndex,
        color: cNode.data.color,
        pedagogicalOrder: Math.min(cNode.data.pedagogicalOrder, hNode.data.pedagogicalOrder),
        pedagogicalOrderEnd: Math.max(cNode.data.pedagogicalOrder, hNode.data.pedagogicalOrder),
        pedagogicalOrderLabel: getPedagogicalOrderLabel(
          Math.min(cNode.data.pedagogicalOrder, hNode.data.pedagogicalOrder),
          Math.max(cNode.data.pedagogicalOrder, hNode.data.pedagogicalOrder)
        ),
      },
    });
  }

  if (pairedNodes.length === 0) return { nodes, edges };

  const unpairedNodes = nodes.filter((n) => !pairedIds.has(n.id));
  const outputNodes: Node<FileNodeData | PairedNodeData>[] = [...unpairedNodes, ...pairedNodes];

  const seenKeys = new Set<string>();
  const outputEdges: Edge[] = [];
  for (const edge of edges) {
    const src = idRemap.get(edge.source) ?? edge.source;
    const tgt = idRemap.get(edge.target) ?? edge.target;
    if (src === tgt) continue;
    const key = `${src}|||${tgt}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    outputEdges.push({ ...edge, id: `${edge.id}-m`, source: src, target: tgt });
  }

  return { nodes: outputNodes, edges: outputEdges };
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

function clusterDocumentationNodes(
  nodes: Array<Node<FileNodeData | FolderNodeData | PairedNodeData>>
): void {
  const documentationNodes = nodes.filter(
    (node): node is Node<FileNodeData> =>
      node.type === 'fileNode' && node.data.isDocumentation === true
  );
  if (documentationNodes.length === 0) return;

  const columns = Math.max(1, Math.ceil(Math.sqrt(documentationNodes.length)));
  const clusterOriginX = 28;
  const clusterOriginY = 20;
  const horizontalGap = 26;
  const verticalGap = 24;

  documentationNodes
    .sort((a, b) => a.data.pedagogicalOrder - b.data.pedagogicalOrder)
    .forEach((node, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      node.position = {
        x: clusterOriginX + col * (NODE_WIDTH + horizontalGap),
        y: clusterOriginY + row * (NODE_HEIGHT + verticalGap),
      };
    });

  const clusterWidth = columns * NODE_WIDTH + (columns - 1) * horizontalGap;
  const clusterOffsetX = clusterWidth + 120;
  for (const node of nodes) {
    if (node.type === 'fileNode' && node.data.isDocumentation) continue;
    node.position = {
      x: node.position.x + clusterOffsetX,
      y: node.position.y + 8,
    };
  }
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

// ─── CWD-based depth=1 view ───────────────────────────────────────────────────

/**
 * Builds a depth=1 graph view for the given `cwd` (current working directory).
 *
 * - Files directly inside `cwd` appear as FileNodes.
 * - Subdirectories of `cwd` are collapsed into FolderNodes.
 * - Guide/analysis edges are projected onto the depth=1 representatives so that
 *   pedagogically relevant connections remain visible at every navigation level.
 *
 * Pass `cwd = ''` for the root view.
 */
export function buildCwdView(
  allFileNodes: Node<FileNodeData>[],
  allFileEdges: Edge[],
  cwd: string
): { nodes: Node<FileNodeData | FolderNodeData | PairedNodeData>[]; edges: Edge[] } {
  const label = `[graph-data] buildCwdView(cwd="${cwd || 'root'}")`;
  console.time(label);
  // Determine which files are under this cwd
  const filesUnderCwd = allFileNodes.filter((node) => {
    if (cwd === '') return true;
    return node.data.filePath.startsWith(cwd + '/');
  });

  const folderMap = new Map<string, Node<FileNodeData>[]>(); // subdir name → files
  const directFiles: Node<FileNodeData>[] = [];
  const surfacedDocumentationPaths = new Set<string>();

  for (const node of filesUnderCwd) {
    if (node.data.isDocumentation) {
      directFiles.push(node);
      surfacedDocumentationPaths.add(node.id);
      continue;
    }
    const relPath = cwd === '' ? node.data.filePath : node.data.filePath.slice(cwd.length + 1);
    const firstSlash = relPath.indexOf('/');
    if (firstSlash === -1) {
      directFiles.push(node);
    } else {
      const subdir = relPath.slice(0, firstSlash);
      if (!folderMap.has(subdir)) folderMap.set(subdir, []);
      folderMap.get(subdir)!.push(node);
    }
  }

  const outputNodes: Node<FileNodeData | FolderNodeData>[] = [];

  // Build FolderNodes for subdirectories
  for (const [subdir, files] of folderMap) {
    const folderPath = cwd === '' ? subdir : `${cwd}/${subdir}`;
    const colorCount = new Map<string, number>();
    for (const f of files) {
      colorCount.set(f.data.color, (colorCount.get(f.data.color) ?? 0) + 1);
    }
    const color = [...colorCount.entries()].sort((a, b) => b[1] - a[1])[0][0];

    outputNodes.push({
      id: `folder:${folderPath}`,
      type: 'folderNode',
      position: { x: 0, y: 0 },
      data: {
        folderName: subdir,
        folderPath,
        fileCount: files.length,
        color,
        filePaths: files.map((f) => f.id),
      },
    });
  }

  // Include direct FileNodes (re-use the original node data, reset position for layout)
  for (const file of directFiles) {
    outputNodes.push({ ...file, position: { x: 0, y: 0 } });
  }

  const rawEdges = projectCwdEdges(cwd, allFileNodes, allFileEdges, surfacedDocumentationPaths);

  // Merge .c/.h pairs among direct file nodes (folders stay as-is)
  const fileNodesOnly = outputNodes.filter((n) => n.type === 'fileNode') as Node<FileNodeData>[];
  const nonFileNodes = outputNodes.filter((n) => n.type !== 'fileNode');
  const { nodes: mergedFileNodes, edges: mergedEdges } = mergeCHPairs(fileNodesOnly, rawEdges);
  const finalNodes = [...nonFileNodes, ...mergedFileNodes] as Node<
    FileNodeData | FolderNodeData | PairedNodeData
  >[];

  // Dagre layout
  console.log(
    `[graph-data] buildCwdView → ${finalNodes.length} nodes, ${mergedEdges.length} edges`
  );
  console.time('[graph-data] buildCwdView dagre');
  const g = new Dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 84, ranksep: 104, marginx: 36, marginy: 28 });

  for (const node of finalNodes) {
    const w = node.type === 'folderNode' ? FOLDER_NODE_WIDTH : NODE_WIDTH;
    const h = node.type === 'folderNode' ? FOLDER_NODE_HEIGHT : NODE_HEIGHT;
    g.setNode(node.id, { width: w, height: h });
  }
  for (const edge of mergedEdges) {
    g.setEdge(edge.source, edge.target);
  }

  Dagre.layout(g);
  console.timeEnd('[graph-data] buildCwdView dagre');

  for (const node of finalNodes) {
    const n = g.node(node.id);
    if (n) {
      const w = node.type === 'folderNode' ? FOLDER_NODE_WIDTH : NODE_WIDTH;
      const h = node.type === 'folderNode' ? FOLDER_NODE_HEIGHT : NODE_HEIGHT;
      node.position = { x: n.x - w / 2, y: n.y - h / 2 };
    }
  }

  clusterDocumentationNodes(finalNodes);

  console.timeEnd(label);
  return { nodes: finalNodes, edges: mergedEdges };
}

// ─── Per-chapter view ─────────────────────────────────────────────────────────

interface ParsedChapterEdge {
  source: string;
  target: string;
  label?: string;
}

/**
 * Parses the edge-list format used in `chapter-graph` fenced blocks.
 *
 * Each non-blank, non-comment line is expected to have the shape:
 *   source/path.c -> target/path.c
 *   source/path.c -> target/path.c : human-readable label
 */
function parseChapterEdges(graphDef: string): ParsedChapterEdge[] {
  const edges: ParsedChapterEdge[] = [];
  for (const raw of graphDef.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(.+?)\s*->\s*(.+?)(?:\s*:\s*(.+))?$/);
    if (m) {
      edges.push({ source: m[1].trim(), target: m[2].trim(), label: m[3]?.trim() });
    }
  }
  return edges;
}

/**
 * Builds a per-chapter ReactFlow graph.
 *
 * - `chapterFiles` is the authoritative list of file paths for this chapter
 *   (from `fileRecommendations.source` in the guide frontmatter).
 * - Adds any nodes referenced by the curated `chapter-graph` edge list.
 * - Uses curated edges if provided; otherwise falls back to guide edges
 *   between chapter nodes.
 * - Lays out with Dagre (LR direction).
 */
export function buildChapterView(
  allFileNodes: Node<FileNodeData>[],
  allFileEdges: Edge[],
  chapterFiles: string[],
  chapterGraphDef?: string
): { nodes: Node<FileNodeData | PairedNodeData>[]; edges: Edge[] } {
  console.time('[graph-data] buildChapterView');
  const parsedEdges = chapterGraphDef ? parseChapterEdges(chapterGraphDef) : [];

  // Collect all needed file paths: explicit chapter files + edge endpoints
  const needed = new Set<string>(chapterFiles);
  for (const e of parsedEdges) {
    needed.add(e.source);
    needed.add(e.target);
  }

  // If nothing was specified, fall back to all file nodes (avoids empty graph)
  if (needed.size === 0) {
    for (const n of allFileNodes) needed.add(n.id);
  }

  // chapterNodes: subset of allFileNodes that are in the needed set
  const chapterNodes = allFileNodes.filter((n) => needed.has(n.id));

  // Build node map: prefer existing nodes, create minimal stubs for edge-only references
  const nodeMap = new Map<string, Node<FileNodeData>>();
  for (const node of allFileNodes) {
    if (needed.has(node.id)) {
      nodeMap.set(node.id, { ...node, position: { x: 0, y: 0 } });
    }
  }

  const fallbackColor = chapterNodes[0]?.data.color ?? SECTION_COLORS[0];
  for (const path of needed) {
    if (!nodeMap.has(path)) {
      nodeMap.set(path, {
        id: path,
        type: 'fileNode',
        position: { x: 0, y: 0 },
        data: {
          filePath: path,
          fileName: getDisplayName(path),
          language: getLang(path),
          sectionLabel: 'Related',
          sectionIndex: -1,
          color: fallbackColor,
          isDirectory: path.endsWith('/'),
          isDocumentation: isDocumentationPath(path),
          pedagogicalOrder: Number.MAX_SAFE_INTEGER,
          pedagogicalOrderLabel: 'R',
        },
      });
    }
  }

  const rawNodes = [...nodeMap.values()];

  // Build edges
  const rawEdges: Edge[] = [];

  for (let i = 0; i < chapterFiles.length - 1; i++) {
    const source = chapterFiles[i];
    const target = chapterFiles[i + 1];
    if (!nodeMap.has(source) || !nodeMap.has(target) || source === target) continue;
    const color = nodeMap.get(source)!.data.color;
    rawEdges.push({
      id: `story|||${source}|||${target}|||${i}`,
      source,
      target,
      type: 'smoothstep',
      style: { stroke: color, strokeOpacity: 0.92, strokeWidth: 2.4 },
    });
  }

  for (const e of parsedEdges) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) continue;
    const color = nodeMap.get(e.source)!.data.color;
    rawEdges.push({
      id: `ch|||${e.source}|||${e.target}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      ...(e.label
        ? {
            label: e.label,
            labelStyle: { fill: color, fontSize: 8, fontFamily: 'monospace' },
            labelBgStyle: { fill: '#0d0d0d', fillOpacity: 0.85 },
          }
        : {}),
      style: {
        stroke: color,
        strokeOpacity: chapterFiles.length > 1 ? 0.52 : 0.85,
        strokeWidth: chapterFiles.length > 1 ? 1.5 : 2,
        strokeDasharray: chapterFiles.length > 1 ? '5 4' : undefined,
      },
    });
  }

  if (rawEdges.length === 0) {
    // Fallback: guide/analysis edges between chapter nodes
    for (const edge of allFileEdges) {
      if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
      rawEdges.push({
        ...edge,
        id: `${edge.id}:::chapter`,
      });
    }
  }

  // Merge .c/.h pairs
  const { nodes: finalNodes, edges: finalEdges } = mergeCHPairs(rawNodes, rawEdges);

  // Dagre layout
  console.time('[graph-data] buildChapterView dagre');
  layoutFileNodes(finalNodes, finalEdges);
  console.timeEnd('[graph-data] buildChapterView dagre');

  clusterDocumentationNodes(finalNodes);

  console.log(
    `[graph-data] buildChapterView → ${finalNodes.length} nodes, ${finalEdges.length} edges`
  );
  console.timeEnd('[graph-data] buildChapterView');
  return { nodes: finalNodes, edges: finalEdges };
}

// ─── Post-analysis edge projection (no Dagre re-layout) ───────────────────────

/**
 * Re-project `allFileEdges` onto the current CWD view without running Dagre.
 * Called after code analysis completes so we can update edges while preserving
 * the node positions that were already computed at initial render.
 */
export function projectEdgesForCwd(
  allFileNodes: Node<FileNodeData>[],
  allFileEdges: Edge[],
  cwd: string
): Edge[] {
  // Classify files in current cwd: direct files vs. files inside sub-folders
  const directFiles: Node<FileNodeData>[] = [];
  const surfacedDocumentationPaths = new Set<string>();

  for (const node of allFileNodes) {
    const filePath = node.data.filePath;
    if (cwd !== '' && !filePath.startsWith(cwd + '/')) continue;
    if (node.data.isDocumentation) {
      directFiles.push(node);
      surfacedDocumentationPaths.add(node.id);
      continue;
    }
    const relPath = cwd === '' ? filePath : filePath.slice(cwd.length + 1);
    if (relPath.indexOf('/') === -1) directFiles.push(node);
  }

  // C/H pair remap for direct files (mirrors mergeCHPairs logic)
  const pairRemap = new Map<string, string>();
  const pairedIds = new Set<string>();
  const cFiles = directFiles.filter((n) => /\.c$/i.test(n.id));
  const hFiles = directFiles.filter((n) => /\.h$/i.test(n.id));

  for (const cNode of cFiles) {
    if (pairedIds.has(cNode.id)) continue;
    const cStem = cNode.data.fileName.replace(/\.c$/i, '').toLowerCase();
    const hNode = hFiles.find(
      (h) => !pairedIds.has(h.id) && h.data.fileName.replace(/\.h$/i, '').toLowerCase() === cStem
    );
    if (!hNode) continue;
    pairedIds.add(cNode.id);
    pairedIds.add(hNode.id);
    const pairedId = `${cNode.id}|||${hNode.id}`;
    pairRemap.set(cNode.id, pairedId);
    pairRemap.set(hNode.id, pairedId);
  }

  return projectCwdEdges(cwd, allFileNodes, allFileEdges, surfacedDocumentationPaths, pairRemap);
}
