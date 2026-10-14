import { findSymbolsInFile } from '@/lib/cross-reference';

export type EntityKind =
  'struct' | 'class' | 'type' | 'function' | 'enum' | 'interface' | 'macro' | 'variable';

export interface EntityField {
  name: string;
  type: string;
}

export interface CodeEntity {
  name: string;
  kind: EntityKind;
  fields: EntityField[];
  filePath: string;
  language: string;
}

type LocatedCodeEntity = CodeEntity & { line: number };

function createEntityCollection(lines: string[]): {
  entities: LocatedCodeEntity[];
  lineCount: number;
} {
  return { entities: [], lineCount: lines.length };
}

function signatureToFields(signature?: string): EntityField[] {
  if (!signature) return [];
  const match = signature.match(/\((.*)\)/);
  if (!match) return [];

  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && part !== 'void')
    .slice(0, 8)
    .map((part, index) => {
      const tokens = part.split(/\s+/).filter(Boolean);
      const name =
        tokens[tokens.length - 1]?.replace(/^[*&]+/, '').replace(/\[\]$/, '') || `arg${index + 1}`;
      const type = tokens.slice(0, -1).join(' ') || part;
      return { name, type };
    });
}

function symbolToEntity(
  symbol: ReturnType<typeof findSymbolsInFile>[number]
): CodeEntity & { line: number } {
  const base = {
    name: symbol.name,
    filePath: symbol.file,
    line: symbol.line,
    language: symbol.file.split('.').pop()?.toLowerCase() || 'text',
  };

  switch (symbol.type) {
    case 'struct':
    case 'class':
      return {
        ...base,
        kind: symbol.type,
        fields:
          symbol.members?.slice(0, 12).map((member) => ({
            name: member.name,
            type: member.type,
          })) ?? [],
      };
    case 'typedef':
      return {
        ...base,
        kind: 'type',
        fields: symbol.signature ? [{ name: symbol.name, type: symbol.signature }] : [],
      };
    case 'function':
      return {
        ...base,
        kind: 'function',
        fields: signatureToFields(symbol.signature),
      };
    case 'macro':
    case 'variable':
      return {
        ...base,
        kind: symbol.type,
        fields: [],
      };
    default:
      return {
        ...base,
        kind: 'type',
        fields: symbol.relatedSymbols
          .slice(0, 8)
          .map((related) => ({ name: related, type: 'related' })),
      };
  }
}

