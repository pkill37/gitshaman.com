#!/usr/bin/env node
/** Deploy the generated corpus to Cloudflare R2. */

import { createHash } from 'crypto';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

import { loadDeployEnv } from './deploy-env';
import { getCorpusBuildSignature, type CorpusBuildTreeNode } from './corpus-build-signature';
import { CORPUS_REPOS_DIR } from './static-asset-paths';
import { CURATED_REPOS } from '../src/lib/curated-repos';
import { runPhase } from './tqdm';
import {
  scanArtifacts,
  selectUploads,
  type PublishedInventory,
  type RemoteArtifact,
} from './deploy-inventory';

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
      console.warn(`${label}: attempt ${attempt}/${attempts} failed: ${String(error)}`);
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
async function readRemoteJson(env: DeployEnv, key: string): Promise<unknown> {
  return withRetries(`read ${key}`, async () => {
    let raw: string;
    try {
      raw = await captureAws(['s3', 'cp', `s3://${env.bucketName}/${key}`, '-'], env);
    } catch (error) {
      if (/\(404\)|\(NoSuchKey\)/.test(String(error))) return null;
      throw error;
    }
    return JSON.parse(raw);
  });
}

async function readPublishedInventory(env: DeployEnv, key: string): Promise<PublishedInventory> {
  const inventory = (await readRemoteJson(env, key)) as {
    schemaVersion: number;
    files: PublishedInventory;
  } | null;
  if (inventory === null) return {};
  if (inventory.schemaVersion !== 1 || !inventory.files || typeof inventory.files !== 'object')
    throw new Error(`Invalid deployment inventory: ${key}`);
  return inventory.files as PublishedInventory;
}

async function listRemoteArtifacts(
  env: DeployEnv,
  prefix: string
): Promise<Record<string, RemoteArtifact>> {
  const files: Record<string, RemoteArtifact> = Object.create(null);
  // Let the CLI paginate inside one process, and return only comparison fields.
  const args = [
    's3api',
    'list-objects-v2',
    '--bucket',
    env.bucketName,
    '--prefix',
    prefix,
    '--output',
    'json',
    '--query',
    'Contents[].[Key,Size,ETag]',
  ];
  const objects = JSON.parse(await withRetries(`list ${prefix}`, () => captureAws(args, env))) as
    [string, number, string][] | null;
  for (const [key, size, etag] of objects ?? []) {
    files[key.slice(prefix.length)] = { size, etag: etag.replaceAll('"', '') };
  }
  return files;
}
async function syncPhase(args: string[], env: DeployEnv, label: string): Promise<void> {
  await runPhase(
    label,
    () => withRetries(label, () => runAwsCommandAsync(args, env, `${label} failed`)),
    ''
  );
}

