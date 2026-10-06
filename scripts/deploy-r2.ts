#!/usr/bin/env node
/** Deploy the generated corpus to Cloudflare R2. */

import { createHash } from 'crypto';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadDeployEnv } from './deploy-env';
import { getCorpusBuildSignature, type CorpusBuildTreeNode } from './corpus-build-signature';
import { CORPUS_REPOS_DIR } from './static-asset-paths';
import { CURATED_REPOS } from '../src/lib/curated-repos';
import { runPhase } from './tqdm';

type DeployEnv = {
  bucketName: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
};
type Repo = (typeof CURATED_REPOS)[number];
type RepoManifest = { buildSignature?: string; tree?: CorpusBuildTreeNode[] };

export const DEPLOYMENT_MANIFEST_SCHEMA_VERSION = 1;
export const DEPLOYMENT_MANIFEST_KEY = 'deployments/curated-corpus.json';
const DEFAULT_R2_RETRY_ATTEMPTS = 3;
const DEFAULT_R2_RETRY_BASE_DELAY_MS = 2_000;
const DEFAULT_R2_SYNC_CONCURRENCY = 2;
const DEFAULT_AWS_S3_MAX_CONCURRENT_REQUESTS = 10;
const R2_SYNC_COMPARISON_ARGS = ['--size-only'] as const;

export type DeploymentArtifactCounts = {
  corpusFiles: number;
  corpusBytes: number;
};
export type CanonicalDeploymentPayload = {
  schemaVersion: number;
  repositories: Array<{
    id: string;
    owner: string;
    repo: string;
    revision: string;
    buildSignature: string;
  }>;
};
export type DeploymentManifest = CanonicalDeploymentPayload & {
  deploymentSignature: string;
  artifactCounts: DeploymentArtifactCounts;
  generatedAt: string;
};

export function fail(message: string): never {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

export function readR2Env(): DeployEnv {
  const bucketName = process.env.R2_BUCKET_NAME?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!bucketName) fail('Missing R2_BUCKET_NAME');
  if (!accountId) fail('Missing CLOUDFLARE_ACCOUNT_ID');
  if (!accessKeyId) fail('Missing R2_ACCESS_KEY_ID');
  if (!secretAccessKey) fail('Missing R2_SECRET_ACCESS_KEY');
  return { bucketName, accountId, accessKeyId, secretAccessKey };
}

function awsEnv(env: DeployEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: env.accessKeyId,
    AWS_SECRET_ACCESS_KEY: env.secretAccessKey,
    AWS_DEFAULT_REGION: 'auto',
    // AWS documents this setting as the S3 transfer worker limit. Keep it in
    // one process instead of multiplying independent sync processes.
    AWS_S3_MAX_CONCURRENT_REQUESTS:
      process.env.AWS_S3_MAX_CONCURRENT_REQUESTS ?? String(DEFAULT_AWS_S3_MAX_CONCURRENT_REQUESTS),
  };
}

function endpoint(env: DeployEnv): string {
  return `https://${env.accountId}.r2.cloudflarestorage.com`;
}

function runAwsCommand(
  args: string[],
  env: DeployEnv,
  failureContext: string,
  input?: string
): void {
  const result = spawnSync('aws', [...args, '--endpoint-url', endpoint(env)], {
    input,
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    env: awsEnv(env),
  });
  if (result.error) fail(`Failed to launch aws CLI: ${result.error.message}`);
  if (result.status !== 0)
    fail(`${failureContext} (aws exited with status ${result.status ?? 'unknown'})`);
}

