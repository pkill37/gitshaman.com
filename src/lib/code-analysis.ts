/**
 * Static code analysis: symbol extraction.
 * All analysis is heuristic / regex-based — no AST required.
 */

export interface FileSymbols {
  filePath: string;
  language: string;
  functions: string[]; // defined function / method names
  types: string[]; // struct / class / interface / type names
  defines: string[]; // #define macros / constants
  globals: string[]; // global / module-level variables
  rawIncludes: string[]; // verbatim #include paths
  rawImports: string[]; // verbatim import paths
}

function createUniquePusher(): (set: string[], val: string) => void {
  const seen = new Set<string>();
  return (set, val) => {
    if (val && !seen.has(val)) {
      seen.add(val);
      set.push(val);
    }
  };
}

function createSymbolBuckets() {
  return {
    functions: [] as string[],
    types: [] as string[],
    defines: [] as string[],
    globals: [] as string[],
  };
}

function limitSymbolBuckets(buckets: ReturnType<typeof createSymbolBuckets>) {
  return {
    functions: buckets.functions.slice(0, 20),
    types: buckets.types.slice(0, 12),
    defines: buckets.defines.slice(0, 18),
    globals: buckets.globals.slice(0, 10),
  };
}

function extractImportedSymbols(
  lines: string[],
  extractLine: (
    line: string,
    buckets: ReturnType<typeof createSymbolBuckets>,
    rawImports: string[],
    add: ReturnType<typeof createUniquePusher>
  ) => void
): Pick<FileSymbols, 'functions' | 'types' | 'defines' | 'globals' | 'rawImports'> {
  const buckets = createSymbolBuckets();
  const rawImports: string[] = [];
  const add = createUniquePusher();

  for (const line of lines) {
    extractLine(line.trim(), buckets, rawImports, add);
  }

  return { ...limitSymbolBuckets(buckets), rawImports };
}

// ─── Language-specific extractors ──────────────────────────────────────────

const C_KEYWORDS = new Set([
  'if',
  'else',
  'while',
  'for',
  'switch',
  'case',
  'return',
  'break',
  'continue',
  'goto',
  'sizeof',
  'typeof',
  'do',
  'default',
  'static',
  'inline',
  'extern',
  'const',
  'volatile',
  'unsigned',
  'signed',
  'void',
  'int',
  'char',
  'long',
  'short',
  'float',
  'double',
  'struct',
  'union',
  'enum',
  'typedef',
]);

