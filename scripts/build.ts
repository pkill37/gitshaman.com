#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { inspectCorpusState } from './download-repos';
import { writeGuideRegistry } from './generate-guide-registry';

type Step = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

type CodeIndexRunStats = {
  repoCount: number;
  totalDurationMs: number;
  totalFileCount: number;
  totalSymbolCount: number;
  totalEdgeCount?: number;
  totalTruncatedFileCount: number;
};

function fail(message: string): never {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function fmtDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

function isTruthyEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function shouldSkipCorpusBuild(): boolean {
  if (process.env.EXPLORAR_SKIP_CORPUS_BUILD !== undefined) {
    return isTruthyEnv('EXPLORAR_SKIP_CORPUS_BUILD');
  }

  return isTruthyEnv('CF_PAGES');
}

function readCodeIndexStats(statsPath: string): CodeIndexRunStats | null {
  if (!fs.existsSync(statsPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(statsPath, 'utf-8')) as CodeIndexRunStats;
  } catch {
    return null;
  }
}

function formatCodeIndexStats(stats: CodeIndexRunStats | null): string {
  if (!stats || stats.repoCount === 0) {
    return '0s (no repos indexed; corpus cache current)';
  }

  const truncatedNote =
    stats.totalTruncatedFileCount > 0 ? `, ${stats.totalTruncatedFileCount} truncated` : '';
  const edgeNote =
    typeof stats.totalEdgeCount === 'number' ? `, ${stats.totalEdgeCount} edges` : '';
  return `${fmtDuration(stats.totalDurationMs)} across ${stats.repoCount} repo(s), ${stats.totalFileCount} files, ${stats.totalSymbolCount} symbols${edgeNote}${truncatedNote}`;
}

function runStep(index: number, total: number, step: Step): Promise<void> {
  const startedAt = Date.now();
  console.log(`\n[${index}/${total}] ${step.name}`);
  console.log(`  $ ${step.command} ${step.args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...step.env,
      },
    });

    child.on('error', (error) => {
      reject(new Error(`${step.name} failed to launch: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${step.name} exited with status ${code ?? 'unknown'}`));
        return;
      }

      console.log(`  done in ${fmtDuration(Date.now() - startedAt)}`);
      resolve();
    });
  });
}

async function runConcurrentGroup(
  index: number,
  total: number,
  label: string,
  steps: Step[]
): Promise<void> {
  const startedAt = Date.now();
  console.log(`\n[${index}/${total}] ${label}`);
  console.log('  running in parallel:');
  for (const step of steps) {
    console.log(`  - ${step.name}`);
  }

  const results = await Promise.allSettled(steps.map((step) => runStep(index, total, step)));

  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);

  if (failures.length > 0) {
    const message = failures
      .map((failure) => (failure instanceof Error ? failure.message : String(failure)))
      .join('\n');
    fail(message);
  }

  console.log(`  done in ${fmtDuration(Date.now() - startedAt)}`);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const codeIndexStatsPath = path.join(
    os.tmpdir(),
    `explorar-code-index-stats-${process.pid}.json`
  );
  let codeIndexStats: CodeIndexRunStats | null = null;
  console.log('\n[build] starting 6 phases');

  console.log('\n[1/6] Generate guide registry');
  writeGuideRegistry();

  if (shouldSkipCorpusBuild()) {
    console.log('\n[2/6] Download curated corpus');
    console.log(
      '  skipped: CI shell build uses the prebuilt R2 corpus (set EXPLORAR_SKIP_CORPUS_BUILD=0 to force local corpus generation)'
    );
  } else {
    const corpusState = await inspectCorpusState({
      only: [],
      skip: [],
      depth: 1,
      list: false,
      reindex: false,
    });

    if (corpusState.staleRepos.length === 0) {
      console.log('\n[2/6] Download curated corpus');
      console.log(`  skipped: ${corpusState.totalRepos} repos already cached`);
    } else {
      console.log('\n[2/6] Download curated corpus');
      console.log('  refresh required before build:');
      if (corpusState.staleRepos.length > 0) {
        console.log(`  - refreshing ${corpusState.staleRepos.length} repo target(s)`);
      }
      await runStep(2, 6, {
        name: 'Download curated corpus',
        command: 'tsx',
        args: ['scripts/download-repos.ts', '--depth=1'],
        env: {
          CODE_INDEX_STATS_PATH: codeIndexStatsPath,
        },
      });
      codeIndexStats = readCodeIndexStats(codeIndexStatsPath);
    }
  }

  await runConcurrentGroup(3, 6, 'Guide validation', [
    {
      name: 'Lint guide prose',
      command: 'node',
      args: ['scripts/lint-guide-prose.mjs'],
    },
    {
      name: 'Validate guide frontmatter',
      command: 'tsx',
      args: ['scripts/validate-guides.ts'],
    },
    {
      name: 'Check guide references against corpus',
      command: 'tsx',
      args: ['scripts/check-guide-refs.ts'],
    },
  ]);

  await runStep(4, 6, {
    name: 'Prepare shell-only public assets',
    command: 'tsx',
    args: ['scripts/prepare-public-assets.ts', '--shell'],
  });

  await runStep(5, 6, {
    name: 'Run Next.js production build',
    command: 'next',
    args: ['build'],
  });

  await runStep(6, 6, {
    name: 'Generate build report',
    command: 'tsx',
    args: ['scripts/report-build.ts'],
  });

  console.log(`\n[build] code indexing total: ${formatCodeIndexStats(codeIndexStats)}`);
  console.log(`[build] complete in ${fmtDuration(Date.now() - startedAt)}`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
