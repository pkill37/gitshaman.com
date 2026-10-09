#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CODE_INDEX_FILE_NAME } from '../src/lib/code-index';
import { CURATED_REPOS } from '../src/lib/curated-repos';
import { CORPUS_REPOS_DIR } from './static-asset-paths';

function main(): void {
  const missing: string[] = [];

  for (const repo of CURATED_REPOS) {
    const repoDir = path.join(CORPUS_REPOS_DIR, repo.owner, repo.repo, repo.revision);
    const manifestPath = path.join(repoDir, 'repo-manifest.json');
    const indexPath = path.join(repoDir, CODE_INDEX_FILE_NAME);
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    if (!fs.existsSync(indexPath)) {
      missing.push(`${repo.owner}/${repo.repo}@${repo.revision}`);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing ${CODE_INDEX_FILE_NAME} for ${missing.length} curated repo(s):`);
    for (const repo of missing) {
      console.error(`- ${repo}`);
    }
    console.error('\nRun npm run corpus:sync to rebuild missing indexes.');
    process.exit(1);
  }

  console.log(`All cached curated repos have ${CODE_INDEX_FILE_NAME}.`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
