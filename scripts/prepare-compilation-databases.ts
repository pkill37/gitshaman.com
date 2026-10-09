import fs from 'fs';
import path from 'path';
import { CURATED_REPOS } from '../src/lib/curated-repos';
import { CORPUS_REPOS_DIR } from './static-asset-paths';
import { prepareCompilationDatabase } from './compilation-database';

let failures = 0;
for (const repo of CURATED_REPOS) {
  const label = `${repo.owner}/${repo.repo}@${repo.revision}`;
  const repoDir = path.join(CORPUS_REPOS_DIR, repo.owner, repo.repo, repo.revision);
  try {
    if (!fs.existsSync(path.join(repoDir, 'repo-manifest.json'))) {
      throw new Error('Snapshot is missing; run corpus:sync first.');
    }
    const result = prepareCompilationDatabase(repoDir);
    console.log(
      `${label}: ${result.status}${result.commandCount === undefined ? '' : ` (${result.commandCount} compilation units)`}`
    );
  } catch (error) {
    failures++;
    console.error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exitCode = failures > 0 ? 1 : 0;
