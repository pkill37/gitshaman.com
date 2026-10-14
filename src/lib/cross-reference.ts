// Enhanced cross-referencing utilities for C/C++ code
// Finds function definitions, declarations, and references with rich metadata

export interface StructMember {
  name: string;
  type: string;
  line: number;
}

export interface Location {
  line: number;
  column: number;
  file: string;
}

export interface SymbolReference {
  name: string;
  type: 'function' | 'struct' | 'typedef' | 'macro' | 'variable' | 'class';
  line: number;
  column: number;
  file: string;
  isDefinition: boolean;
  isDeclaration: boolean;
  signature?: string; // Full function/struct signature
  documentation?: string; // Doc comments
  members?: StructMember[]; // For structs/classes
  references: Location[]; // All usage locations
  relatedSymbols: string[]; // Names of related symbols
}

// Enhanced regex patterns for C/C++ code
const FUNCTION_DEF_PATTERN = /^(?:[\w~:*<>[\],&]+\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{$/;
const FUNCTION_DECL_PATTERN = /^(?:[\w~:*<>[\],&]+\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*;$/;
const STRUCT_DEF_PATTERN = /^struct\s+(\w+)\s*\{/;
const STRUCT_DECL_PATTERN = /^struct\s+(\w+)\s*[;=]/;
const CLASS_DEF_PATTERN = /^class\s+(\w+)\s*[:\{]/;
const CLASS_DECL_PATTERN = /^class\s+(\w+)\s*[;]/;
const TYPEDEF_PATTERN = /^typedef\s+.*\s+(\w+)\s*;/;
const MACRO_PATTERN = /^#define\s+(\w+)/;
const LINUX_SYSCALL_DEFINE_PATTERN = /^(?:COMPAT_)?SYSCALL_DEFINE\d+\s*\(\s*([A-Za-z_]\w*)\s*,?/;
const STRUCT_MEMBER_PATTERN = /^\s*(\w+(?:\s*\*+)?)\s+(\w+)\s*[;,\[]/;
const CONTROL_FLOW_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'return',
  'sizeof',
  'typedef',
  'define',
  'else',
  'do',
]);
const MACRO_LIKE_SYMBOL = /^[A-Z0-9_]+$/;

function isLikelyCallableSymbol(name: string): boolean {
  return !CONTROL_FLOW_KEYWORDS.has(name) && !MACRO_LIKE_SYMBOL.test(name);
}

function looksLikeTypeFragment(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.includes('(') || trimmed.includes(')')) {
    return false;
  }

  return /^(?:[\w:*<>[\],&]+(?:\s+|$))+$/.test(trimmed);
}

// Extract documentation comments preceding a line
function extractDocumentation(lines: string[], startLine: number): string | undefined {
  const docLines: string[] = [];
  let i = startLine - 2; // Check lines before the symbol

  // Look for /** */ style comments
  while (i >= 0 && i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('*/')) {
      // End of comment block, collect backwards
      i--;
      while (i >= 0) {
        const docLine = lines[i].trim();
        if (docLine.startsWith('/**') || docLine.startsWith('/*!')) {
          docLines.unshift(docLine.replace(/^\/\*\*?\s*/, '').replace(/\s*\*\/$/, ''));
          break;
        }
        if (docLine.startsWith('*') || docLine.startsWith('!')) {
          docLines.unshift(docLine.replace(/^[\*!]\s*/, ''));
        } else if (docLine.length === 0) {
          // Empty line, might be part of comment
        } else {
          break;
        }
        i--;
      }
      break;
    }
    if (line.length === 0 || line.startsWith('//')) {
      i--;
      continue;
    }
    if (!line.startsWith('*') && !line.startsWith('/*') && !line.startsWith('*/')) {
      break;
    }
    i--;
  }

  // Also check for /// style comments
  if (docLines.length === 0) {
    i = startLine - 2;
    while (i >= 0 && i < lines.length) {
      const line = lines[i].trim();
      if (line.startsWith('///')) {
        docLines.unshift(line.replace(/^\/\/\/\s*/, ''));
        i--;
      } else if (line.length === 0) {
        i--;
      } else {
        break;
      }
    }
  }

  return docLines.length > 0 ? docLines.join(' ').trim() : undefined;
}

// Extract struct/class members
function extractMembers(lines: string[], startLine: number): StructMember[] {
  const members: StructMember[] = [];
  let braceCount = 0;
  let inStruct = false;

  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Count braces to find struct boundaries
    for (const char of line) {
      if (char === '{') {
        braceCount++;
        inStruct = true;
      }
      if (char === '}') {
        braceCount--;
        if (braceCount === 0 && inStruct) {
          return members;
        }
      }
    }

    if (inStruct && braceCount > 0) {
      // Try to match struct member pattern
      const memberMatch = trimmed.match(STRUCT_MEMBER_PATTERN);
      if (memberMatch) {
        const type = memberMatch[1].trim();
        const name = memberMatch[2].trim();
        if (name && !name.startsWith('//') && !name.startsWith('/*')) {
          members.push({
            name,
            type,
            line: i + 1,
          });
        }
      }
    }
  }

  return members;
}

// Extract full function signature
function extractFunctionSignature(line: string): string {
  // Try to get the full function signature up to the opening brace
  const match = line.match(/^([^{]+)\{/);
  if (match) {
    return match[1].trim();
  }
  return line.trim();
}

function combineFunctionSignature(lines: string[], lineIndex: number): string {
  const current = lines[lineIndex]?.trim() || '';
  const previous = lines[lineIndex - 1]?.trim() || '';
  const next = lines[lineIndex + 1]?.trim() || '';
  if (!current) {
    return '';
  }

  let signature = current;

  if (looksLikeTypeFragment(previous)) {
    signature = `${previous} ${signature}`;
  }

  if (!/[;{]\s*$/.test(signature) && (next === '{' || next === ';')) {
    signature = `${signature} ${next}`;
  }

  return signature.trim();
}

// Find all references to a symbol in the file
export function findReferencesInContent(
  symbolName: string,
  content: string,
  filePath: string,
  excludeLine?: number
): Location[] {
  const references: Location[] = [];
  const lines = content.split('\n');
  // Word boundary pattern to avoid partial matches
  const wordBoundaryPattern = new RegExp(
    `\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
    'g'
  );

  for (let i = 0; i < lines.length; i++) {
    if (excludeLine && i + 1 === excludeLine) continue;

    const line = lines[i];
    let match;
    while ((match = wordBoundaryPattern.exec(line)) !== null) {
      references.push({
        line: i + 1,
        column: match.index + 1,
        file: filePath,
      });
    }
  }

  return references;
}

// Find related symbols (symbols that use this symbol)
function findRelatedSymbols(
  symbolName: string,
  allSymbols: SymbolReference[],
  content: string
): string[] {
  const related: string[] = [];
  const lines = content.split('\n');

  for (const symbol of allSymbols) {
    if (symbol.name === symbolName) continue;

    // Check if this symbol's definition/declaration uses the target symbol
    const symbolLine = lines[symbol.line - 1] || '';
    const wordBoundaryPattern = new RegExp(
      `\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
    );
    if (wordBoundaryPattern.test(symbolLine)) {
      related.push(symbol.name);
    }
  }

  return related;
}

export function findSymbolsInFile(content: string, filePath: string): SymbolReference[] {
  const symbols: SymbolReference[] = [];
  const lines = content.split('\n');

  // First pass: collect all symbols
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const signatureLine = combineFunctionSignature(lines, i);
    const lineNum = i + 1;

    // Skip comments and preprocessor directives (except #define)
    if (trimmed.startsWith('//') || (trimmed.startsWith('/*') && !trimmed.includes('*/'))) {
      continue;
    }

    // Linux syscall implementations are declared through SYSCALL_DEFINE*
    // macros, for example: SYSCALL_DEFINE3(getdents, ...).
    const syscallDefMatch = trimmed.match(LINUX_SYSCALL_DEFINE_PATTERN);
    if (syscallDefMatch) {
      const syscallName = syscallDefMatch[1];
      const documentation = extractDocumentation(lines, lineNum);
      symbols.push({
        name: syscallName,
        type: 'function',
        line: lineNum,
        column: line.indexOf(syscallName) + 1,
        file: filePath,
        isDefinition: true,
        isDeclaration: false,
        signature: trimmed,
        documentation,
        references: [],
        relatedSymbols: [],
      });
    }

    // Function definitions
    const funcDefMatch = trimmed.includes('(') ? signatureLine.match(FUNCTION_DEF_PATTERN) : null;
    // Function declarations
    const funcDeclMatch =
      trimmed.includes('(') && !funcDefMatch ? signatureLine.match(FUNCTION_DECL_PATTERN) : null;
    const functionMatch = funcDefMatch ?? funcDeclMatch;
    if (functionMatch) {
      const funcName = functionMatch[1];
      if (funcName && isLikelyCallableSymbol(funcName)) {
        const signature = extractFunctionSignature(signatureLine);
        const documentation = extractDocumentation(lines, lineNum);
        symbols.push({
          name: funcName,
          type: 'function',
          line: lineNum,
          column: line.indexOf(funcName) + 1,
          file: filePath,
          isDefinition: Boolean(funcDefMatch),
          isDeclaration: !funcDefMatch,
          signature,
          documentation,
          references: [],
          relatedSymbols: [],
        });
      }
    }

    // Struct definitions
    const structDefMatch = trimmed.match(STRUCT_DEF_PATTERN);
    if (structDefMatch) {
      const structName = structDefMatch[1];
      const documentation = extractDocumentation(lines, lineNum);
      const members = extractMembers(lines, lineNum);
      symbols.push({
        name: structName,
        type: 'struct',
        line: lineNum,
        column: line.indexOf(structName) + 1,
        file: filePath,
        isDefinition: true,
        isDeclaration: false,
        documentation,
        members,
        references: [],
        relatedSymbols: [],
      });
    }

    // Struct declarations
    const structDeclMatch = trimmed.match(STRUCT_DECL_PATTERN);
    if (structDeclMatch && !structDefMatch) {
      const structName = structDeclMatch[1];
      const documentation = extractDocumentation(lines, lineNum);
      symbols.push({
        name: structName,
        type: 'struct',
        line: lineNum,
        column: line.indexOf(structName) + 1,
        file: filePath,
        isDefinition: false,
        isDeclaration: true,
        documentation,
        references: [],
        relatedSymbols: [],
      });
    }

    // C++ Class definitions
    const classDefMatch = trimmed.match(CLASS_DEF_PATTERN);
    if (classDefMatch) {
      const className = classDefMatch[1];
      const documentation = extractDocumentation(lines, lineNum);
      const members = extractMembers(lines, lineNum);
      symbols.push({
        name: className,
        type: 'class',
        line: lineNum,
        column: line.indexOf(className) + 1,
        file: filePath,
        isDefinition: true,
        isDeclaration: false,
        documentation,
        members,
        references: [],
        relatedSymbols: [],
      });
    }

    // C++ Class declarations
    const classDeclMatch = trimmed.match(CLASS_DECL_PATTERN);
    if (classDeclMatch && !classDefMatch) {
      const className = classDeclMatch[1];
      const documentation = extractDocumentation(lines, lineNum);
      symbols.push({
        name: className,
        type: 'class',
        line: lineNum,
        column: line.indexOf(className) + 1,
        file: filePath,
        isDefinition: false,
        isDeclaration: true,
        documentation,
        references: [],
        relatedSymbols: [],
      });
    }

    // Typedefs
    const typedefMatch = trimmed.match(TYPEDEF_PATTERN);
    if (typedefMatch) {
      const typedefName = typedefMatch[1];
      const documentation = extractDocumentation(lines, lineNum);
      symbols.push({
        name: typedefName,
        type: 'typedef',
        line: lineNum,
        column: line.indexOf(typedefName) + 1,
        file: filePath,
        isDefinition: true,
        isDeclaration: false,
        documentation,
        references: [],
        relatedSymbols: [],
      });
    }

    // Macros
    const macroMatch = trimmed.match(MACRO_PATTERN);
    if (macroMatch) {
      const macroName = macroMatch[1];
      const documentation = extractDocumentation(lines, lineNum);
      symbols.push({
        name: macroName,
        type: 'macro',
        line: lineNum,
        column: line.indexOf(macroName) + 1,
        file: filePath,
        isDefinition: true,
        isDeclaration: false,
        documentation,
        references: [],
        relatedSymbols: [],
      });
    }
  }

  // Second pass: find references and related symbols for each symbol
  for (const symbol of symbols) {
    symbol.references = findReferencesInContent(symbol.name, content, filePath, symbol.line);
    symbol.relatedSymbols = findRelatedSymbols(symbol.name, symbols, content);
  }

  return symbols;
}

export function findDefinition(
  symbolName: string,
  symbols: SymbolReference[]
): SymbolReference | null {
  return symbols.find((s) => s.name === symbolName && s.isDefinition) || null;
}

export function findAllReferences(symbolName: string, symbols: SymbolReference[]): Location[] {
  const allReferences: Location[] = [];
  for (const symbol of symbols) {
    if (symbol.name === symbolName) {
      allReferences.push(...symbol.references);
    }
  }
  return allReferences;
}