function runAwsCommandAsync(args: string[], env: DeployEnv, failureContext: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('aws', [...args, '--endpoint-url', endpoint(env)], {
      stdio: 'inherit',
      env: awsEnv(env),
    });
    child.on('error', (error) => reject(new Error(`Failed to launch aws CLI: ${error.message}`)));
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${failureContext} (aws exited with status ${code ?? 'unknown'})`))
    );
  });
}

function captureAws(args: string[], env: DeployEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('aws', [...args, '--endpoint-url', endpoint(env)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: awsEnv(env),
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(new Error(`Failed to launch aws CLI: ${error.message}`)));
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`aws exited with status ${code ?? 'unknown'}: ${stderr.trim()}`))
    );
  });
}

function headObject(env: DeployEnv, key: string): Promise<boolean> {
  return captureAws(['s3api', 'head-object', '--bucket', env.bucketName, '--key', key], env)
    .then(() => true)
    .catch((error: Error) => {
      if (/status (1|254)\b/.test(error.message)) return false;
      throw error;
    });
}

export function ensureOutDir(): void {
  if (!fs.existsSync(path.join(process.cwd(), 'out')))
    fail('The `out/` directory does not exist. Run `npm run build` first.');
}

function ensureDir(dirPath: string, label: string): void {
  if (!fs.existsSync(dirPath))
    fail(`The ${label} directory does not exist at ${dirPath}. Run the corpus build first.`);
}

export function buildRepoBucketPrefix(
  bucketName: string,
  repo: { owner: string; repo: string; revision: string }
): string {
  return `s3://${bucketName}/repos/${repo.owner}/${repo.repo}/${repo.revision}/`;
}
export function buildRepoManifestKey(repo: {
  owner: string;
  repo: string;
  revision: string;
}): string {
  return `repos/${repo.owner}/${repo.repo}/${repo.revision}/repo-manifest.json`;
}
export function buildRepoCodeIndexKey(repo: {
  owner: string;
  repo: string;
  revision: string;
}): string {
  return `repos/${repo.owner}/${repo.repo}/${repo.revision}/code-index.sqlite`;
}
export function buildRepoRequiredArtifactKeys(repo: {
  owner: string;
  repo: string;
  revision: string;
}): string[] {
  return [buildRepoManifestKey(repo), buildRepoCodeIndexKey(repo)];
}
export function buildRepoSyncArgs(repoDir: string, bucketPrefix: string): string[] {
  return ['s3', 'sync', `${repoDir}/`, bucketPrefix, '--no-progress', ...R2_SYNC_COMPARISON_ARGS];
}
export function buildBulkCorpusSyncArgs(repoDir: string, bucketName: string): string[] {
  return [
    's3',
    'sync',
    `${repoDir.replace(/\/$/, '')}/`,
    `s3://${bucketName}/repos/`,
    '--no-progress',
    ...R2_SYNC_COMPARISON_ARGS,
  ];
}
export function buildDeploymentManifestKey(): string {
  return DEPLOYMENT_MANIFEST_KEY;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildCanonicalDeploymentPayload(
  repositories: Array<{
    id: string;
    owner: string;
    repo: string;
    revision: string;
    buildSignature: string;
  }>,
  schemaVersion = DEPLOYMENT_MANIFEST_SCHEMA_VERSION
): CanonicalDeploymentPayload {
  return {
    schemaVersion,
    repositories: [...repositories]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((repo) => ({ ...repo })),
  };
}
export function computeDeploymentSignature(payload: CanonicalDeploymentPayload): string {
  return sha256(stableJson(payload));
}
export function buildDeploymentManifest(
  payload: CanonicalDeploymentPayload,
  artifactCounts: DeploymentArtifactCounts,
  generatedAt = new Date().toISOString()
): DeploymentManifest {
  return {
    ...payload,
    deploymentSignature: computeDeploymentSignature(payload),
    artifactCounts,
    generatedAt,
  };
}

function countFiles(dirPath: string): number {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .reduce(
      (total, entry) =>
        total + (entry.isDirectory() ? countFiles(path.join(dirPath, entry.name)) : 1),
      0
    );
}
function directorySizeBytes(dirPath: string): number {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .reduce(
      (total, entry) =>
        total +
        (entry.isDirectory()
          ? directorySizeBytes(path.join(dirPath, entry.name))
          : fs.statSync(path.join(dirPath, entry.name)).size),
      0
    );
}
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1)
    fail(`Invalid ${name}: expected a positive integer, received "${raw}"`);
  return value;
}
function retryAttempts(): number {
  return readPositiveIntEnv('R2_DEPLOY_RETRY_ATTEMPTS', DEFAULT_R2_RETRY_ATTEMPTS);
}
function retryDelay(): number {
  return readPositiveIntEnv('R2_DEPLOY_RETRY_BASE_DELAY_MS', DEFAULT_R2_RETRY_BASE_DELAY_MS);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRetries<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const attempts = retryAttempts();
  const delay = retryDelay();
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      if (attempt < attempts) await sleep(delay * 2 ** (attempt - 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
async function withConcurrency(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  const queue = [...tasks];
  async function worker() {
    while (queue.length) {
      const task = queue.shift();
      if (task) await task();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

function localRepoSignature(repo: Repo): string {
  const dir = path.join(CORPUS_REPOS_DIR, repo.owner, repo.repo, repo.revision);
  const manifestPath = path.join(dir, 'repo-manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RepoManifest;
    if (!Array.isArray(manifest.tree)) throw new Error('missing tree');
    return getCorpusBuildSignature(repo, manifest.tree);
  } catch {
    fail(`Invalid or missing repository manifest: ${manifestPath}`);
  }
}
function validateLocalArtifacts(): {
  payload: CanonicalDeploymentPayload;
  counts: DeploymentArtifactCounts;
} {
  ensureDir(CORPUS_REPOS_DIR, 'corpus repos');
  const repositories = CURATED_REPOS.map((repo) => {
    const dir = path.join(CORPUS_REPOS_DIR, repo.owner, repo.repo, repo.revision);
    ensureDir(dir, `${repo.owner}/${repo.repo}@${repo.revision}`);
    for (const file of ['repo-manifest.json', 'code-index.sqlite'])
      if (!fs.existsSync(path.join(dir, file)))
        fail(`Missing local corpus artifact: ${path.join(dir, file)}`);
    return {
      id: repo.id,
      owner: repo.owner,
      repo: repo.repo,
      revision: repo.revision,
      buildSignature: localRepoSignature(repo),
    };
  });
  const payload = buildCanonicalDeploymentPayload(repositories);
  return {
    payload,
    counts: {
      corpusFiles: countFiles(CORPUS_REPOS_DIR),
      corpusBytes: directorySizeBytes(CORPUS_REPOS_DIR),
    },
  };
}

async function readRemoteDeploymentManifest(env: DeployEnv): Promise<DeploymentManifest | null> {
  try {
    return JSON.parse(
      await captureAws(['s3', 'cp', `s3://${env.bucketName}/${DEPLOYMENT_MANIFEST_KEY}`, '-'], env)
    ) as DeploymentManifest;
  } catch {
    return null;
  }
}
async function verifyArtifacts(env: DeployEnv): Promise<void> {
  const keys = CURATED_REPOS.flatMap(buildRepoRequiredArtifactKeys);
  const missing: string[] = [];
  await withConcurrency(
    keys.map((key) => async () => {
      if (!(await withRetries(`verify ${key}`, () => headObject(env, key)))) missing.push(key);
    }),
    readPositiveIntEnv('R2_SYNC_CONCURRENCY', DEFAULT_R2_SYNC_CONCURRENCY)
  );
  if (missing.length) fail(`Missing uploaded artifact(s): ${missing.join(', ')}`);
}
async function syncPhase(args: string[], env: DeployEnv, label: string): Promise<void> {
  await runPhase(
    label,
    () => withRetries(label, () => runAwsCommandAsync(args, env, `${label} failed`)),
    ''
  );
}

export async function runAwsSync(env: DeployEnv): Promise<void> {
  const local = validateLocalArtifacts();
  const manifest = buildDeploymentManifest(local.payload, local.counts);
  const remote = await withRetries('deployment manifest read', () =>
    readRemoteDeploymentManifest(env)
  );
  const forcedVerify = process.env.R2_DEPLOY_VERIFY === '1';
  if (remote?.deploymentSignature === manifest.deploymentSignature) {
    if (forcedVerify) await verifyArtifacts(env);
    console.log(
      forcedVerify
        ? 'Deployment manifest matches; verification completed without uploads.'
        : 'Deployment manifest matches; skipping R2 uploads.'
    );
    return;
  }

  runAwsCommand(
    ['s3api', 'head-bucket', '--bucket', env.bucketName],
    env,
    `R2 bucket access preflight failed for s3://${env.bucketName}`
  );
  await withConcurrency(
    [
      () =>
        syncPhase(buildBulkCorpusSyncArgs(CORPUS_REPOS_DIR, env.bucketName), env, '📦 Sync corpus'),
    ],
    readPositiveIntEnv('R2_SYNC_CONCURRENCY', DEFAULT_R2_SYNC_CONCURRENCY)
  );
  await verifyArtifacts(env);
  runAwsCommand(
    [
      's3',
      'cp',
      '-',
      `s3://${env.bucketName}/${DEPLOYMENT_MANIFEST_KEY}`,
      '--content-type',
      'application/json',
    ],
    env,
    'Deployment manifest upload failed',
    `${JSON.stringify(manifest)}\n`
  );
}

async function main(): Promise<void> {
  loadDeployEnv();
  await runAwsSync(readR2Env());
  console.log('\nR2 deployment complete.');
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
