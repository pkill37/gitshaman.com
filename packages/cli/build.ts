import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(packageRoot, '../..');
const dist = path.join(packageRoot, 'dist');
const assets = path.join(dist, 'workspace');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(assets, { recursive: true });
await build({
  entryPoints: [path.join(packageRoot, 'src/cli.ts')],
  outfile: path.join(dist, 'cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['better-sqlite3'],
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
await build({
  entryPoints: { workspace: path.join(packageRoot, 'workspace/index.tsx') },
  outdir: assets,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  alias: {
    'next/dynamic': path.join(packageRoot, 'workspace/dynamic.tsx'),
    'next/navigation': path.join(packageRoot, 'workspace/navigation.ts'),
    'next/link': path.join(packageRoot, 'workspace/link.tsx'),
  },
  loader: { '.ttf': 'file', '.md': 'text', '.woff2': 'file' },
  tsconfig: path.join(root, 'tsconfig.json'),
});
fs.copyFileSync(path.join(packageRoot, 'workspace/index.html'), path.join(assets, 'index.html'));
fs.copyFileSync(path.join(root, 'public/favicon.svg'), path.join(assets, 'favicon.svg'));
const require = createRequire(import.meta.url);
fs.mkdirSync(path.join(assets, 'sqljs'), { recursive: true });
// Browser bundles resolve SQL.js's browser export, which loads its own WASM binary.
for (const file of ['sql-wasm-browser.wasm', 'sql-wasm.wasm']) {
  fs.copyFileSync(require.resolve(`sql.js/dist/${file}`), path.join(assets, 'sqljs', file));
}
const monaco = path.join(root, 'node_modules/monaco-editor/esm/vs');
await build({
  entryPoints: [
    'editor/editor.worker.js',
    'language/json/json.worker.js',
    'language/css/css.worker.js',
    'language/html/html.worker.js',
    'language/typescript/ts.worker.js',
  ].map((file) => path.join(monaco, file)),
  outbase: monaco,
  outdir: path.join(assets, 'monaco-editor/vs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});
const manifest: Record<string, string> = {};
function hashDirectory(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) hashDirectory(file);
    else if (entry.name !== 'integrity.json')
      manifest[path.relative(dist, file).split(path.sep).join('/')] = createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex');
  }
}
hashDirectory(dist);
fs.writeFileSync(path.join(dist, 'integrity.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.chmodSync(path.join(dist, 'cli.js'), 0o755);
console.log(`Built GitShaman CLI and workspace (${Object.keys(manifest).length} assets).`);
