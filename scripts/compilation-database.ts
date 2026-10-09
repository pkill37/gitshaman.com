import fs from 'fs';
import path from 'path';

export const GENERATED_COMMAND_MARKER = 'gitshaman-source-snapshot-v1';
const SOURCE_LANGUAGES: Record<string, string> = {
  '.c': 'c',
  '.C': 'c++',
  '.cc': 'c++',
  '.cpp': 'c++',
  '.cxx': 'c++',
  '.m': 'objective-c',
  '.mm': 'objective-c++',
};
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.cache']);

export function findCompilationDatabase(repoDir: string): string | null {
  // Prefer build-system output over our source-only fallback at the root.
  for (const candidate of [
    'build/compile_commands.json',
    'out/compile_commands.json',
    'compile_commands.json',
  ]) {
    const absolutePath = path.join(repoDir, candidate);
    if (fs.existsSync(absolutePath)) return absolutePath;
  }
  return null;
}

export type CompilationDatabasePreparation = {
  status: 'existing' | 'generated' | 'not-applicable';
  databasePath: string | null;
  commandCount?: number;
};

/** Source-only commands enable partial navigation without pretending to reproduce a native build. */
export function prepareCompilationDatabase(repoDir: string): CompilationDatabasePreparation {
  const root = path.resolve(repoDir);
  const existing = findCompilationDatabase(root);
  if (existing) return { status: 'existing', databasePath: existing };

  const files: string[] = [];
  const includeDirectories = new Set([root]);
  function walk(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) {
        if (/^include$/i.test(entry.name)) includeDirectories.add(absolutePath);
        walk(absolutePath);
      } else if (entry.isFile() && SOURCE_LANGUAGES[path.extname(entry.name)]) {
        files.push(absolutePath);
      }
    }
  }
  walk(root);
  if (files.length === 0) return { status: 'not-applicable', databasePath: null, commandCount: 0 };

  // Only use ancestor include directories: unrelated architectures/vendors often
  // provide conflicting headers with identical names.
  const commands = files.sort().map((file) => {
    const language = SOURCE_LANGUAGES[path.extname(file)];
    const includes = [...includeDirectories].filter((directory) => {
      const parent = path.dirname(directory);
      return directory === root || file.startsWith(`${parent}${path.sep}`);
    });
    return {
      directory: root,
      file: path.relative(root, file),
      arguments: [
        language.includes('++') ? 'clang++' : 'clang',
        '-x',
        language,
        ...includes.sort().flatMap((directory) => ['-I', directory]),
        '-c',
        file,
      ],
      gitshaman: GENERATED_COMMAND_MARKER,
    };
  });
  const databasePath = path.join(root, 'compile_commands.json');
  fs.writeFileSync(databasePath, `${JSON.stringify(commands, null, 2)}\n`, { flag: 'wx' });
  return { status: 'generated', databasePath, commandCount: commands.length };
}
