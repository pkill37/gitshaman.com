/**
 * Next.js plugin to bundle Monaco Editor workers into public/.
 *
 * Monaco's ESM worker entries import other modules, so copying just the entries
 * leaves unresolved browser imports. Bundle each worker with its dependencies
 * to keep the static file count small. Next.js bundles the main API separately.
 */

import type { NextConfig } from 'next';
import { buildSync } from 'esbuild';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

const MONACO_SOURCE = join(process.cwd(), 'node_modules/monaco-editor/esm/vs');
const MONACO_DEST = join(process.cwd(), 'public/monaco-editor/vs');

// Only the workers Monaco spawns via getWorkerUrl need to live in public/.
// editor.worker  → all languages without a dedicated worker (C, Python, LLVM IR, …)
// json.worker    → JSON language features
// css.worker     → CSS/SCSS/LESS (arbitrary repos)
// html.worker    → HTML (arbitrary repos)
// ts.worker      → TypeScript/JavaScript (arbitrary repos)
const WORKER_FILES = [
  'editor/editor.worker.js',
  'language/json/json.worker.js',
  'language/css/css.worker.js',
  'language/html/html.worker.js',
  'language/typescript/ts.worker.js',
];

function bundleMonacoWorkers(): void {
  console.log('Bundling Monaco Editor workers...');
  const startTime = Date.now();

  if (existsSync(MONACO_DEST)) {
    rmSync(MONACO_DEST, { recursive: true, force: true });
  }

  buildSync({
    entryPoints: WORKER_FILES.map((workerFile) => join(MONACO_SOURCE, workerFile)),
    outbase: MONACO_SOURCE,
    outdir: MONACO_DEST,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
  });

  const duration = Date.now() - startTime;
  console.log(`Monaco workers bundled (${WORKER_FILES.length} files, ${duration}ms)`);
}

export function withMonacoEditor(nextConfig: NextConfig = {}): NextConfig {
  if (process.env.NODE_ENV !== 'test') {
    bundleMonacoWorkers();
  }
  return nextConfig;
}
