'use client';

import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  findSymbolsInFile,
  findDefinition,
  findAllReferences,
  findReferencesInContent,
  type Location,
  type SymbolReference,
} from '@/lib/cross-reference';
import {
  findCodeIndexSymbolsByName,
  searchCodeIndexSymbols,
  type CodeIndexSymbolEntry,
  type LoadedCodeIndex,
} from '@/lib/code-index';
import { HeuristicLanguageBackend, IndexedLanguageBackend } from '@/lib/language-backends';
import type { BackendDefinition, LanguageBackendContext } from '@/lib/semantic-backend-contract';
import { SemanticQueryService } from '@/lib/semantic-query-service';
import { configureMonacoEnvironment as configureMonacoWorkers } from '@/lib/monaco-config';
import { debugLog } from '@/lib/browser-debug';

type FileFetchResultLike = {
  content: string;
};

type FetchFileFn = (path: string) => Promise<FileFetchResultLike>;
type OpenFileFn = (
  path: string,
  searchPattern?: string,
  scrollToLine?: number,
  searchScope?: string[]
) => void;

const MONACO_DARK_THEME = 'gitshaman-dark';
const MONACO_LIGHT_THEME = 'gitshaman-light';

type MonacoThemeApi = {
  editor?: {
    defineTheme?: (name: string, data: Record<string, unknown>) => void;
    setTheme?: (name: string) => void;
  };
};

function getMonacoThemeName(editorTheme: 'vs-dark' | 'vs'): string {
  return editorTheme === 'vs' ? MONACO_LIGHT_THEME : MONACO_DARK_THEME;
}

function configureMonacoThemes(monaco: MonacoThemeApi): void {
  const defineTheme = monaco.editor?.defineTheme;
  if (!defineTheme) return;

  defineTheme(MONACO_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'eee8dc', background: '17151c' },
      { token: 'comment', foreground: '898292', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c4a7e7' },
      { token: 'string', foreground: '95d6a4' },
      { token: 'number', foreground: 'efc66f' },
      { token: 'type', foreground: '63d8c9' },
      { token: 'function', foreground: '8ecbff' },
      { token: 'variable', foreground: 'eee8dc' },
    ],
    colors: {
      'editor.background': '#17151c',
      'editor.foreground': '#eee8dc',
      'editorLineNumber.foreground': '#777180',
      'editorLineNumber.activeForeground': '#eee8dc',
      'editorCursor.foreground': '#63d8c9',
      'editor.selectionBackground': '#39415a',
      'editor.inactiveSelectionBackground': '#2b2436',
      'editor.lineHighlightBackground': '#211c2b',
      'editorGutter.background': '#17151c',
      'minimap.background': '#17151c',
      'scrollbarSlider.background': '#3c314780',
      'scrollbarSlider.hoverBackground': '#3c3147b0',
      'editorWidget.background': '#211c2b',
      'editorWidget.foreground': '#eee8dc',
      'editorSuggestWidget.background': '#211c2b',
      'editorSuggestWidget.foreground': '#eee8dc',
    },
  });

  defineTheme(MONACO_LIGHT_THEME, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '29232e', background: 'fbf7ed' },
      { token: 'comment', foreground: '786e7b', fontStyle: 'italic' },
      { token: 'keyword', foreground: '6f42c1' },
      { token: 'string', foreground: '1f7a3f' },
      { token: 'number', foreground: '9b6b1e' },
      { token: 'type', foreground: '287f78' },
      { token: 'function', foreground: '0b63a8' },
      { token: 'variable', foreground: '29232e' },
    ],
    colors: {
      'editor.background': '#fbf7ed',
      'editor.foreground': '#29232e',
      'editorLineNumber.foreground': '#8d8290',
      'editorLineNumber.activeForeground': '#29232e',
      'editorCursor.foreground': '#287f78',
      'editor.selectionBackground': '#c6e4df',
      'editor.inactiveSelectionBackground': '#e8deca',
      'editor.lineHighlightBackground': '#f1eadb',
      'editorGutter.background': '#fbf7ed',
      'minimap.background': '#fbf7ed',
      'scrollbarSlider.background': '#d5c7ad80',
      'scrollbarSlider.hoverBackground': '#d5c7adb0',
      'editorWidget.background': '#f1eadb',
      'editorWidget.foreground': '#29232e',
      'editorSuggestWidget.background': '#f1eadb',
      'editorSuggestWidget.foreground': '#29232e',
    },
  });
}

const INDEXABLE_SOURCE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hh',
  'hpp',
  'hxx',
  'inc',
  'inl',
  'ipp',
  'S',
  's',
]);

const workspaceSymbolsCache = new Map<string, SymbolReference[]>();
const workspaceContentsCache = new Map<string, string>();
const workspaceReferencesCache = new Map<string, Location[]>();
const workspaceReferencesPromiseCache = new Map<string, Promise<Location[]>>();

function buildWorkspaceCacheKey(workspaceId: string, filePath: string): string {
  return `${workspaceId}:${filePath}`;
}

function getPathExtension(filePath: string): string {
  return filePath.split('.').pop() || '';
}

function getPathDirectory(filePath: string): string {
  const lastSlashIndex = filePath.lastIndexOf('/');
  return lastSlashIndex === -1 ? '' : filePath.slice(0, lastSlashIndex);
}

function getPathBasename(filePath: string): string {
  const lastSlashIndex = filePath.lastIndexOf('/');
  return lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);
}

function getPathStem(filePath: string): string {
  const basename = getPathBasename(filePath);
  const lastDotIndex = basename.lastIndexOf('.');
  return lastDotIndex === -1 ? basename : basename.slice(0, lastDotIndex);
}

function normalizeSymbolQuery(symbolName: string): string {
  return symbolName
    .trim()
    .replace(/\(\)$/, '')
    .replace(/^(struct|class|enum)\s+/, '');
}

function isIndexableSourceFile(filePath: string): boolean {
  return INDEXABLE_SOURCE_EXTENSIONS.has(getPathExtension(filePath));
}

function extractIncludeTargets(content: string): string[] {
  const includePattern = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm;
  const includeTargets: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = includePattern.exec(content)) !== null) {
    includeTargets.push(match[1]);
  }

  return includeTargets;
}

function rankWorkspaceCandidatePaths(
  symbolName: string,
  currentFilePath: string,
  content: string,
  workspaceFilePaths: string[]
): string[] {
  const normalizedSymbol = normalizeSymbolQuery(symbolName).toLowerCase();
  const currentDir = getPathDirectory(currentFilePath);
  const currentStem = getPathStem(currentFilePath).toLowerCase();
  const includeTargets = new Set(extractIncludeTargets(content));
  const includeBasenames = new Set(Array.from(includeTargets, (target) => getPathBasename(target)));
  const candidateScores = new Map<string, number>();

  const addCandidate = (filePath: string, score: number) => {
    if (!filePath || !isIndexableSourceFile(filePath)) return;
    const previous = candidateScores.get(filePath) ?? Number.NEGATIVE_INFINITY;
    if (score > previous) {
      candidateScores.set(filePath, score);
    }
  };

  addCandidate(currentFilePath, 1000);

  for (const filePath of workspaceFilePaths) {
    const basename = getPathBasename(filePath);
    const stem = getPathStem(filePath).toLowerCase();
    const dir = getPathDirectory(filePath);
    let score = 0;

    if (stem === currentStem && filePath !== currentFilePath) score += 950;
    if (includeTargets.has(filePath) || includeBasenames.has(basename)) score += 900;
    if (dir === currentDir) score += 500;
    if (stem === normalizedSymbol) score += 700;
    if (stem.includes(normalizedSymbol) || basename.toLowerCase().includes(normalizedSymbol)) {
      score += 350;
    }
    if (basename.endsWith('.h') || basename.endsWith('.hpp') || basename.endsWith('.hh')) {
      score += 125;
    }

    if (score > 0) {
      addCandidate(filePath, score);
    }
  }

  const rankedCandidates = Array.from(candidateScores.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([filePath]) => filePath);

  const remainingCandidates = workspaceFilePaths
    .filter((filePath) => isIndexableSourceFile(filePath) && !candidateScores.has(filePath))
    .sort();

  return [...rankedCandidates, ...remainingCandidates];
}

function rankReferenceCandidatePaths(
  symbolName: string,
  currentFilePath: string,
  definitionFilePath: string | undefined,
  content: string,
  workspaceFilePaths: string[]
): string[] {
  const normalizedSymbol = normalizeSymbolQuery(symbolName).toLowerCase();
  const currentDir = getPathDirectory(currentFilePath);
  const currentTopLevelDir = currentFilePath.split('/')[0] || '';
  const definitionDir = definitionFilePath ? getPathDirectory(definitionFilePath) : '';
  const definitionTopLevelDir = definitionFilePath?.split('/')[0] || '';
  const currentStem = getPathStem(currentFilePath).toLowerCase();
  const definitionStem = definitionFilePath ? getPathStem(definitionFilePath).toLowerCase() : '';
  const includeTargets = new Set(extractIncludeTargets(content));
  const includeBasenames = new Set(Array.from(includeTargets, (target) => getPathBasename(target)));
  const candidateScores = new Map<string, number>();

  const addCandidate = (filePath: string, score: number) => {
    if (!filePath || !isIndexableSourceFile(filePath)) return;
    const previous = candidateScores.get(filePath) ?? Number.NEGATIVE_INFINITY;
    if (score > previous) {
      candidateScores.set(filePath, score);
    }
  };

  addCandidate(currentFilePath, 5000);
  if (definitionFilePath) {
    addCandidate(definitionFilePath, 4900);
  }

  for (const filePath of workspaceFilePaths) {
    if (!isIndexableSourceFile(filePath)) continue;

    const basename = getPathBasename(filePath);
    const stem = getPathStem(filePath).toLowerCase();
    const dir = getPathDirectory(filePath);
    const topLevelDir = filePath.split('/')[0] || '';
    let score = 0;

    if (dir === currentDir) score += 2200;
    if (definitionDir && dir === definitionDir) score += 2000;
    if (topLevelDir && topLevelDir === currentTopLevelDir) score += 1100;
    if (definitionTopLevelDir && topLevelDir === definitionTopLevelDir) score += 1000;
    if (stem === currentStem || (definitionStem && stem === definitionStem)) score += 900;
    if (includeTargets.has(filePath) || includeBasenames.has(basename)) score += 800;
    if (stem === normalizedSymbol) score += 700;
    if (stem.includes(normalizedSymbol) || basename.toLowerCase().includes(normalizedSymbol)) {
      score += 250;
    }

    if (score > 0) {
      addCandidate(filePath, score);
    }
  }

  return Array.from(candidateScores.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([filePath]) => filePath);
}

