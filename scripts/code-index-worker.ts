#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildCodeIndex,
  type CodeIndexBuildStats,
  type CodeIndexBuildLogger,
} from './code-index-builder';
import { CODE_INDEX_FILE_NAME } from '../src/lib/code-index';
import { enrichCodeIndexWithClangd } from './clangd-semantic-index';

type ManifestNode = {
  name: string;
  type: 'f' | 'd';
  children?: ManifestNode[];
};

type Manifest = {
  tree?: ManifestNode[];
  buildSignature?: string;
};

type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
};

function toFileNode(node: ManifestNode, parentPath = ''): FileNode {
  const relativePath = parentPath ? `${parentPath}/${node.name}` : node.name;
  const result: FileNode = {
    name: node.name,
    path: relativePath,
    type: node.type === 'd' ? 'directory' : 'file',
  };

  if (node.children) {
    result.children = node.children.map((child) => toFileNode(child, relativePath));
  }

  return result;
}

async function main(): Promise<void> {
  const repoDir = process.argv[2];
  const statsPath = process.argv[3];
  if (!repoDir || !statsPath) {
    throw new Error('Usage: code-index-worker.ts <repoDir> <statsPath>');
  }

  const manifestPath = path.join(repoDir, 'repo-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  if (!manifest.buildSignature || !Array.isArray(manifest.tree)) {
    throw new Error(`Invalid repository manifest: ${manifestPath}`);
  }

  const logger: CodeIndexBuildLogger = {
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  };
  const stats: CodeIndexBuildStats = buildCodeIndex(
    repoDir,
    manifest.tree.map((node) => toFileNode(node)),
    manifest.buildSignature,
    logger
  );

  if (process.env.EXPLORAR_SKIP_SEMANTIC_ENRICHMENT !== '1') {
    await enrichCodeIndexWithClangd(repoDir, stats.dbPath, logger);
  }

  fs.writeFileSync(statsPath, `${JSON.stringify(stats)}\n`);
  // Keep the output path meaningful in process listings and validate that the
  // expected index was produced before reporting success.
  if (!fs.existsSync(path.join(repoDir, CODE_INDEX_FILE_NAME))) {
    throw new Error(`Code index was not created at ${repoDir}`);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  }
}