export async function runAwsSync(env: DeployEnv): Promise<void> {
  const started = Date.now();
  ensureDir(CORPUS_REPOS_DIR, 'corpus repos');
  const repositories = CURATED_REPOS.map((repo) => {
    const dir = path.join(CORPUS_REPOS_DIR, repo.owner, repo.repo, repo.revision);
    for (const file of ['repo-manifest.json', 'code-index.sqlite']) {
      if (!fs.existsSync(path.join(dir, file)))
        fail(
          `Missing local corpus artifact: ${path.join(dir, file)}. Run npm run corpus:sync first.`
        );
    }
    return {
      id: repo.id,
      owner: repo.owner,
      repo: repo.repo,
      revision: repo.revision,
      buildSignature: localRepoSignature(repo),
    };
  });
  runAwsCommand(
    ['s3api', 'head-bucket', '--bucket', env.bucketName],
    env,
    `R2 bucket access preflight failed for s3://${env.bucketName}`
  );
  const counts = { corpusFiles: 0, corpusBytes: 0 };
  let uploaded = 0;
  let uploadedBytes = 0;
  await withConcurrency(
    CURATED_REPOS.map((repo) => async () => {
      const label = `${repo.owner}/${repo.repo}@${repo.revision}`;
      const prefix = `repos/${repo.owner}/${repo.repo}/${repo.revision}/`;
      const inventoryKey = `deployments/inventory/${repo.owner}/${repo.repo}/${repo.revision}.json`;
      const dir = path.join(CORPUS_REPOS_DIR, repo.owner, repo.repo, repo.revision);
      const scanStarted = Date.now();
      console.log(`[${label}] scanning local hashes and remote inventory…`);
      const [local, remote, published] = await Promise.all([
        scanArtifacts(
          dir,
          path.join(
            process.cwd(),
            '.cache',
            'r2-deploy',
            repo.owner,
            repo.repo,
            `${repo.revision}.json`
          ),
          process.env.R2_DEPLOY_VERIFY === '1'
        ),
        listRemoteArtifacts(env, prefix),
        readPublishedInventory(env, inventoryKey),
      ]);
      const keys = Object.keys(local.files);
      const changed = selectUploads(local.files, remote, published);
      counts.corpusFiles += keys.length;
      counts.corpusBytes += local.bytes;
      console.log(
        `[${label}] scan ${((Date.now() - scanStarted) / 1000).toFixed(1)}s; ${local.hashed} hashed; ${changed.length} to upload; ${keys.length - changed.length} unchanged`
      );
      let verified = remote;
      if (changed.length) {
        const uploadStarted = Date.now();
        const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'r2-deploy-'));
        try {
          // Stage only the diff. Recursive cp deliberately uploads same-size edits,
          // and uses one AWS transfer pool instead of one process per file.
          const source = changed.length === keys.length ? dir : staging;
          if (source === staging) {
            for (const key of changed) {
              const target = path.join(staging, key);
              await fs.promises.mkdir(path.dirname(target), { recursive: true });
              await fs.promises.symlink(path.join(dir, key), target);
            }
          }
          await syncPhase(
            [
              's3',
              'cp',
              `${source}/`,
              buildRepoBucketPrefix(env.bucketName, repo),
              '--recursive',
              '--follow-symlinks',
              '--no-progress',
            ],
            env,
            `Upload ${label}`
          );
        } finally {
          await fs.promises.rm(staging, { recursive: true, force: true });
        }
        console.log(`[${label}] upload ${((Date.now() - uploadStarted) / 1000).toFixed(1)}s`);
        const verifyStarted = Date.now();
        verified = await listRemoteArtifacts(env, prefix);
        for (const key of keys) {
          const object = verified[key];
          if (
            !object ||
            object.size !== local.files[key].size ||
            (/^[a-f0-9]{32}$/i.test(object.etag) &&
              object.etag.toLowerCase() !== local.files[key].hash)
          )
            throw new Error(`Uploaded artifact verification failed: ${prefix}${key}`);
        }
        console.log(`[${label}] verification ${((Date.now() - verifyStarted) / 1000).toFixed(1)}s`);
        uploaded += changed.length;
        uploadedBytes += changed.reduce((sum, key) => sum + local.files[key].size, 0);
      }
      const inventory: PublishedInventory = Object.create(null);
      for (const key of keys) inventory[key] = { ...local.files[key], etag: verified[key].etag };
      if (
        Object.keys(published).length !== keys.length ||
        keys.some(
          (key) =>
            published[key]?.size !== inventory[key].size ||
            published[key]?.hash !== inventory[key].hash ||
            published[key]?.etag !== inventory[key].etag
        )
      ) {
        runAwsCommand(
          [
            's3',
            'cp',
            '-',
            `s3://${env.bucketName}/${inventoryKey}`,
            '--content-type',
            'application/json',
          ],
          env,
          `Inventory upload failed for ${label}`,
          JSON.stringify({ schemaVersion: 1, files: inventory })
        );
      }
    }),
    readPositiveIntEnv('R2_SYNC_CONCURRENCY', DEFAULT_R2_SYNC_CONCURRENCY)
  );
  const manifest = buildDeploymentManifest(buildCanonicalDeploymentPayload(repositories), counts);
  const previousManifest = (await readRemoteJson(
    env,
    DEPLOYMENT_MANIFEST_KEY
  )) as DeploymentManifest | null;
  // generatedAt records a manifest change, not each invocation of deploy.
  if (previousManifest && typeof previousManifest.generatedAt === 'string') {
    manifest.generatedAt = previousManifest.generatedAt;
  }
  if (JSON.stringify(previousManifest) !== JSON.stringify(manifest)) {
    manifest.generatedAt = new Date().toISOString();
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
  console.log(
    `Corpus: ${uploaded} uploaded (${uploadedBytes.toLocaleString()} bytes), ${counts.corpusFiles - uploaded} unchanged; total ${((Date.now() - started) / 1000).toFixed(1)}s.`
  );
}

async function main(): Promise<void> {
  loadDeployEnv();
  await runAwsSync(readR2Env());
  console.log('\nR2 deployment complete.');
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
