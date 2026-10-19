import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type LocalArtifact = { size: number; hash: string };
export type RemoteArtifact = { size: number; etag: string };
export type PublishedArtifact = LocalArtifact & { etag: string };
export type PublishedInventory = Record<string, PublishedArtifact>;
type CachedArtifact = LocalArtifact & { stamp: string };

// Cache hashes, not upload decisions: remote inventory is checked on every run.
export async function scanArtifacts(dir: string, cachePath: string, forceHash = false) {
  let cache: Record<string, CachedArtifact> = {};
  try {
    cache = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
  } catch {
    // An absent or damaged local cache only requires rehashing.
  }
  const next: Record<string, CachedArtifact> = Object.create(null);
  const files: Record<string, LocalArtifact> = Object.create(null);
  let hashed = 0;
  let bytes = 0;
  async function walk(relative: string, ancestors = new Set<string>()): Promise<void> {
    const directory = path.join(dir, relative);
    const realDirectory = await fs.promises.realpath(directory);
    if (ancestors.has(realDirectory)) throw new Error(`Corpus directory cycle: ${directory}`);
    const nextAncestors = new Set(ancestors).add(realDirectory);
    for (const entry of await fs.promises.readdir(path.join(dir, relative), {
      withFileTypes: true,
    })) {
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      const filename = path.join(dir, key);
      // Match the uploader's --follow-symlinks behavior for files and directories.
      const stat = await fs.promises.stat(filename, { bigint: true });
      if (stat.isDirectory()) {
        await walk(key, nextAncestors);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Unsupported corpus entry: ${filename}`);
      const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      let hash = cache?.[key]?.stamp === stamp && !forceHash ? cache[key].hash : undefined;
      if (!hash) {
        const digest = createHash('md5');
        for await (const chunk of fs.createReadStream(filename)) digest.update(chunk);
        hash = digest.digest('hex');
        const after = await fs.promises.stat(filename, { bigint: true });
        if (`${after.dev}:${after.ino}:${after.size}:${after.mtimeNs}:${after.ctimeNs}` !== stamp)
          throw new Error(`Corpus changed during hashing: ${filename}`);
        hashed++;
      }
      const artifact = { size: Number(stat.size), hash };
      files[key] = artifact;
      next[key] = { ...artifact, stamp };
      bytes += artifact.size;
    }
  }
  await walk('');
  await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(next));
  await fs.promises.rename(temporary, cachePath);
  return { files, hashed, bytes };
}

export function needsUpload(
  local: LocalArtifact,
  remote: RemoteArtifact | undefined,
  published: PublishedArtifact | undefined
): boolean {
  if (!remote || remote.size !== local.size) return true;
  // Single-part S3/R2 ETags are MD5s. Multipart ETags are not content hashes;
  // only trust those when a successful previous deployment recorded that ETag.
  if (/^[a-f0-9]{32}$/i.test(remote.etag)) return remote.etag.toLowerCase() !== local.hash;
  return !published || published.hash !== local.hash || published.etag !== remote.etag;
}

export function selectUploads(
  local: Record<string, LocalArtifact>,
  remote: Record<string, RemoteArtifact>,
  published: PublishedInventory
): string[] {
  return Object.keys(local).filter((key) => needsUpload(local[key], remote[key], published[key]));
}
