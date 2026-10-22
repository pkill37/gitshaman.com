import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ignore from 'ignore';

export const CLI_VERSION = '0.1.0';
export const STATE = '.gitshaman';
export type AnalysisSettings = {
  exclude: string[];
  languages: string[];
  enrichment: 'auto' | 'off';
};
export type Config = {
  version: 1;
  analysis: AnalysisSettings;
  embeddings: {
    provider: 'ollama' | 'openrouter';
    model: string;
    endpoint: string;
    apiKeyEnv?: string;
  };
};
export const DEFAULT_CONFIG: Config = {
  version: 1,
  analysis: { exclude: [], languages: [], enrichment: 'auto' },
  embeddings: { provider: 'ollama', model: 'embeddinggemma', endpoint: 'http://127.0.0.1:11434' },
};
export const sha256 = (value: string | Buffer): string =>
  crypto.createHash('sha256').update(value).digest('hex');

export function git(root: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
export function repositoryRoot(directory: string): string {
  try {
    return fs.realpathSync(git(path.resolve(directory), ['rev-parse', '--show-toplevel']).trim());
  } catch {
    throw new Error('Run GitShaman inside a Git worktree, or pass --repo <directory>.');
  }
}
export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}
export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export function readConfig(root: string): Config {
  const file = path.join(root, 'gitshaman.json');
  if (!fs.existsSync(file)) throw new Error('Repository is not initialized. Run gitshaman init.');
  let config: Config;
  try {
    config = readJson<Config>(file);
  } catch {
    throw new Error('Invalid gitshaman.json. Expected valid JSON.');
  }
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    config.version !== 1 ||
    !config.analysis ||
    !Array.isArray(config.analysis.exclude) ||
    !config.analysis.exclude.every((x) => typeof x === 'string') ||
    !Array.isArray(config.analysis.languages) ||
    !config.analysis.languages.every((x) => typeof x === 'string') ||
    !['auto', 'off'].includes(config.analysis.enrichment) ||
    !config.embeddings ||
    !['ollama', 'openrouter'].includes(config.embeddings.provider) ||
    typeof config.embeddings.model !== 'string' ||
    !config.embeddings.model.trim() ||
    typeof config.embeddings.endpoint !== 'string'
  ) {
    throw new Error('Invalid gitshaman.json. Expected version 1 analysis and embeddings settings.');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(config.embeddings.endpoint);
  } catch {
    throw new Error('Embedding endpoint must be a valid HTTP(S) URL.');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      'Embedding endpoint must be an HTTP(S) URL without credentials, query, or fragment.'
    );
  }
  if (
    config.embeddings.apiKeyEnv !== undefined &&
    (typeof config.embeddings.apiKeyEnv !== 'string' ||
      !/^[A-Z_][A-Z0-9_]*$/.test(config.embeddings.apiKeyEnv))
  ) {
    throw new Error('apiKeyEnv must name an environment variable.');
  }
  return config;
}
export function initialize(root: string): { root: string; initialized: true } {
  fs.mkdirSync(path.join(root, STATE), { recursive: true });
  const configPath = path.join(root, 'gitshaman.json');
  if (!fs.existsSync(configPath)) writeJson(configPath, DEFAULT_CONFIG);
  const ignorePath = path.join(root, '.gitshamanignore');
  if (!fs.existsSync(ignorePath))
    fs.writeFileSync(ignorePath, '# Additional Git ignore patterns for GitShaman analysis\n');
  const gitignore = path.join(root, '.gitignore');
  const existing = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  if (
    !existing.split(/\r?\n/).some((line) => ['.gitshaman/', '/.gitshaman/'].includes(line.trim()))
  ) {
    fs.appendFileSync(
      gitignore,
      `${existing && !existing.endsWith('\n') ? '\n' : ''}.gitshaman/\n`
    );
  }
  readConfig(root);
  return { root, initialized: true };
}