function getKnownDefinitionCandidatePaths(symbolName: string): string[] {
  const normalizedSymbol = normalizeSymbolQuery(symbolName);
  const paths: string[] = [];

  if (
    normalizedSymbol === 'pr_debug' ||
    normalizedSymbol === 'pr_info' ||
    normalizedSymbol === 'pr_warn' ||
    normalizedSymbol === 'pr_warning' ||
    normalizedSymbol === 'pr_err' ||
    normalizedSymbol === 'pr_notice' ||
    normalizedSymbol === 'pr_cont' ||
    normalizedSymbol === 'pr_devel' ||
    normalizedSymbol === 'printk' ||
    normalizedSymbol === 'no_printk'
  ) {
    paths.push('include/linux/printk.h');
  }

  if (normalizedSymbol.startsWith('dev_') || normalizedSymbol.startsWith('netdev_')) {
    paths.push('include/linux/dev_printk.h', 'include/linux/device.h');
  }

  if (normalizedSymbol.startsWith('list_') || normalizedSymbol.startsWith('hlist_')) {
    paths.push('include/linux/list.h', 'include/linux/llist.h');
  }

  if (
    normalizedSymbol.startsWith('spin_') ||
    normalizedSymbol.startsWith('raw_spin_') ||
    normalizedSymbol.startsWith('read_lock') ||
    normalizedSymbol.startsWith('write_lock')
  ) {
    paths.push('include/linux/spinlock.h', 'include/linux/spinlock_types.h');
  }

  return paths;
}

function findBestMatchingSymbolDefinition(
  symbolName: string,
  symbols: SymbolReference[]
): SymbolReference | null {
  const normalizedSymbol = normalizeSymbolQuery(symbolName);

  return (
    findDefinition(normalizedSymbol, symbols) ??
    symbols.find(
      (symbol) => symbol.isDefinition && normalizeSymbolQuery(symbol.name) === normalizedSymbol
    ) ??
    symbols.find((symbol) => normalizeSymbolQuery(symbol.name) === normalizedSymbol) ??
    null
  );
}

function buildLocalSymbolHoverMarkdown(symbolName: string, symbols: SymbolReference[]): string[] {
  const definition = findBestMatchingSymbolDefinition(symbolName, symbols);
  const allRefs = findAllReferences(symbolName, symbols);
  const usageCount = allRefs.length;

  if (!definition && usageCount === 0) {
    return [];
  }

  const symbol = definition ?? symbols.find((candidate) => candidate.name === symbolName) ?? null;
  const symbolType = symbol?.type ?? 'symbol';
  const contents = [`**${symbolName}** \`${symbolType}\``];

  if (symbol?.type === 'function' && symbol.signature) {
    contents.push('```c\n' + symbol.signature + '\n```');
  } else if ((symbol?.type === 'struct' || symbol?.type === 'class') && symbol.members) {
    if (symbol.members.length > 0) {
      const membersList = symbol.members
        .slice(0, 10)
        .map((member) => `  ${member.type} ${member.name};`)
        .join('\n');
      const moreText =
        symbol.members.length > 10 ? `\n  // ... ${symbol.members.length - 10} more` : '';
      contents.push('```c\n' + membersList + moreText + '\n```');
    }
  }

  if (symbol?.documentation) {
    contents.push(`*${symbol.documentation}*`);
  }

  contents.push(`**${usageCount}** reference${usageCount !== 1 ? 's' : ''} found`);

  if (symbol && symbol.relatedSymbols.length > 0) {
    const relatedList = symbol.relatedSymbols.slice(0, 5).join(', ');
    const moreRelated =
      symbol.relatedSymbols.length > 5 ? ` +${symbol.relatedSymbols.length - 5} more` : '';
    contents.push(`*Related: ${relatedList}${moreRelated}*`);
  }

  if (symbol) {
    contents.push(
      `${symbol.isDefinition ? '📍' : '📝'} Line ${symbol.line} in ${symbol.file.split('/').pop()}`
    );
  }

  return contents;
}

function backendDefinitionToSymbolReference(definition: BackendDefinition): SymbolReference {
  return {
    name: definition.name,
    type: definition.kind === 'type' ? 'typedef' : (definition.kind as SymbolReference['type']),
    line: definition.line,
    column: definition.column,
    file: definition.file,
    isDefinition: true,
    isDeclaration: false,
    signature: definition.signature,
    documentation: definition.documentation,
    references: [],
    relatedSymbols: [],
  };
}

function symbolReferenceToBackendDefinition(symbol: SymbolReference): BackendDefinition {
  return {
    name: symbol.name,
    kind: symbol.type,
    file: symbol.file,
    line: symbol.line,
    column: symbol.column,
    signature: symbol.signature,
    documentation: symbol.documentation,
  };
}

// Configure the local Monaco runtime before mounting the lazy-loaded editor.
const Editor = dynamic(
  async () => {
    configureMonacoWorkers();
    const [monaco, { default: MonacoEditor, loader }] = await Promise.all([
      import('monaco-editor'),
      import('@monaco-editor/react'),
    ]);
    loader.config({ monaco });
    return MonacoEditor;
  },
  {
    ssr: false,
    loading: () => (
      <div className="vscode-loading">
        <div className="vscode-spinner" />
        <div>Loading editor...</div>
      </div>
    ),
  }
);

interface MonacoCodeEditorProps {
  filePath: string;
  content: string;
  contentFilePath?: string;
  isLoading: boolean;
  scrollToLine?: number;
  searchPattern?: string;
  navigationNonce?: number;
  onCursorChange?: (line: number, column: number) => void;
  onOpenFile?: OpenFileFn;
  fetchFile?: FetchFileFn;
  workspaceFilePaths?: string[];
  workspaceId?: string;
  codeIndex?: LoadedCodeIndex | null;
  editorTheme?: 'vs-dark' | 'vs';
}

type MonacoEditorLike = {
  layout: (dimension?: { width: number; height: number }) => void;
  updateOptions: (options: Record<string, unknown>) => void;
  getModel: () => {
    getValue: () => string;
    setValue: (value: string) => void;
    uri?: unknown;
  } | null;
  onDidChangeCursorPosition: (
    listener: (e: { position: { lineNumber: number; column: number } }) => void
  ) => { dispose: () => void } | void;
  onDidChangeModel: (
    listener: (e: { newModelUrl?: unknown; oldModelUrl?: unknown }) => void
  ) => { dispose: () => void } | void;
  getPosition: () => { lineNumber: number; column: number } | null;
  addCommand: (keybinding: number, handler: () => void) => string | null;
  getAction: (actionId: string) => { run: () => Promise<void> } | null;
  onMouseDown: (
    listener: (e: {
      event: { ctrlKey: boolean; metaKey: boolean; preventDefault: () => void };
      target: { position?: { lineNumber: number; column: number } };
    }) => void
  ) => void;
};

type MonacoLanguageApi = {
  FoldingRangeKind: {
    Comment: unknown;
    Imports: unknown;
  };
  registerFoldingRangeProvider: (
    languageSelector: string,
    provider: {
      provideFoldingRanges: () => Array<{
        start: number;
        end: number;
        kind?: unknown;
      }>;
    }
  ) => { dispose: () => void };
};

type MonacoTestApi = {
  getActiveFilePath: () => string;
  focusSymbol: (symbol: string) => Promise<boolean>;
  showReferencesAtCursor: () => Promise<boolean>;
  closeReferencesWidget: () => Promise<boolean>;
  goToDefinitionAtCursor: () => Promise<boolean>;
};

type XrefReferenceItem = Location & {
  key: string;
  preview: string;
  fileName: string;
  directory: string;
};

type XrefPanelState = {
  symbolName: string;
  references: XrefReferenceItem[];
  selectedReferenceKey: string | null;
  isLoading: boolean;
  error: string | null;
};

type DefinitionCandidate = SymbolReference & {
  provider: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
};

type DefinitionPanelState = {
  symbolName: string;
  candidates: DefinitionCandidate[];
};

function codeIndexSymbolToDefinitionCandidate(
  symbol: CodeIndexSymbolEntry,
  reason: string,
  confidence: DefinitionCandidate['confidence'] = 'high'
): DefinitionCandidate {
  const reference = backendDefinitionToSymbolReference({
    name: symbol.name,
    kind: symbol.kind,
    file: symbol.path,
    line: symbol.startLine,
    column: symbol.startColumn,
    signature: symbol.signature ?? undefined,
    documentation: symbol.doc ?? undefined,
  });
  return {
    ...reference,
    provider: 'indexed',
    confidence,
    reason,
  };
}

function symbolReferenceToDefinitionCandidate(
  symbol: SymbolReference,
  reason: string,
  confidence: DefinitionCandidate['confidence'] = 'medium'
): DefinitionCandidate {
  return {
    ...symbol,
    provider: 'heuristic',
    confidence,
    reason,
  };
}