function extractPythonEntities(
  lines: string[],
  filePath: string
): Array<CodeEntity & { line: number }> {
  const { entities, lineCount: n } = createEntityCollection(lines);
  let i = 0;

  while (i < n) {
    const raw = lines[i];
    const t = raw.trim();
    const classM = t.match(/^class\s+(\w+)/);

    if (!classM) {
      i++;
      continue;
    }

    const name = classM[1];
    const classIndent = raw.match(/^(\s*)/)![1].length;
    const line = i + 1;
    i++;

    const fields: EntityField[] = [];
    const seen = new Set<string>();
    let inInit = false;

    while (i < n) {
      const bodyRaw = lines[i];
      const bodyT = bodyRaw.trim();
      const indent = bodyRaw.match(/^(\s*)/)![1].length;

      if (bodyT && indent <= classIndent && !bodyRaw.match(/^\s*$/)) {
        break;
      }

      if (indent === classIndent + 4 || indent === classIndent + 2) {
        const ann = bodyT.match(/^(\w+)\s*:\s*([^=\n]+?)(?:\s*=.*)?$/);
        if (ann && ann[1] !== 'def' && ann[1] !== 'class' && !seen.has(ann[1])) {
          seen.add(ann[1]);
          fields.push({ name: ann[1], type: ann[2].trim() });
        }
      }

      if (bodyT.match(/^def\s+__init__\s*\(/)) {
        inInit = true;
        i++;
        continue;
      }

      if (inInit) {
        if (bodyT && indent <= classIndent + 4 && bodyT.startsWith('def ')) {
          inInit = false;
        } else {
          const selfAnn = bodyT.match(/^self\.(\w+)\s*:\s*([^=\n]+?)(?:\s*=.*)?$/);
          const selfAssign = bodyT.match(/^self\.(\w+)\s*=/);
          if (selfAnn && !seen.has(selfAnn[1])) {
            seen.add(selfAnn[1]);
            fields.push({ name: selfAnn[1], type: selfAnn[2].trim() });
          } else if (selfAssign && !seen.has(selfAssign[1])) {
            seen.add(selfAssign[1]);
            fields.push({ name: selfAssign[1], type: '' });
          }
        }
      }

      i++;
    }

    entities.push({
      name,
      kind: 'class',
      fields: fields.slice(0, 12),
      filePath,
      language: 'python',
      line,
    });
  }

  return entities;
}

function extractTSEntities(
  lines: string[],
  filePath: string
): Array<CodeEntity & { line: number }> {
  const { entities, lineCount: n } = createEntityCollection(lines);
  let i = 0;

  const readBlockFields = (
    startIndex: number,
    includeAtDepth: (depth: number) => boolean,
    parseField: (body: string) => EntityField | undefined
  ): { fields: EntityField[]; nextIndex: number } => {
    const fields: EntityField[] = [];
    let depth = 1;
    let cursor = startIndex;

    while (cursor < n && depth > 0) {
      const body = lines[cursor].trim();
      depth += (body.match(/\{/g) || []).length;
      depth -= (body.match(/\}/g) || []).length;
      if (includeAtDepth(depth) && body && !body.startsWith('/')) {
        const field = parseField(body);
        if (field) fields.push(field);
      }
      cursor++;
    }

    return { fields: fields.slice(0, 12), nextIndex: cursor };
  };

  const parsePropertyField = (body: string): EntityField | undefined => {
    const field = body.match(/^(?:readonly\s+)?(\w+)\??\s*:\s*([^;,]+)/);
    return field ? { name: field[1], type: field[2].trim() } : undefined;
  };

  while (i < n) {
    const t = lines[i].trim();

    const ifaceM = t.match(/^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+\S+)?\s*\{/);
    if (ifaceM) {
      const { fields, nextIndex } = readBlockFields(
        i + 1,
        (depth) => depth > 0,
        parsePropertyField
      );
      entities.push({
        name: ifaceM[1],
        kind: 'interface',
        fields,
        filePath,
        language: 'typescript',
        line: i + 1,
      });
      i = nextIndex;
      continue;
    }

    const typeObjM = t.match(/^(?:export\s+)?type\s+(\w+)\s*=\s*\{/);
    if (typeObjM) {
      const { fields, nextIndex } = readBlockFields(
        i + 1,
        (depth) => depth > 0,
        parsePropertyField
      );
      entities.push({
        name: typeObjM[1],
        kind: 'type',
        fields,
        filePath,
        language: 'typescript',
        line: i + 1,
      });
      i = nextIndex;
      continue;
    }

    const enumM = t.match(/^(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/);
    if (enumM) {
      const { fields, nextIndex } = readBlockFields(
        i + 1,
        (depth) => depth > 0,
        (body) => {
          const val = body.match(/^(\w+)\s*(?:=\s*[^,]+)?\s*,?/);
          return val ? { name: val[1], type: '' } : undefined;
        }
      );
      entities.push({
        name: enumM[1],
        kind: 'enum',
        fields,
        filePath,
        language: 'typescript',
        line: i + 1,
      });
      i = nextIndex;
      continue;
    }

    const classM = t.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (classM) {
      const { fields, nextIndex } = readBlockFields(
        i + 1,
        (depth) => depth === 1,
        (body) => {
          const prop = body.match(
            /^(?:(?:private|public|protected|readonly|static|declare|override)\s+)*(\w+)\??\s*:\s*([^;=]+)/
          );
          return prop && !prop[1].match(/^(?:constructor|get|set|async|static|abstract)$/)
            ? { name: prop[1], type: prop[2].trim() }
            : undefined;
        }
      );
      entities.push({
        name: classM[1],
        kind: 'class',
        fields,
        filePath,
        language: 'typescript',
        line: i + 1,
      });
      i = nextIndex;
      continue;
    }

    i++;
  }

  return entities;
}

export function extractEntities(
  filePath: string,
  content: string
): Array<CodeEntity & { line: number }> {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const lines = content.split('\n').slice(0, 1500);

  if (ext === 'py') {
    return extractPythonEntities(lines, filePath);
  }

  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
    return extractTSEntities(lines, filePath);
  }

  const cFamilyExtensions = new Set([
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
  ]);
  if (cFamilyExtensions.has(ext)) {
    return findSymbolsInFile(content, filePath)
      .filter(
        (symbol) =>
          symbol.isDefinition &&
          (symbol.type === 'function' ||
            symbol.type === 'struct' ||
            symbol.type === 'class' ||
            symbol.type === 'typedef')
      )
      .map(symbolToEntity);
  }

  return [];
}