const EXCLUDED = new Set([
  '.git',
  STATE,
  'node_modules',
  '.next',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
]);
const BINARY =
  /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|bz2|xz|7z|tar|woff2?|ttf|mp[34]|mov|wav|sqlite(?:3)?|db|o|a|so|dylib|dll|exe|wasm|pyc|class)$/i;
export function safeRelative(file: string): boolean {
  return (
    !!file &&
    !path.isAbsolute(file) &&
    !file.includes('\\') &&
    !file.split('/').some((part) => part === '..' || part === '.' || !part) &&
    !/[\x00-\x1f\x7f]/.test(file)
  );
}
export function eligible(file: string): boolean {
  const name = path.posix.basename(file);
  return (
    safeRelative(file) &&
    !file.split('/').some((part) => EXCLUDED.has(part)) &&
    !BINARY.test(file) &&
    !/^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.gitconfig|credentials(?:\..*)?|id_(?:rsa|ed25519)(?:\.pub)?)$/i.test(
      name
    ) &&
    !/\.(?:pem|key|p12|pfx)$/i.test(name) &&
    !file.split('/').some((part) => ['.aws', '.ssh', '.gnupg'].includes(part)) &&
    !['gitshaman.json', '.gitshamanignore'].includes(file)
  );
}

const LANGUAGE: Record<string, string> = {
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.py': 'python',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.md': 'markdown',
};
export function language(file: string): string {
  return LANGUAGE[path.extname(file).toLowerCase()] ?? 'plaintext';
}
export function selectFiles(
  files: string[],
  settings: AnalysisSettings,
  extraIgnore = ''
): string[] {
  const exclusions = ignore().add(settings.exclude).add(extraIgnore);
  return [...new Set(files)]
    .filter(
      (file) =>
        eligible(file) &&
        !exclusions.ignores(file) &&
        (!settings.languages.length || settings.languages.includes(language(file)))
    )
    .sort();
}
export function readEligibleFile(root: string, file: string): Buffer {
  if (!eligible(file)) throw new Error('File is outside the eligible repository source.');
  let current = root;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error('Symbolic links are not served or indexed.');
  }
  const resolved = fs.realpathSync(current);
  if (!resolved.startsWith(`${fs.realpathSync(root)}${path.sep}`))
    throw new Error('File escapes the repository.');
  const fd = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      throw new Error('File exceeds the 8 MiB source limit.');
    const bytes = fs.readFileSync(fd);
    if (bytes.includes(0)) throw new Error('Binary file.');
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
export function workingFiles(
  root: string,
  settings: AnalysisSettings
): { files: string[]; skipped: number } {
  const candidates = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);
  const extra = fs.existsSync(path.join(root, '.gitshamanignore'))
    ? fs.readFileSync(path.join(root, '.gitshamanignore'), 'utf8')
    : '';
  const files = selectFiles(candidates, settings, extra).filter((file) => {
    try {
      if (fs.existsSync(path.join(root, path.dirname(file), '.git')) && path.dirname(file) !== '.')
        return false;
      readEligibleFile(root, file);
      return true;
    } catch {
      return false;
    }
  });
  return { files, skipped: candidates.length - files.length };
}
export function hashes(root: string, files: string[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file, sha256(readEligibleFile(root, file))]));
}
export function fingerprint(files: Record<string, string>, settings: AnalysisSettings): string {
  return sha256(JSON.stringify({ version: CLI_VERSION, files, settings }));
}
export function withWriter<T>(root: string, action: () => T | Promise<T>): Promise<T> {
  const file = path.join(root, STATE, 'writer.lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let fd: number;
  try {
    fd = fs.openSync(file, 'wx');
  } catch {
    throw new Error(
      'Another GitShaman writer is active. If it crashed, remove .gitshaman/writer.lock after confirming it stopped.'
    );
  }
  return (async () => {
    try {
      fs.writeSync(fd, `${process.pid}\n`);
      return await action();
    } finally {
      try {
        fs.closeSync(fd);
      } finally {
        fs.rmSync(file, { force: true });
      }
    }
  })();
}