function extractC(
  lines: string[]
): Pick<FileSymbols, 'functions' | 'types' | 'defines' | 'globals' | 'rawIncludes'> {
  const buckets = createSymbolBuckets();
  const rawIncludes: string[] = [];
  const add = createUniquePusher();

  for (const line of lines) {
    const t = line.trim();

    // #include
    const inc = t.match(/^#include\s+["<]([^">]+)[">]/);
    if (inc) {
      rawIncludes.push(inc[1]);
      continue;
    }

    // #define MACRO_NAME (only uppercase macros, ≥3 chars)
    const def = t.match(/^#define\s+([A-Z_][A-Z0-9_]{2,})\b/);
    if (def) {
      add(buckets.defines, def[1]);
      continue;
    }

    // typedef struct Foo { ... } Foo;  OR  struct Foo {
    const ts = t.match(/^(?:typedef\s+)?struct\s+([A-Za-z_]\w+)/);
    if (ts && ts[1] !== '{') {
      add(buckets.types, ts[1]);
    }

    // typedef void (*fn_t)(...)
    const tdef = t.match(/^typedef\s+\w[\w\s*]+\(\s*\*\s*(\w+)\s*\)/);
    if (tdef) {
      add(buckets.types, tdef[1]);
    }

    // enum Foo {
    const en = t.match(/^(?:typedef\s+)?enum\s+([A-Za-z_]\w+)/);
    if (en) {
      add(buckets.types, en[1]);
    }

    // Function definition heuristic: return_type name(
    // Must start the line (not indented), not be a keyword/macro
    if (
      !t.startsWith(' ') &&
      !t.startsWith('\t') &&
      !t.startsWith('#') &&
      !t.startsWith('/') &&
      !t.startsWith('*')
    ) {
      // Extract the identifier immediately before the first '(' — avoids
      // nested-quantifier catastrophic backtracking on long declaration lines.
      const parenIdx = t.indexOf('(');
      if (parenIdx > 2) {
        const before = t.slice(0, parenIdx).trimEnd();
        // Must have at least one space (return type token) before the name
        const spaceIdx = before.lastIndexOf(' ');
        if (spaceIdx >= 0) {
          const candidate = before.slice(spaceIdx + 1).replace(/^\*+/, '');
          if (
            candidate.length >= 3 &&
            /^\w+$/.test(candidate) &&
            !C_KEYWORDS.has(candidate) &&
            !/^[A-Z_][A-Z0-9_]+$/.test(candidate)
          ) {
            add(buckets.functions, candidate);
          }
        }
      }
      // extern TYPE varname;
      const gl = t.match(/^(?:extern\s+)(?:\w+\s+)+\**(\w+)\s*;/);
      if (gl && !C_KEYWORDS.has(gl[1])) {
        add(buckets.globals, gl[1]);
      }
    }
  }

  return {
    ...limitSymbolBuckets(buckets),
    rawIncludes,
  };
}

function extractPython(
  lines: string[]
): Pick<FileSymbols, 'functions' | 'types' | 'defines' | 'globals' | 'rawImports'> {
  return extractImportedSymbols(lines, (t, buckets, rawImports, add) => {
    if (t.match(/^import\s+([\w.]+)/)) {
      rawImports.push(RegExp.$1);
      return;
    }
    if (t.match(/^from\s+([\w./]+)\s+import/)) {
      rawImports.push(RegExp.$1);
      return;
    }
    const defn = t.match(/^(?:async\s+)?def\s+([a-z_]\w+)\s*\(/);
    if (defn) {
      add(buckets.functions, defn[1]);
      return;
    }
    const cls = t.match(/^class\s+(\w+)/);
    if (cls) {
      add(buckets.types, cls[1]);
      return;
    }
    // module-level: uppercase = constant, lowercase = global
    if (!t.startsWith(' ') && !t.startsWith('\t') && !t.startsWith('#') && !t.startsWith('"')) {
      const uc = t.match(/^([A-Z_][A-Z0-9_]{2,})\s*=/);
      if (uc) {
        add(buckets.defines, uc[1]);
        return;
      }
      const lc = t.match(/^([a-z_]\w+)\s*=[^=]/);
      if (lc && lc[1] !== '_') {
        add(buckets.globals, lc[1]);
      }
    }
  });
}

function extractTS(
  lines: string[]
): Pick<FileSymbols, 'functions' | 'types' | 'defines' | 'globals' | 'rawImports'> {
  return extractImportedSymbols(lines, (t, buckets, rawImports, add) => {
    const imp = t.match(/^import\s+.*from\s+['"]([^'"]+)['"]/);
    if (imp) {
      rawImports.push(imp[1]);
      return;
    }
    const fn = t.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
    if (fn) {
      add(buckets.functions, fn[1]);
      return;
    }
    const arrowFn = t.match(/^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    if (arrowFn) {
      add(buckets.functions, arrowFn[1]);
      return;
    }
    const CONST = t.match(/^(?:export\s+)?(?:const|let)\s+([A-Z_][A-Z0-9_]{2,})\s*=/);
    if (CONST) {
      add(buckets.defines, CONST[1]);
      return;
    }
    const tp = t.match(/^(?:export\s+)?(?:interface|type|class|enum)\s+(\w+)/);
    if (tp) {
      add(buckets.types, tp[1]);
      return;
    }
    const gl = t.match(/^(?:export\s+)?(?:const|let|var)\s+([a-z_]\w+)\s*=/);
    if (gl) {
      add(buckets.globals, gl[1]);
      return;
    }
  });
}

// ─── Main parse entry point ─────────────────────────────────────────────────

export function parseSymbols(filePath: string, content: string): FileSymbols {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    py: 'python',
    rs: 'rust',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
  };
  const language = langMap[ext] ?? 'text';

  // Cap at 700 lines for perf — includes/#define/#import are always near the top
  const lines = content.split('\n').slice(0, 700);

  if (language === 'c' || language === 'cpp') {
    const r = extractC(lines);
    return { filePath, language, rawImports: [], ...r };
  }
  if (language === 'python') {
    const r = extractPython(lines);
    return { filePath, language, rawIncludes: [], ...r };
  }
  if (language === 'typescript' || language === 'javascript') {
    const r = extractTS(lines);
    return { filePath, language, rawIncludes: [], ...r };
  }
  return {
    filePath,
    language,
    functions: [],
    types: [],
    defines: [],
    globals: [],
    rawIncludes: [],
    rawImports: [],
  };
}