function dedupeDefinitionCandidates(candidates: DefinitionCandidate[]): DefinitionCandidate[] {
  const rankedConfidence = { high: 0, medium: 1, low: 2 } satisfies Record<
    DefinitionCandidate['confidence'],
    number
  >;
  const byLocation = new Map<string, DefinitionCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.name}:${candidate.file}:${candidate.line}:${candidate.column}`;
    const existing = byLocation.get(key);
    if (
      !existing ||
      rankedConfidence[candidate.confidence] < rankedConfidence[existing.confidence]
    ) {
      byLocation.set(key, candidate);
    }
  }
  return Array.from(byLocation.values()).sort((left, right) => {
    const confidenceDelta = rankedConfidence[left.confidence] - rankedConfidence[right.confidence];
    if (confidenceDelta !== 0) return confidenceDelta;
    const definitionDelta = Number(right.isDefinition) - Number(left.isDefinition);
    if (definitionDelta !== 0) return definitionDelta;
    const kindDelta = definitionKindRank(left.type) - definitionKindRank(right.type);
    if (kindDelta !== 0) return kindDelta;
    return left.file.localeCompare(right.file) || left.line - right.line;
  });
}

function definitionKindRank(kind: SymbolReference['type']): number {
  if (kind === 'macro') return 0;
  if (kind === 'function') return 1;
  if (kind === 'typedef') return 2;
  if (kind === 'struct' || kind === 'class') return 3;
  return 4;
}

function definitionReasonForSymbol(symbol: CodeIndexSymbolEntry | SymbolReference): string {
  const kind = 'kind' in symbol ? symbol.kind : symbol.type;
  if (kind === 'macro') return 'macro-definition';
  if (kind === 'function') return 'function-definition';
  if (kind === 'typedef' || kind === 'type') return 'type-definition';
  return 'workspace-symbol';
}

const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  filePath,
  content,
  contentFilePath,
  isLoading,
  scrollToLine,
  searchPattern,
  navigationNonce,
  onCursorChange,
  onOpenFile,
  fetchFile,
  workspaceFilePaths = [],
  workspaceId = 'default',
  codeIndex = null,
  editorTheme = 'vs-dark',
}) => {
  const codeLensReferenceCountCacheRef = useRef<Map<string, number>>(new Map());
  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const decorationsRef = useRef<string[]>([]);
  const symbolsRef = useRef<SymbolReference[]>([]);
  const providerDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const monacoModelCreationPromisesRef = useRef<Map<string, Promise<unknown | null>>>(new Map());
  const testFocusedSymbolRef = useRef<{
    filePath: string;
    symbol: string;
    lineNumber: number;
  } | null>(null);
  const [hasMountedEditor, setHasMountedEditor] = useState(false);
  const [xrefPanelState, setXrefPanelState] = useState<XrefPanelState | null>(null);
  const [definitionPanelState, setDefinitionPanelState] = useState<DefinitionPanelState | null>(
    null
  );

  const disposeRegisteredProviders = useCallback(() => {
    for (const disposable of providerDisposablesRef.current) {
      disposable.dispose();
    }
    providerDisposablesRef.current = [];
  }, []);

  const revealTargetLine = useCallback((targetLine: number, lines: string[]) => {
    if (!editorRef.current || targetLine < 1) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = editorRef.current as any;

    if (decorationsRef.current.length > 0) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
    }

    editor.revealLineInCenter(targetLine);
    editor.setPosition({ lineNumber: targetLine, column: 1 });

    decorationsRef.current = editor.deltaDecorations(
      [],
      [
        {
          range: {
            startLineNumber: targetLine,
            startColumn: 1,
            endLineNumber: targetLine,
            endColumn: lines[targetLine - 1]?.length || 1,
          },
          options: {
            isWholeLine: true,
            className: 'highlight-line',
            glyphMarginClassName: 'highlight-line-glyph',
          },
        },
      ]
    );
  }, []);

  const findDefinitionLineForPattern = useCallback(
    (pattern: string, lines: string[], symbols: SymbolReference[] = symbolsRef.current): number => {
      const normalizedPattern = pattern.trim().replace(/\(\)$/, '');
      if (!normalizedPattern) return -1;

      const slugifyHeading = (value: string) =>
        value
          .replace(/`([^`]+)`/g, '$1')
          .replace(/<[^>]*>/g, '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9 _-]+/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

      const normalizedSlug = slugifyHeading(normalizedPattern);
      if (normalizedSlug) {
        for (let i = 0; i < lines.length; i++) {
          const markdownHeading = lines[i].match(/^#{1,6}\s+(.+?)\s*#*$/);
          if (markdownHeading) {
            const headingText = markdownHeading[1].trim();
            if (
              headingText === normalizedPattern ||
              slugifyHeading(headingText) === normalizedSlug
            ) {
              return i + 1;
            }
          }

          const currentLine = lines[i].trim();
          const nextLine = lines[i + 1]?.trim() || '';
          if (
            currentLine &&
            /^[=\-~^"']+$/.test(nextLine) &&
            (currentLine === normalizedPattern || slugifyHeading(currentLine) === normalizedSlug)
          ) {
            return i + 1;
          }
        }
      }

      const directDefinition = findDefinition(normalizedPattern, symbols);
      if (directDefinition) {
        return directDefinition.line;
      }

      const exactDefinition = symbols.find(
        (symbol) =>
          symbol.isDefinition &&
          (symbol.name === normalizedPattern ||
            symbol.name === normalizedPattern.replace(/^(struct|class|enum)\s+/, ''))
      );
      if (exactDefinition) {
        return exactDefinition.line;
      }

      const escapedPattern = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const simpleName = normalizedPattern.replace(/^(struct|class|enum)\s+/, '');
      const escapedSimpleName = simpleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const definitionPatterns = [
        new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${escapedSimpleName}\\s*\\(`),
        new RegExp(
          `^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escapedSimpleName}\\s*=\\s*(?:async\\s*)?\\(`
        ),
        new RegExp(
          `^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escapedSimpleName}\\s*=\\s*(?:async\\s*)?[^=]*=>`
        ),
        new RegExp(`^\\s*(?:async\\s+)?def\\s+${escapedSimpleName}\\s*\\(`),
        new RegExp(`^\\s*fn\\s+${escapedSimpleName}\\s*\\(`),
        new RegExp(`^\\s*func\\s+${escapedSimpleName}\\s*\\(`),
        new RegExp(`^\\s*#\\s*define\\s+${escapedSimpleName}\\b`),
        new RegExp(`^\\s*(?:COMPAT_)?SYSCALL_DEFINE\\d+\\s*\\(\\s*${escapedSimpleName}\\s*,?`),
        new RegExp(
          `^\\s*(?:[\\w~:*<>\\[\\],&]+\\s+)+${escapedSimpleName}\\s*\\([^;{}]*\\)\\s*(?:\\{|$)`
        ),
        new RegExp(`^\\s*${escapedPattern}\\s*\\{`),
        new RegExp(`^\\s*${escapedPattern}\\s*$`),
        new RegExp(`^\\s*typedef\\s+${escapedPattern}`),
      ];

      for (let i = 0; i < lines.length; i++) {
        for (const definitionPattern of definitionPatterns) {
          if (definitionPattern.test(lines[i])) {
            return i + 1;
          }
        }
      }

      if (simpleName !== normalizedPattern) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(simpleName) && lines[i].includes(normalizedPattern.split(' ')[0])) {
            return i + 1;
          }
        }
      }

      return -1;
    },
    []
  );

  const getMonacoLanguage = useCallback((filename: string): string => {
    const extension = filename.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'c':
        return 'c';
      case 'h':
        return 'c';
      case 'cpp':
      case 'cc':
      case 'cxx':
        return 'cpp';
      case 'cs':
      case 'csx':
        return 'csharp';
      case 's':
      case 'S':
        return 'asm';
      case 'py':
        return 'python';
      case 'sh':
        return 'shell';
      case 'rs':
        return 'rust';
      case 'go':
        return 'go';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'json':
        return 'json';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'md':
        return 'plaintext';
      case 'txt':
        return 'plaintext';
      case 'Makefile':
      case 'makefile':
        return 'makefile';
      case 'Kconfig':
        return 'ini'; // Closest to Kconfig syntax
      default:
        return 'plaintext';
    }
  }, []);

  const language = useMemo(
    () => (filePath ? getMonacoLanguage(filePath) : 'text'),
    [filePath, getMonacoLanguage]
  );

  const getAnalyzedSymbolsForFile = useCallback(
    async (targetFilePath: string): Promise<SymbolReference[]> => {
      const cacheKey = buildWorkspaceCacheKey(workspaceId, targetFilePath);
      const cachedSymbols = workspaceSymbolsCache.get(cacheKey);
      if (cachedSymbols) {
        return cachedSymbols;
      }

      const targetContent =
        targetFilePath === filePath
          ? content
          : (workspaceContentsCache.get(cacheKey) ??
            (fetchFile ? (await fetchFile(targetFilePath)).content : ''));

      if (!targetContent) {
        return [];
      }

      workspaceContentsCache.set(cacheKey, targetContent);
      const parsedSymbols = findSymbolsInFile(targetContent, targetFilePath);
      workspaceSymbolsCache.set(cacheKey, parsedSymbols);
      return parsedSymbols;
    },
    [content, fetchFile, filePath, workspaceId]
  );

  const getWorkspaceFileContent = useCallback(
    async (targetFilePath: string): Promise<string> => {
      const cacheKey = buildWorkspaceCacheKey(workspaceId, targetFilePath);
      if (targetFilePath === filePath) {
        return content;
      }

      const cachedContent = workspaceContentsCache.get(cacheKey);
      if (cachedContent !== undefined) {
        return cachedContent;
      }

      if (!fetchFile) {
        return '';
      }

      const fetchedContent = (await fetchFile(targetFilePath)).content;
      workspaceContentsCache.set(cacheKey, fetchedContent);
      return fetchedContent;
    },
    [content, fetchFile, filePath, workspaceId]
  );

  const ensureMonacoModelForFile = useCallback(
    async (targetFilePath: string): Promise<unknown | null> => {
      const pendingModelCreation = monacoModelCreationPromisesRef.current.get(targetFilePath);
      if (pendingModelCreation) {
        return pendingModelCreation;
      }

      const monaco = monacoRef.current as {
        Uri: { parse: (value: string) => unknown };
        editor: {
          getModel: (uri: unknown) => { uri?: unknown } | null;
          createModel: (value: string, language?: string, uri?: unknown) => unknown;
        };
      } | null;

      if (!monaco || targetFilePath === filePath) {
        return null;
      }

      const uri = monaco.Uri.parse(`file:///${targetFilePath}`);
      const existingModel = monaco.editor.getModel(uri);
      if (existingModel) {
        return existingModel.uri ?? uri;
      }

      const creationPromise = (async () => {
        const targetContent = await getWorkspaceFileContent(targetFilePath);
        if (!targetContent) {
          return null;
        }

        const modelCreatedWhileFetching = monaco.editor.getModel(uri);
        if (modelCreatedWhileFetching) {
          return modelCreatedWhileFetching.uri ?? uri;
        }

        const createdModel = monaco.editor.createModel(
          targetContent,
          getMonacoLanguage(targetFilePath),
          uri
        ) as { uri?: unknown } | null;
        debugLog('[explorar:xref] created-reference-model', {
          filePath,
          targetFilePath,
        });
        return createdModel?.uri ?? uri;
      })().finally(() => {
        monacoModelCreationPromisesRef.current.delete(targetFilePath);
      });

      monacoModelCreationPromisesRef.current.set(targetFilePath, creationPromise);
      return creationPromise;
    },
    [filePath, getMonacoLanguage, getWorkspaceFileContent]
  );

  const resolveDefinitionHeuristically = useCallback(
    async (symbolName: string): Promise<SymbolReference | null> => {
      const normalizedSymbol = normalizeSymbolQuery(symbolName);
      const localDefinition =
        findDefinition(normalizedSymbol, symbolsRef.current) ??
        symbolsRef.current.find(
          (symbol) => symbol.isDefinition && normalizeSymbolQuery(symbol.name) === normalizedSymbol
        ) ??
        null;
      if (localDefinition?.isDefinition) {
        return localDefinition;
      }

      if (!fetchFile || workspaceFilePaths.length === 0) {
        return (
          symbolsRef.current.find(
            (symbol) => normalizeSymbolQuery(symbol.name) === normalizedSymbol
          ) ?? null
        );
      }

      const candidatePaths = rankWorkspaceCandidatePaths(
        symbolName,
        filePath,
        content,
        workspaceFilePaths
      );
      const maxFilesToSearch = Math.min(candidatePaths.length, 80);

      for (let i = 0; i < maxFilesToSearch; i++) {
        const candidatePath = candidatePaths[i];
        if (candidatePath === filePath) {
          continue;
        }

        try {
          const candidateSymbols = await getAnalyzedSymbolsForFile(candidatePath);
          const definition = findBestMatchingSymbolDefinition(symbolName, candidateSymbols);
          if (definition) {
            debugLog('[explorar:xref] resolved-workspace-definition', {
              symbolName,
              sourceFile: filePath,
              targetFile: definition.file,
              targetLine: definition.line,
              searchedFiles: i + 1,
            });
            return definition;
          }
        } catch (error) {
          debugLog('[explorar:xref] workspace-definition-error', {
            symbolName,
            sourceFile: filePath,
            candidatePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return (
        symbolsRef.current.find(
          (symbol) => normalizeSymbolQuery(symbol.name) === normalizedSymbol
        ) ?? null
      );
    },
    [content, fetchFile, filePath, getAnalyzedSymbolsForFile, workspaceFilePaths]
  );

  const findReferencesHeuristically = useCallback(
    async (symbolName: string, includeDeclaration: boolean): Promise<Location[]> => {
      const normalizedSymbol = normalizeSymbolQuery(symbolName);
      const referenceCacheKey = `${workspaceId}:${normalizedSymbol}:${includeDeclaration ? 'with-def' : 'refs-only'}`;
      const cachedReferences = workspaceReferencesCache.get(referenceCacheKey);
      if (cachedReferences) {
        return cachedReferences;
      }

      const pendingReferences = workspaceReferencesPromiseCache.get(referenceCacheKey);
      if (pendingReferences) {
        return pendingReferences;
      }

      const referencePromise = (async () => {
        const definition = await resolveDefinitionHeuristically(normalizedSymbol);
        const rankedCandidatePaths = rankReferenceCandidatePaths(
          normalizedSymbol,
          filePath,
          definition?.file,
          content,
          workspaceFilePaths
        );
        const filesToScan = rankedCandidatePaths.slice(0, 160);

        const references: Location[] = [];
        const batchSize = 12;

        for (let i = 0; i < filesToScan.length; i += batchSize) {
          const batch = filesToScan.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (candidatePath) => {
              try {
                const candidateContent = await getWorkspaceFileContent(candidatePath);
                if (!candidateContent) {
                  return [] as Location[];
                }

                const excludeDefinitionLine =
                  definition && candidatePath === definition.file ? definition.line : undefined;
                return findReferencesInContent(
                  normalizedSymbol,
                  candidateContent,
                  candidatePath,
                  includeDeclaration ? undefined : excludeDefinitionLine
                );
              } catch (error) {
                console.warn('[explorar:xref] workspace-reference-scan-file-failed', {
                  symbolName: normalizedSymbol,
                  sourceFile: filePath,
                  candidatePath,
                  error: error instanceof Error ? error.message : String(error),
                });
                return [] as Location[];
              }
            })
          );

          for (const matches of batchResults) {
            references.push(...matches);
          }
        }

        const dedupedReferences = Array.from(
          new Map(
            references.map((location) => [
              `${location.file}:${location.line}:${location.column}`,
              location,
            ])
          ).values()
        );

        if (includeDeclaration && definition) {
          dedupedReferences.unshift({
            file: definition.file,
            line: definition.line,
            column: definition.column,
          });
        }

        const uniqueReferenceFiles = Array.from(
          new Set(
            dedupedReferences
              .map((location) => location.file)
              .filter((candidatePath) => candidatePath && candidatePath !== filePath)
          )
        );

        await Promise.all(
          uniqueReferenceFiles.map(async (referenceFilePath) => {
            try {
              await ensureMonacoModelForFile(referenceFilePath);
            } catch (error) {
              console.warn('[explorar:xref] reference-model-create-failed', {
                filePath,
                referenceFilePath,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          })
        );

        debugLog('[explorar:xref] workspace-references-ready', {
          symbolName: normalizedSymbol,
          sourceFile: filePath,
          includeDeclaration,
          fileCountScanned: filesToScan.length,
          totalRankedCandidates: rankedCandidatePaths.length,
          referenceCount: dedupedReferences.length,
          uniqueReferenceFileCount: uniqueReferenceFiles.length,
          sampleReferences: dedupedReferences.slice(0, 5),
        });

        workspaceReferencesCache.set(referenceCacheKey, dedupedReferences);
        return dedupedReferences;
      })().finally(() => {
        workspaceReferencesPromiseCache.delete(referenceCacheKey);
      });

      workspaceReferencesPromiseCache.set(referenceCacheKey, referencePromise);
      return referencePromise;
    },
    [
      ensureMonacoModelForFile,
      filePath,
      content,
      getWorkspaceFileContent,
      resolveDefinitionHeuristically,
      workspaceFilePaths,
      workspaceId,
    ]
  );

  const getHeuristicHover = useCallback(async (symbolName: string) => {
    const markdown = buildLocalSymbolHoverMarkdown(symbolName, symbolsRef.current);
    return markdown.length > 0 ? { markdown } : null;
  }, []);

  const backendContext = useMemo(
    (): LanguageBackendContext => ({
      filePath,
      content,
      workspaceFilePaths,
    }),
    [content, filePath, workspaceFilePaths]
  );

  const semanticQueryService = useMemo(() => {
    return new SemanticQueryService([new IndexedLanguageBackend(codeIndex)], {
      debugLog,
    });
  }, [codeIndex]);

  useEffect(() => {
    semanticQueryService.register(
      new HeuristicLanguageBackend({
        getDefinition: async (symbolName: string) => {
          const definition = await resolveDefinitionHeuristically(symbolName);
          return definition ? symbolReferenceToBackendDefinition(definition) : null;
        },
        getReferences: async (symbolName: string, context: LanguageBackendContext) =>
          findReferencesHeuristically(symbolName, Boolean(context.includeDeclaration)),
        getHover: getHeuristicHover,
        getDiagnostics: async () => [],
        getDocumentSymbols: async () => symbolsRef.current,
      })
    );
  }, [
    findReferencesHeuristically,
    getHeuristicHover,
    resolveDefinitionHeuristically,
    semanticQueryService,
  ]);

  const resolveDefinitionCandidatesAcrossWorkspace = useCallback(
    async (symbolName: string): Promise<DefinitionCandidate[]> => {
      const normalizedSymbol = normalizeSymbolQuery(symbolName);
      if (!normalizedSymbol) {
        return [];
      }

      const candidates: DefinitionCandidate[] = [];
      const definition = await semanticQueryService.findDefinition(
        language,
        normalizedSymbol,
        backendContext
      );
      if (definition) {
        candidates.push({
          ...backendDefinitionToSymbolReference(definition),
          provider: 'semantic',
          confidence: 'high',
          reason: 'indexed',
        });
      }

      if (codeIndex) {
        const exactSymbols = findCodeIndexSymbolsByName(codeIndex, normalizedSymbol, {
          definitionOnly: true,
          limit: 25,
        });
        candidates.push(
          ...exactSymbols.map((symbol) =>
            codeIndexSymbolToDefinitionCandidate(
              symbol,
              definitionReasonForSymbol(symbol),
              symbol.name === normalizedSymbol ? 'high' : 'medium'
            )
          )
        );

        const searchedSymbols = searchCodeIndexSymbols(codeIndex, normalizedSymbol, 25).filter(
          (symbol) =>
            symbol.isDefinition &&
            normalizeSymbolQuery(symbol.name).toLowerCase() === normalizedSymbol.toLowerCase()
        );
        candidates.push(
          ...searchedSymbols.map((symbol) =>
            codeIndexSymbolToDefinitionCandidate(
              symbol,
              definitionReasonForSymbol(symbol),
              'medium'
            )
          )
        );
      }

      const localDefinition =
        findBestMatchingSymbolDefinition(normalizedSymbol, symbolsRef.current) ??
        symbolsRef.current.find(
          (symbol) => normalizeSymbolQuery(symbol.name) === normalizedSymbol
        ) ??
        null;
      if (localDefinition) {
        candidates.push(
          symbolReferenceToDefinitionCandidate(
            localDefinition,
            definitionReasonForSymbol(localDefinition),
            localDefinition.isDefinition ? 'medium' : 'low'
          )
        );
      }

      if (fetchFile && workspaceFilePaths.length > 0) {
        const candidatePaths = rankWorkspaceCandidatePaths(
          normalizedSymbol,
          filePath,
          content,
          workspaceFilePaths
        );
        const searchSeedPaths = new Set(candidatePaths.slice(0, 80));
        const workspacePathSet = new Set(workspaceFilePaths);
        for (const knownPath of getKnownDefinitionCandidatePaths(normalizedSymbol)) {
          if (workspacePathSet.has(knownPath)) {
            searchSeedPaths.add(knownPath);
          }
        }
        for (const candidate of candidates) {
          if (candidate.file && candidate.file !== filePath) {
            searchSeedPaths.add(candidate.file);
          }
        }

        for (const candidatePath of Array.from(searchSeedPaths).slice(0, 120)) {
          if (!candidatePath || !isIndexableSourceFile(candidatePath)) {
            continue;
          }

          try {
            const candidateContent =
              candidatePath === filePath ? content : await getWorkspaceFileContent(candidatePath);
            if (!candidateContent) {
              continue;
            }

            const targetLine = findDefinitionLineForPattern(
              normalizedSymbol,
              candidateContent.split('\n'),
              candidatePath === filePath ? symbolsRef.current : []
            );
            if (targetLine === -1) {
              continue;
            }

            const candidateSymbols =
              candidatePath === filePath
                ? symbolsRef.current
                : await getAnalyzedSymbolsForFile(candidatePath);
            const parsedDefinition = findBestMatchingSymbolDefinition(
              normalizedSymbol,
              candidateSymbols
            );
            if (parsedDefinition) {
              candidates.push(
                symbolReferenceToDefinitionCandidate(
                  parsedDefinition,
                  definitionReasonForSymbol(parsedDefinition),
                  parsedDefinition.type === 'macro' ? 'high' : 'medium'
                )
              );
              continue;
            }

            const lineText = candidateContent.split('\n')[targetLine - 1] ?? '';
            const column = Math.max(1, lineText.indexOf(normalizedSymbol) + 1);
            candidates.push({
              name: normalizedSymbol,
              type: lineText.trim().startsWith('#define') ? 'macro' : 'function',
              line: targetLine,
              column,
              file: candidatePath,
              isDefinition: true,
              isDeclaration: false,
              signature: lineText.trim(),
              references: [],
              relatedSymbols: [],
              provider: 'heuristic',
              confidence: lineText.trim().startsWith('#define') ? 'high' : 'medium',
              reason: lineText.trim().startsWith('#define')
                ? 'macro-definition'
                : 'pattern-definition',
            });
          } catch (error) {
            debugLog('[explorar:xref] deep-definition-error', {
              symbolName: normalizedSymbol,
              sourceFile: filePath,
              candidatePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      return dedupeDefinitionCandidates(candidates);
    },
    [
      backendContext,
      codeIndex,
      content,
      fetchFile,
      filePath,
      findDefinitionLineForPattern,
      getAnalyzedSymbolsForFile,
      getWorkspaceFileContent,
      language,
      semanticQueryService,
      workspaceFilePaths,
    ]
  );

  const findReferencesAcrossWorkspace = useCallback(
    async (symbolName: string, includeDeclaration: boolean): Promise<Location[]> => {
      const context = { ...backendContext, includeDeclaration };
      const dedupedReferences = await semanticQueryService.findReferences(
        language,
        symbolName,
        context
      );

      const uniqueReferenceFiles = Array.from(
        new Set(
          dedupedReferences
            .map((location) => location.file)
            .filter((candidatePath) => candidatePath && candidatePath !== filePath)
        )
      );
      await Promise.all(
        uniqueReferenceFiles.map(async (referenceFilePath) => {
          try {
            await ensureMonacoModelForFile(referenceFilePath);
          } catch (error) {
            console.warn('[explorar:xref] reference-model-create-failed', {
              filePath,
              referenceFilePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })
      );

      return dedupedReferences;
    },
    [backendContext, ensureMonacoModelForFile, filePath, language, semanticQueryService]
  );

  const navigateToDefinition = useCallback(
    async (symbolName: string): Promise<boolean> => {
      const candidates = await resolveDefinitionCandidatesAcrossWorkspace(symbolName);
      if (candidates.length > 1) {
        setXrefPanelState(null);
        setDefinitionPanelState({
          symbolName: normalizeSymbolQuery(symbolName),
          candidates,
        });
        return true;
      }

      const definition = candidates[0] ?? null;
      if (!definition) {
        return false;
      }

      if (definition.file === filePath) {
        revealTargetLine(definition.line, content.split('\n'));
        return true;
      }

      onOpenFile?.(definition.file, undefined, definition.line);
      return true;
    },
    [content, filePath, onOpenFile, resolveDefinitionCandidatesAcrossWorkspace, revealTargetLine]
  );

  const jumpToDefinitionCandidate = useCallback(
    (definition: DefinitionCandidate) => {
      setDefinitionPanelState(null);
      if (definition.file === filePath) {
        revealTargetLine(definition.line, content.split('\n'));
        return;
      }
      onOpenFile?.(definition.file, undefined, definition.line);
    },
    [content, filePath, onOpenFile, revealTargetLine]
  );

  const jumpToReference = useCallback(
    (reference: XrefReferenceItem) => {
      setXrefPanelState((currentState) =>
        currentState
          ? {
              ...currentState,
              selectedReferenceKey: reference.key,
            }
          : currentState
      );

      if (reference.file === filePath) {
        revealTargetLine(reference.line, content.split('\n'));
        return;
      }

      onOpenFile?.(reference.file, undefined, reference.line);
    },
    [content, filePath, onOpenFile, revealTargetLine]
  );

  const openReferencesPanelForSymbol = useCallback(
    async (symbolName: string, currentLine?: number): Promise<boolean> => {
      const normalizedSymbol = normalizeSymbolQuery(symbolName);
      if (!normalizedSymbol) {
        return false;
      }

      setXrefPanelState((currentState) => ({
        symbolName: normalizedSymbol,
        references:
          currentState?.symbolName === normalizedSymbol
            ? currentState.references
            : ([] as XrefReferenceItem[]),
        selectedReferenceKey:
          currentState?.symbolName === normalizedSymbol ? currentState.selectedReferenceKey : null,
        isLoading: true,
        error: null,
      }));

      try {
        const references = await findReferencesAcrossWorkspace(normalizedSymbol, true);
        const uniqueFiles = Array.from(
          new Set(references.map((reference) => reference.file).filter(Boolean))
        );
        const fileContents = new Map<string, string>();

        await Promise.all(
          uniqueFiles.map(async (referenceFilePath) => {
            const referenceContent =
              referenceFilePath === filePath
                ? content
                : await getWorkspaceFileContent(referenceFilePath);
            fileContents.set(referenceFilePath, referenceContent);
          })
        );

        const referenceItems = Array.from(
          new Map(
            references.map((reference) => {
              const referenceContent = fileContents.get(reference.file) ?? '';
              const referenceLine = referenceContent.split('\n')[reference.line - 1] ?? '';
              const key = `${reference.file}:${reference.line}:${reference.column}`;

              return [
                key,
                {
                  ...reference,
                  key,
                  preview: referenceLine.trim() || '(empty line)',
                  fileName: getPathBasename(reference.file),
                  directory: getPathDirectory(reference.file),
                },
              ] as const;
            })
          ).values()
        );

        const preferredReference =
          referenceItems.find(
            (reference) =>
              reference.file === filePath && (!currentLine || reference.line === currentLine)
          ) ??
          referenceItems[0] ??
          null;

        setXrefPanelState({
          symbolName: normalizedSymbol,
          references: referenceItems,
          selectedReferenceKey: preferredReference?.key ?? null,
          isLoading: false,
          error: null,
        });

        debugLog('[explorar:xref] panel-opened', {
          currentFilePath: filePath,
          symbolName: normalizedSymbol,
          referenceCount: referenceItems.length,
          selectedReferenceKey: preferredReference?.key ?? null,
        });

        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load references';
        setXrefPanelState({
          symbolName: normalizedSymbol,
          references: [],
          selectedReferenceKey: null,
          isLoading: false,
          error: errorMessage,
        });
        return false;
      }
    },
    [content, filePath, findReferencesAcrossWorkspace, getWorkspaceFileContent]
  );

  const openReferencesPanelAtCursor = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current as {
      getModel?: () => {
        getWordAtPosition: (position: {
          lineNumber: number;
          column: number;
        }) => { word: string } | null;
      } | null;
      getPosition?: () => { lineNumber: number; column: number } | null;
    } | null;

    const model = editor?.getModel?.();
    const position = editor?.getPosition?.();
    if (!model || !position) {
      return false;
    }

    const word = model.getWordAtPosition(position);
    if (!word) {
      return false;
    }

    return openReferencesPanelForSymbol(word.word, position.lineNumber);
  }, [openReferencesPanelForSymbol]);

  const latestEditorActionsRef = useRef({
    navigateToDefinition,
    openReferencesPanelAtCursor,
    openReferencesPanelForSymbol,
  });

  useEffect(() => {
    latestEditorActionsRef.current = {
      navigateToDefinition,
      openReferencesPanelAtCursor,
      openReferencesPanelForSymbol,
    };
  }, [navigateToDefinition, openReferencesPanelAtCursor, openReferencesPanelForSymbol]);

  const selectedXrefReference = useMemo(
    () =>
      xrefPanelState?.references.find(
        (reference) => reference.key === xrefPanelState.selectedReferenceKey
      ) ??
      xrefPanelState?.references[0] ??
      null,
    [xrefPanelState]
  );

  const groupedXrefReferences = useMemo(() => {
    if (!xrefPanelState) {
      return [];
    }

    const groupedReferences = new Map<
      string,
      {
        file: string;
        fileName: string;
        directory: string;
        references: XrefReferenceItem[];
      }
    >();

    for (const reference of xrefPanelState.references) {
      const existingGroup = groupedReferences.get(reference.file);
      if (existingGroup) {
        existingGroup.references.push(reference);
        continue;
      }

      groupedReferences.set(reference.file, {
        file: reference.file,
        fileName: reference.fileName,
        directory: reference.directory,
        references: [reference],
      });
    }

    return Array.from(groupedReferences.values());
  }, [xrefPanelState]);

  const syncMonacoTestApi = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const targetWindow = window as Window & {
      __explorarTestApi?: MonacoTestApi;
    };

    targetWindow.__explorarTestApi = {
      getActiveFilePath: () => filePath,
      focusSymbol: async (symbol: string) => {
        const editor = editorRef.current as {
          getModel?: () => {
            getValue: () => string;
          } | null;
          setPosition?: (position: { lineNumber: number; column: number }) => void;
          revealLineInCenter?: (lineNumber: number) => void;
          focus?: () => void;
        } | null;

        const model = editor?.getModel?.();
        const contentValue = model?.getValue();
        if (
          !editor ||
          !model ||
          !contentValue ||
          !editor.setPosition ||
          !editor.revealLineInCenter
        ) {
          return false;
        }

        const lines = contentValue.split('\n');
        const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const symbolPattern = new RegExp(`\\b${escapedSymbol}\\b`, 'g');

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          let match: RegExpExecArray | null;

          while ((match = symbolPattern.exec(line)) !== null) {
            const lineNumber = index + 1;
            const column = match.index + 1 + Math.floor(symbol.length / 2);
            editor.revealLineInCenter(lineNumber);
            editor.setPosition({ lineNumber, column });
            editor.focus?.();
            testFocusedSymbolRef.current = { filePath, symbol, lineNumber };
            return true;
          }
        }

        return false;
      },
      showReferencesAtCursor: async () => {
        const focusedSymbol = testFocusedSymbolRef.current;
        if (focusedSymbol?.filePath === filePath) {
          return openReferencesPanelForSymbol(focusedSymbol.symbol, focusedSymbol.lineNumber);
        }

        return openReferencesPanelAtCursor();
      },
      closeReferencesWidget: async () => {
        if (!xrefPanelState) {
          return false;
        }
        setXrefPanelState(null);
        return true;
      },
      goToDefinitionAtCursor: async () => {
        const editor = editorRef.current as {
          getModel?: () => {
            getWordAtPosition: (position: {
              lineNumber: number;
              column: number;
            }) => { word: string } | null;
          } | null;
          getPosition?: () => { lineNumber: number; column: number } | null;
        } | null;

        const model = editor?.getModel?.();
        const position = editor?.getPosition?.();
        const word = model?.getWordAtPosition(position ?? { lineNumber: 1, column: 1 });
        const focusedSymbol = testFocusedSymbolRef.current;
        const symbolName = focusedSymbol?.filePath === filePath ? focusedSymbol.symbol : word?.word;
        if (!symbolName) {
          return false;
        }

        return navigateToDefinition(symbolName);
      },
    };
  }, [
    filePath,
    navigateToDefinition,
    openReferencesPanelAtCursor,
    openReferencesPanelForSymbol,
    xrefPanelState,
  ]);

  // Keep the live Monaco model synchronized with async-loaded content.
  // The React wrapper does not reliably repaint in this app when content
  // arrives after mount for an already-open model.
  useEffect(() => {
    const editor = editorRef.current as MonacoEditorLike | null;
    const model = editor?.getModel();
    if (!model) {
      if (content) {
        debugLog('[explorar:monaco] sync-skipped-no-model', {
          filePath,
          contentLength: content.length,
        });
      }
      return;
    }

    if (contentFilePath && contentFilePath !== filePath) {
      debugLog('[explorar:monaco] sync-skipped-stale-content', {
        filePath,
        contentFilePath,
        contentLength: content.length,
      });
      return;
    }

    const existingValue = model.getValue();
    if (existingValue !== content) {
      debugLog('[explorar:monaco] model-sync', {
        filePath,
        previousLength: existingValue.length,
        nextLength: content.length,
        preview: content.slice(0, 80),
      });
      model.setValue(content);
    } else {
      debugLog('[explorar:monaco] model-already-synced', {
        filePath,
        contentLength: content.length,
      });
    }
  }, [content, contentFilePath, filePath]);

  useEffect(() => {
    syncMonacoTestApi();
  }, [syncMonacoTestApi]);

  useEffect(
    () => () => {
      if (typeof window !== 'undefined') {
        const targetWindow = window as Window & {
          __explorarTestApi?: MonacoTestApi;
        };
        delete targetWindow.__explorarTestApi;
      }
    },
    []
  );

  const isLicenseHeaderComment = useCallback((commentText: string, isXnuFile: boolean): boolean => {
    const normalized = commentText.toLowerCase();

    const genericLicenseMarkers = [
      'license',
      'copyright',
      'spdx-license-identifier',
      'permission is hereby granted',
      'all rights reserved',
    ];

    if (genericLicenseMarkers.some((marker) => normalized.includes(marker))) {
      return true;
    }

    if (!isXnuFile) {
      return false;
    }

    const xnuSpecificMarkers = [
      '@apple_osreference_license_header_start@',
      '@apple_osreference_license_header_end@',
      '@osf_copyright@',
      'apple public source license',
      'original code and/or modifications of original code',
      'carnegie mellon university',
      'the regents of the university of california',
      'notice: this file was modified by sparta',
      'notice: this file was modified by mcafee research',
      'support for mandatory and extensible security protections',
      'mach operating system',
    ];

    return xnuSpecificMarkers.some((marker) => normalized.includes(marker));
  }, []);

  const getAutoFoldRanges = useCallback((): Array<{
    start: number;
    end: number;
    kind?: string;
    isLicenseHeader?: boolean;
  }> => {
    if (!content) {
      return [];
    }

    const fileName = filePath.toLowerCase();
    const isXnuFile =
      fileName.startsWith('osfmk/') ||
      fileName.startsWith('bsd/') ||
      fileName.startsWith('libkern/') ||
      fileName.startsWith('libsa/') ||
      fileName.startsWith('libsyscall/') ||
      fileName.startsWith('security/') ||
      fileName.startsWith('pexpert/') ||
      fileName.startsWith('iokit/') ||
      fileName.startsWith('san/') ||
      fileName.startsWith('tests/');
    const isCLike =
      language === 'c' ||
      language === 'cpp' ||
      fileName.endsWith('.h') ||
      fileName.endsWith('.hpp') ||
      fileName.endsWith('.hh') ||
      fileName.endsWith('.hxx') ||
      fileName.endsWith('.S');

    const lines = content.split('\n');
    const ranges: Array<{ start: number; end: number; kind?: string; isLicenseHeader?: boolean }> =
      [];

    let current = 0;
    while (current < lines.length && lines[current].trim() === '') {
      current++;
    }

    const firstCodeLine = current + 1;

    if (current < lines.length) {
      let headerStart = -1;
      let headerEnd = -1;
      let scan = current;

      while (scan < lines.length) {
        while (scan < lines.length && lines[scan].trim() === '') {
          scan++;
        }
        if (scan >= lines.length) {
          break;
        }

        const first = lines[scan].trim();
        if (!first.startsWith('/*') && !first.startsWith('/**')) {
          break;
        }

        let commentEnd = scan;
        if (!first.includes('*/')) {
          for (let i = scan + 1; i < lines.length; i++) {
            commentEnd = i;
            if (lines[i].includes('*/')) {
              break;
            }
          }
        }

        const commentText = lines.slice(scan, commentEnd + 1).join('\n');
        if (!isLicenseHeaderComment(commentText, isXnuFile)) {
          break;
        }

        if (headerStart === -1) {
          headerStart = scan;
        }
        headerEnd = commentEnd;
        scan = commentEnd + 1;
      }

      if (headerStart !== -1 && headerEnd > headerStart) {
        ranges.push({
          start: headerStart + 1,
          end: headerEnd + 1,
          kind: 'comment',
          isLicenseHeader: true,
        });
      }
    }

    if (isCLike) {
      let includeStart = -1;
      let includeEnd = -1;
      let inTopBlock = true;

      for (let i = firstCodeLine - 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === '') {
          if (includeStart !== -1) {
            break;
          }
          continue;
        }

        if (trimmed.startsWith('#pragma once') || trimmed.startsWith('#pragma')) {
          if (includeStart !== -1) {
            includeEnd = i + 1;
            continue;
          }
          continue;
        }

        if (trimmed.startsWith('#include')) {
          if (includeStart === -1) {
            includeStart = i + 1;
          }
          includeEnd = i + 1;
          continue;
        }

        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          if (includeStart !== -1) {
            break;
          }
          continue;
        }

        if (inTopBlock && includeStart !== -1) {
          break;
        }

        inTopBlock = false;
      }

      if (includeStart !== -1 && includeEnd > includeStart) {
        ranges.push({ start: includeStart, end: includeEnd, kind: 'imports' });
      }
    }

    return ranges;
  }, [content, filePath, isLicenseHeaderComment, language]);

  // Force Monaco to relayout whenever its flex container changes size.
  useEffect(() => {
    const layoutEditor = () => {
      if (!containerRef.current || !editorRef.current) return;

      const { clientWidth, clientHeight } = containerRef.current;
      if (clientWidth === 0 || clientHeight === 0) return;

      type LayoutableEditor = {
        layout: (dimension?: { width: number; height: number }) => void;
      };

      (editorRef.current as LayoutableEditor).layout({
        width: clientWidth,
        height: clientHeight,
      });
    };

    const timeoutId = window.setTimeout(layoutEditor, 0);
    const animationFrameId = window.requestAnimationFrame(layoutEditor);
    const resizeObserver = new ResizeObserver(layoutEditor);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', layoutEditor);

    return () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', layoutEditor);
    };
  }, []);

  // Extract symbols from content when it changes
  useEffect(() => {
    if (content && filePath && isIndexableSourceFile(filePath)) {
      const parsedSymbols = findSymbolsInFile(content, filePath);
      symbolsRef.current = parsedSymbols;
      const cacheKey = buildWorkspaceCacheKey(workspaceId, filePath);
      workspaceContentsCache.set(cacheKey, content);
      workspaceSymbolsCache.set(cacheKey, parsedSymbols);
    } else {
      symbolsRef.current = [];
    }
  }, [content, filePath, workspaceId]);

  // Search for pattern and scroll to it
  useEffect(() => {
    if (hasMountedEditor && editorRef.current && searchPattern && content) {
      setTimeout(() => {
        const lines = content.split('\n');
        const targetLine = findDefinitionLineForPattern(searchPattern, lines);
        debugLog('[explorar:monaco-jump] resolve-search-pattern', {
          filePath,
          searchPattern,
          targetLine,
          symbolCount: symbolsRef.current.length,
          fallbackScrollToLine: scrollToLine,
        });

        if (targetLine !== -1) {
          revealTargetLine(targetLine, lines);
        } else if (scrollToLine) {
          revealTargetLine(scrollToLine, lines);
        }
      }, 200);
    }
  }, [
    searchPattern,
    content,
    scrollToLine,
    navigationNonce,
    filePath,
    hasMountedEditor,
    findDefinitionLineForPattern,
    revealTargetLine,
  ]);

  // Scroll to specific line when scrollToLine changes (fallback)
  useEffect(() => {
    if (hasMountedEditor && editorRef.current && scrollToLine && content && !searchPattern) {
      setTimeout(() => {
        debugLog('[explorar:monaco-jump] direct-line', {
          filePath,
          scrollToLine,
        });
        revealTargetLine(scrollToLine, content.split('\n'));
      }, 200);
    }
  }, [
    scrollToLine,
    content,
    searchPattern,
    filePath,
    navigationNonce,
    hasMountedEditor,
    revealTargetLine,
  ]);

  // Reset scroll position to top when file path changes (unless we have scrollToLine or searchPattern)
  useEffect(() => {
    if (editorRef.current && filePath && content && !scrollToLine && !searchPattern) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = editorRef.current as any;
      setTimeout(() => {
        editor.revealLineInCenter(1);
        editor.setPosition({ lineNumber: 1, column: 1 });
      }, 100);
    }
  }, [filePath, content, scrollToLine, searchPattern]);

  // Note: onContentLoad is handled by CodeEditorContainer, not here

  const handleEditorDidMount = useCallback(
    async (editor: unknown, monaco: unknown) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      setHasMountedEditor(true);
      syncMonacoTestApi();
      debugLog('[explorar:monaco] mount', {
        filePath,
        language,
        contentLength: content.length,
      });

      // Configure Monaco Editor to use local workers
      configureMonacoWorkers();
      configureMonacoThemes(monaco as MonacoThemeApi);
      const activeMonacoTheme = getMonacoThemeName(editorTheme);

      // Configure editor options
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor as any).updateOptions({
        fontSize: 14,
        fontFamily:
          "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Consolas, monospace",
        lineNumbers: 'on',
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        readOnly: true, // Read-only for now since we're just viewing
        automaticLayout: true,
        theme: activeMonacoTheme,
        renderWhitespace: 'selection',
        showFoldingControls: 'always',
        folding: true,
        foldingStrategy: 'indentation',
        matchBrackets: 'always',
        renderLineHighlight: 'line',
        selectOnLineNumbers: true,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        find: {
          addExtraSpaceOnTop: false,
          autoFindInSelection: 'never',
          seedSearchStringFromSelection: 'always',
        },
      });

      (monaco as MonacoThemeApi).editor?.setTheme?.(activeMonacoTheme);

      // Track cursor position changes for status bar
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor as any).onDidChangeCursorPosition((e: any) => {
        if (onCursorChange) {
          onCursorChange(e.position.lineNumber, e.position.column);
        }
      });

      // Initialize cursor position
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const position = (editor as any).getPosition();
      if (position && onCursorChange) {
        onCursorChange(position.lineNumber, position.column);
      }

      // Add keyboard shortcuts
      // Monaco Editor types are not fully exposed via @monaco-editor/react
      // Using type assertions for Monaco's internal API
      type MonacoEditor = typeof editor & {
        addCommand: (keybinding: number, handler: () => void) => string | null;
        addAction: (descriptor: {
          id: string;
          label: string;
          run: (_editor: unknown, symbolName?: string, symbolLine?: number) => Promise<void> | void;
        }) => void;
        getAction: (actionId: string) => { run: () => Promise<void> } | null;
      };
      type MonacoInstance = typeof monaco & {
        KeyMod: { CtrlCmd: number; Shift: number };
        KeyCode: { KeyF: number };
      };

      (editor as MonacoEditor).addCommand(
        ((monaco as MonacoInstance).KeyMod.CtrlCmd |
          (monaco as MonacoInstance).KeyCode.KeyF) as number,
        () => {
          (editor as MonacoEditor).getAction('actions.find')?.run();
        }
      );

      (editor as MonacoEditor).addAction({
        id: 'explorar.showReferences',
        label: 'Show References',
        run: async (_activeEditor, symbolName?: string, symbolLine?: number) => {
          if (symbolName) {
            await latestEditorActionsRef.current.openReferencesPanelForSymbol(
              symbolName,
              symbolLine
            );
            return;
          }

          await latestEditorActionsRef.current.openReferencesPanelAtCursor();
        },
      });

      (editor as MonacoEditor).addCommand(
        ((monaco as MonacoInstance).KeyMod.CtrlCmd |
          (monaco as MonacoInstance).KeyMod.Shift |
          (monaco as MonacoInstance).KeyCode.KeyF) as number,
        () => {
          (editor as MonacoEditor).getAction('editor.action.startFindReplaceAction')?.run();
        }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor as any).addCommand((monaco as any).KeyCode.F3, () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (editor as any).getAction('editor.action.nextMatchFindAction')?.run();
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor as any).addCommand((monaco as any).KeyMod.Shift | (monaco as any).KeyCode.F3, () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (editor as any).getAction('editor.action.previousMatchFindAction')?.run();
      });

      // Add Shift+F12 for Find All References
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor as any).addCommand((monaco as any).KeyMod.Shift | (monaco as any).KeyCode.F12, () => {
        void latestEditorActionsRef.current.openReferencesPanelAtCursor();
      });

      // Override F12 with app-aware cross-file navigation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor as any).addCommand((monaco as any).KeyCode.F12, () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = (editor as any).getModel();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const position = (editor as any).getPosition();
        if (!model || !position) {
          return;
        }

        const word = model.getWordAtPosition(position);
        if (!word) {
          return;
        }

        void latestEditorActionsRef.current.navigateToDefinition(word.word);
      });

      // Add Ctrl+Click to go to definition
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor as any).onMouseDown((e: any) => {
        if (e.event.ctrlKey || e.event.metaKey) {
          const position = e.target.position;
          if (!position) return;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const model = (editor as any).getModel();
          const word = model.getWordAtPosition(position);
          if (!word) return;

          e.event.preventDefault();
          void latestEditorActionsRef.current.navigateToDefinition(word.word);
        }
      });

      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;
        (editor as { layout: (dimension?: { width: number; height: number }) => void }).layout({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      });
    },
    [content, editorTheme, filePath, language, onCursorChange, syncMonacoTestApi]
  );

  useEffect(() => {
    const monaco = monacoRef.current as MonacoThemeApi | null;
    if (!monaco) return;
    configureMonacoThemes(monaco);
    monaco.editor?.setTheme?.(getMonacoThemeName(editorTheme));
  }, [editorTheme]);

  useEffect(() => {
    if (!hasMountedEditor || !monacoRef.current) {
      return;
    }

    let disposed = false;

    const monaco = monacoRef.current as {
      editor: {
        registerCommand: (
          id: string,
          handler: (accessor: unknown, ...args: unknown[]) => void
        ) => { dispose: () => void };
      };
      languages: MonacoLanguageApi & {
        SymbolKind: Record<string, number>;
        registerHoverProvider: (
          languageSelector: string,
          provider: Record<string, unknown>
        ) => { dispose: () => void };
        registerReferenceProvider: (
          languageSelector: string,
          provider: Record<string, unknown>
        ) => { dispose: () => void };
        registerDefinitionProvider: (
          languageSelector: string,
          provider: Record<string, unknown>
        ) => { dispose: () => void };
        registerCodeLensProvider: (
          languageSelector: string,
          provider: Record<string, unknown>
        ) => { dispose: () => void };
        registerDocumentSymbolProvider: (
          languageSelector: string,
          provider: Record<string, unknown>
        ) => { dispose: () => void };
        registerCallHierarchyProvider?: (
          languageSelector: string,
          provider: Record<string, unknown>
        ) => { dispose: () => void };
      };
      MarkerSeverity: { Error: number; Warning: number; Info: number };
      Range: new (
        startLineNumber: number,
        startColumn: number,
        endLineNumber: number,
        endColumn: number
      ) => unknown;
      Uri: { parse: (value: string) => unknown };
    };

    type MonacoPosition = { lineNumber: number; column: number };
    type MonacoWord = {
      word: string;
      startColumn: number;
      endColumn: number;
    };
    type MonacoModelLike = {
      getWordAtPosition: (position: MonacoPosition) => MonacoWord | null;
      getLineMaxColumn?: (lineNumber: number) => number;
      uri: unknown;
    };

    disposeRegisteredProviders();

    const registerLSPProviders = (lang: string) => {
      providerDisposablesRef.current.push(
        monaco.languages.registerHoverProvider(lang, {
          provideHover: async (model: MonacoModelLike, position: MonacoPosition) => {
            const word = model.getWordAtPosition(position);
            if (!word) return null;

            const symbolName = word.word;
            const hover = await semanticQueryService.getHover(language, symbolName, {
              ...backendContext,
              position: { line: position.lineNumber, column: position.column },
            });
            if (hover) {
              return {
                range: new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn
                ),
                contents: hover.markdown.map((value) => ({ value })),
              };
            }

            const localMarkdown = buildLocalSymbolHoverMarkdown(symbolName, symbolsRef.current);
            if (localMarkdown.length > 0) {
              return {
                range: new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn
                ),
                contents: localMarkdown.map((value) => ({ value })),
              };
            }

            return null;
          },
        })
      );

      providerDisposablesRef.current.push(
        monaco.languages.registerReferenceProvider(lang, {
          provideReferences: async (
            model: {
              getWordAtPosition: (position: {
                lineNumber: number;
                column: number;
              }) => { word: string } | null;
              uri: unknown;
            },
            position: { lineNumber: number; column: number },
            context: { includeDeclaration?: boolean }
          ) => {
            const word = model.getWordAtPosition(position);
            if (!word) return [];

            const symbolName = word.word;
            try {
              const references = await findReferencesAcrossWorkspace(
                symbolName,
                Boolean(context?.includeDeclaration)
              );
              const providerReferences = await Promise.all(
                references.map(async (ref) => {
                  const uri =
                    ref.file === filePath ? model.uri : await ensureMonacoModelForFile(ref.file);
                  if (!uri) {
                    return null;
                  }

                  return {
                    uri,
                    range: new monaco.Range(
                      ref.line,
                      ref.column,
                      ref.line,
                      ref.column + symbolName.length
                    ),
                  };
                })
              );

              debugLog('[explorar:xref] provide-references', {
                filePath,
                symbolName,
                includeDeclaration: Boolean(context?.includeDeclaration),
                referenceCount: references.length,
                sampleReferences: references.slice(0, 5),
              });

              return providerReferences.filter((ref): ref is NonNullable<typeof ref> => !!ref);
            } catch (error) {
              console.error('[explorar:xref] provide-references-failed', {
                filePath,
                symbolName,
                includeDeclaration: Boolean(context?.includeDeclaration),
                error: error instanceof Error ? error.message : String(error),
              });

              const fallbackReferences = findAllReferences(symbolName, symbolsRef.current);
              return fallbackReferences.map((ref) => ({
                uri: model.uri,
                range: new monaco.Range(
                  ref.line,
                  ref.column,
                  ref.line,
                  ref.column + symbolName.length
                ),
              }));
            }
          },
        })
      );

      providerDisposablesRef.current.push(
        monaco.languages.registerDefinitionProvider(lang, {
          provideDefinition: async (model: MonacoModelLike, position: MonacoPosition) => {
            const word = model.getWordAtPosition(position);
            if (!word) return [];

            try {
              const symbolName = word.word;
              const definitions = await resolveDefinitionCandidatesAcrossWorkspace(symbolName);
              if (definitions.length === 0) {
                return [];
              }

              const locations = await Promise.all(
                definitions.map(async (definition) => {
                  const uri =
                    definition.file === filePath
                      ? model.uri
                      : await ensureMonacoModelForFile(definition.file);
                  if (!uri) {
                    return null;
                  }
                  return {
                    uri,
                    range: new monaco.Range(
                      definition.line,
                      definition.column,
                      definition.line,
                      definition.column + definition.name.length
                    ),
                  };
                })
              );
              return locations.filter((location): location is NonNullable<typeof location> =>
                Boolean(location)
              );
            } catch (error) {
              console.warn('[explorar:xref] provide-definition-failed', {
                filePath,
                error: error instanceof Error ? error.message : String(error),
              });
              return [];
            }
          },
        })
      );

      providerDisposablesRef.current.push(
        monaco.languages.registerCodeLensProvider(lang, {
          provideCodeLenses: (_model: MonacoModelLike) => {
            const lenses: Array<{
              range: unknown;
              id: string;
              command: undefined;
            }> = [];

            for (const symbol of symbolsRef.current) {
              if (!symbol.isDefinition) {
                continue;
              }

              const normalizedSymbol = normalizeSymbolQuery(symbol.name);
              const referenceCacheKey = `${workspaceId}:${normalizedSymbol}:refs-only`;
              const cachedWorkspaceReferences = workspaceReferencesCache.get(referenceCacheKey);
              const cachedCount = codeLensReferenceCountCacheRef.current.get(referenceCacheKey);
              const refCount =
                cachedWorkspaceReferences?.length ?? cachedCount ?? symbol.references.length;

              if (cachedWorkspaceReferences) {
                codeLensReferenceCountCacheRef.current.set(
                  referenceCacheKey,
                  cachedWorkspaceReferences.length
                );
              }

              if (refCount > 0) {
                lenses.push({
                  range: new monaco.Range(symbol.line, 1, symbol.line, 1),
                  id: `lens-${symbol.name}-${symbol.line}`,
                  command: undefined,
                });
              }
            }

            debugLog('[explorar:xref] provide-code-lenses', {
              filePath,
              lensCount: lenses.length,
              symbolCount: symbolsRef.current.length,
              scanStrategy: 'cached-only',
            });

            return {
              lenses,
              dispose: () => {},
            };
          },
          resolveCodeLens: async (
            model: MonacoModelLike,
            codeLens: { id: string; command?: { id: string; title: string; arguments?: unknown[] } }
          ) => {
            const symbolName = codeLens.id.replace(/^lens-/, '').replace(/-\d+$/, '');
            const symbol = symbolsRef.current.find((s) => s.name === symbolName && s.isDefinition);
            if (!symbol) {
              return codeLens;
            }

            const references = await findReferencesAcrossWorkspace(symbol.name, false);
            codeLensReferenceCountCacheRef.current.set(
              `${workspaceId}:${normalizeSymbolQuery(symbol.name)}:refs-only`,
              references.length
            );
            debugLog('[explorar:xref] resolve-code-lens', {
              filePath,
              symbolName: symbol.name,
              symbolLine: symbol.line,
              referenceCount: references.length,
              sampleLocations: references.slice(0, 5),
            });

            codeLens.command = {
              id: 'explorar.showReferences',
              title: `${references.length} reference${references.length !== 1 ? 's' : ''}`,
              arguments: [symbol.name, symbol.line],
            };

            return codeLens;
          },
        })
      );

      providerDisposablesRef.current.push(
        monaco.languages.registerDocumentSymbolProvider(lang, {
          provideDocumentSymbols: async () => {
            const backendSymbols = await semanticQueryService.getDocumentSymbols(
              language,
              backendContext
            );
            const symbols = backendSymbols.length > 0 ? backendSymbols : symbolsRef.current;

            return symbols
              .filter((symbol) => symbol.line > 0)
              .map((symbol) => {
                const symbolKind =
                  monaco.languages.SymbolKind[
                    symbol.type === 'function'
                      ? 'Function'
                      : symbol.type === 'class'
                        ? 'Class'
                        : symbol.type === 'struct'
                          ? 'Struct'
                          : symbol.type === 'variable'
                            ? 'Variable'
                            : 'Object'
                  ] ?? monaco.languages.SymbolKind.Object;
                return {
                  name: symbol.name,
                  detail: symbol.signature ?? symbol.type,
                  kind: symbolKind,
                  range: new monaco.Range(symbol.line, 1, symbol.line, Number.MAX_SAFE_INTEGER),
                  selectionRange: new monaco.Range(
                    symbol.line,
                    Math.max(1, symbol.column),
                    symbol.line,
                    Math.max(1, symbol.column) + symbol.name.length
                  ),
                };
              });
          },
        })
      );

      const registerCallHierarchyProvider = monaco.languages.registerCallHierarchyProvider;
      if (registerCallHierarchyProvider) {
        providerDisposablesRef.current.push(
          registerCallHierarchyProvider(lang, {
            prepareCallHierarchy: (model: MonacoModelLike, position: MonacoPosition) => {
              const word = model.getWordAtPosition(position);
              if (!word) return null;
              const range = new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn
              );
              return {
                name: word.word,
                detail: filePath,
                kind: monaco.languages.SymbolKind.Function,
                uri: model.uri,
                range,
                selectionRange: range,
                data: { filePath, symbolName: word.word },
              };
            },
            provideIncomingCalls: async (item: {
              data?: { filePath?: string; symbolName?: string };
            }) => {
              const relationships = await semanticQueryService.getRelationships(
                language,
                backendContext
              );
              const calls = relationships.filter(
                (relationship) =>
                  relationship.kind === 'call' &&
                  relationship.direction === 'incoming' &&
                  (!item.data?.symbolName ||
                    relationship.symbols.length === 0 ||
                    relationship.symbols.includes(item.data.symbolName))
              );
              return Promise.all(
                calls.map(async (call) => {
                  const uri = await ensureMonacoModelForFile(call.sourcePath);
                  const range = new monaco.Range(1, 1, 1, 1);
                  return {
                    from: {
                      name: call.symbols[0] ?? getPathBasename(call.sourcePath),
                      detail: call.sourcePath,
                      kind: monaco.languages.SymbolKind.Function,
                      uri,
                      range,
                      selectionRange: range,
                      data: { filePath: call.sourcePath, symbolName: call.symbols[0] },
                    },
                    fromRanges: [range],
                  };
                })
              );
            },
            provideOutgoingCalls: async (item: {
              data?: { filePath?: string; symbolName?: string };
            }) => {
              const relationships = await semanticQueryService.getRelationships(
                language,
                backendContext
              );
              const calls = relationships.filter(
                (relationship) =>
                  relationship.kind === 'call' &&
                  relationship.direction === 'outgoing' &&
                  (!item.data?.symbolName ||
                    relationship.symbols.length === 0 ||
                    relationship.symbols.includes(item.data.symbolName))
              );
              return Promise.all(
                calls.map(async (call) => {
                  const uri = await ensureMonacoModelForFile(call.targetPath);
                  const range = new monaco.Range(1, 1, 1, 1);
                  return {
                    to: {
                      name: call.symbols[0] ?? getPathBasename(call.targetPath),
                      detail: call.targetPath,
                      kind: monaco.languages.SymbolKind.Function,
                      uri,
                      range,
                      selectionRange: range,
                      data: { filePath: call.targetPath, symbolName: call.symbols[0] },
                    },
                    fromRanges: [range],
                  };
                })
              );
            },
          })
        );
      }
    };

    providerDisposablesRef.current.push(
      monaco.editor.registerCommand('explorar.showReferences', async (_accessor, ...args) => {
        const [symbolName, symbolLine] = args as [string | undefined, number | undefined];
        if (symbolName) {
          await latestEditorActionsRef.current.openReferencesPanelForSymbol(symbolName, symbolLine);
          return;
        }

        await latestEditorActionsRef.current.openReferencesPanelAtCursor();
      })
    );

    if (semanticQueryService.getBackends(language).length > 0) {
      registerLSPProviders(language);

      const model = (editorRef.current as MonacoEditorLike | null)?.getModel();
      if (model) {
        void semanticQueryService
          .getDiagnostics(language, backendContext)
          .then((diagnostics) => {
            if (disposed || (editorRef.current as MonacoEditorLike | null)?.getModel() !== model) {
              return;
            }
            const editorApi = monaco.editor as typeof monaco.editor & {
              setModelMarkers: (model: unknown, owner: string, markers: unknown[]) => void;
            };
            editorApi.setModelMarkers(
              model,
              'gitshaman-semantic',
              diagnostics.map((diagnostic) => ({
                severity:
                  diagnostic.severity === 'error'
                    ? monaco.MarkerSeverity.Error
                    : diagnostic.severity === 'warning'
                      ? monaco.MarkerSeverity.Warning
                      : monaco.MarkerSeverity.Info,
                message: diagnostic.message,
                startLineNumber: diagnostic.line,
                startColumn: diagnostic.column,
                endLineNumber: diagnostic.line,
                endColumn: diagnostic.column + 1,
              }))
            );
          })
          .catch((error) => {
            debugLog('[explorar:semantic] diagnostics-error', {
              filePath,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }
    }

    const foldingRanges = getAutoFoldRanges();
    if (foldingRanges.length > 0) {
      const monacoLanguages = monaco.languages;
      providerDisposablesRef.current.push(
        monacoLanguages.registerFoldingRangeProvider(language, {
          provideFoldingRanges: () =>
            foldingRanges.map((range) => ({
              start: range.start,
              end: range.end,
              kind:
                range.kind === 'comment'
                  ? monacoLanguages.FoldingRangeKind.Comment
                  : monacoLanguages.FoldingRangeKind.Imports,
            })),
        })
      );

      const licenseHeader = foldingRanges.find((range) => range.isLicenseHeader);
      if (licenseHeader) {
        requestAnimationFrame(() => {
          const foldAction = (editorRef.current as MonacoEditorLike)?.getAction('editor.fold');
          void foldAction?.run();
        });
      }
    }

    return () => {
      disposed = true;
      disposeRegisteredProviders();
    };
  }, [
    backendContext,
    content,
    disposeRegisteredProviders,
    ensureMonacoModelForFile,
    filePath,
    findReferencesAcrossWorkspace,
    getAutoFoldRanges,
    hasMountedEditor,
    language,
    resolveDefinitionCandidatesAcrossWorkspace,
    semanticQueryService,
    workspaceFilePaths,
    workspaceId,
  ]);

  if (isLoading && !content && !hasMountedEditor) {
    return (
      <div className="vscode-editor">
        <div className="vscode-loading">
          <div className="vscode-spinner" />
          <div>Loading {filePath}...</div>
        </div>
      </div>
    );
  }

  if (!content && !isLoading) {
    return (
      <div className="vscode-editor">
        <div className="vscode-empty-state">
          <div className="vscode-empty-icon">📄</div>
          <div>No file selected</div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>
            Select a file from the explorer to view its contents
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vscode-editor">
      {/* Monaco Editor */}
      <div
        ref={containerRef}
        className="explorar-editor-shell"
        style={{
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Editor
          path={filePath}
          height="100%"
          width="100%"
          language={language}
          value={content}
          theme={getMonacoThemeName(editorTheme)}
          saveViewState={false}
          onMount={handleEditorDidMount}
          options={{
            readOnly: true,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            minimap: { enabled: true },
            fontSize: 14,
            fontFamily:
              "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Consolas, monospace",
            lineNumbers: 'on',
            wordWrap: 'off',
            renderWhitespace: 'selection',
            showFoldingControls: 'always',
            folding: true,
            matchBrackets: 'always',
            renderLineHighlight: 'line',
            selectOnLineNumbers: true,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            hover: {
              enabled: true,
              delay: 250,
              sticky: true,
            },
          }}
        />
        {xrefPanelState && (
          <aside className="explorar-xref-panel" aria-label="Cross references">
            <div className="explorar-xref-panel-header">
              <div className="explorar-xref-panel-title-wrap">
                <div className="explorar-xref-panel-label">Cross References</div>
                <div className="explorar-xref-panel-title">
                  {xrefPanelState.symbolName}
                  {!xrefPanelState.isLoading && (
                    <span className="explorar-xref-panel-count">
                      {xrefPanelState.references.length}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="explorar-xref-panel-close"
                aria-label="Close cross references"
                onClick={() => setXrefPanelState(null)}
              >
                ✕
              </button>
            </div>
            <div className="explorar-xref-panel-subtitle">
              {selectedXrefReference
                ? `${selectedXrefReference.fileName}:${selectedXrefReference.line}`
                : 'Select a reference to jump.'}
            </div>
            <div className="explorar-xref-panel-body">
              {xrefPanelState.isLoading ? (
                <div className="explorar-xref-panel-empty">Loading references…</div>
              ) : xrefPanelState.error ? (
                <div className="explorar-xref-panel-empty">{xrefPanelState.error}</div>
              ) : xrefPanelState.references.length === 0 ? (
                <div className="explorar-xref-panel-empty">No references found.</div>
              ) : (
                groupedXrefReferences.map((group) => (
                  <section key={group.file} className="explorar-xref-group">
                    <header className="explorar-xref-group-header">
                      <div className="explorar-xref-group-file">{group.fileName}</div>
                      <div className="explorar-xref-group-dir">{group.directory || 'root'}</div>
                    </header>
                    <div className="explorar-xref-group-list">
                      {group.references.map((reference) => (
                        <button
                          key={reference.key}
                          type="button"
                          className={`explorar-xref-row${
                            reference.key === selectedXrefReference?.key ? ' is-selected' : ''
                          }`}
                          // eslint-disable-next-line react-hooks/refs -- click handler runs after render.
                          onClick={() => jumpToReference(reference)}
                        >
                          <span className="explorar-xref-row-line">L{reference.line}</span>
                          <span className="explorar-xref-row-preview">{reference.preview}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          </aside>
        )}
        {definitionPanelState && (
          <aside className="explorar-xref-panel" aria-label="Definition candidates">
            <div className="explorar-xref-panel-header">
              <div className="explorar-xref-panel-title-wrap">
                <div className="explorar-xref-panel-label">Definitions</div>
                <div className="explorar-xref-panel-title">
                  {definitionPanelState.symbolName}
                  <span className="explorar-xref-panel-count">
                    {definitionPanelState.candidates.length}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="explorar-xref-panel-close"
                aria-label="Close definition candidates"
                onClick={() => setDefinitionPanelState(null)}
              >
                ✕
              </button>
            </div>
            <div className="explorar-xref-panel-subtitle">
              Choose the macro, inline helper, or symbol definition to open.
            </div>
            <div className="explorar-xref-panel-body">
              <div className="explorar-xref-group-list">
                {definitionPanelState.candidates.map((candidate) => {
                  const key = `${candidate.file}:${candidate.line}:${candidate.column}:${candidate.reason}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="explorar-xref-row"
                      onClick={() => jumpToDefinitionCandidate(candidate)}
                    >
                      <span className="explorar-xref-row-line">L{candidate.line}</span>
                      <span className="explorar-xref-row-preview">
                        <strong>{candidate.type}</strong> {candidate.signature ?? candidate.name}
                        <span className="explorar-xref-row-meta">
                          {candidate.file} · {candidate.reason} · {candidate.confidence}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default MonacoCodeEditor;
