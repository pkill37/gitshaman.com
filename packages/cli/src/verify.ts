import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CODE_INDEX_VERSION } from '../../../src/lib/code-index';
import { readJson, readConfig, sha256, safeRelative } from './repository';
import { currentGeneration } from './analysis';
import { embeddingSignature, validateVectors } from './embeddings';

export function verify(root: string, dist: string): Record<string, unknown> {
  const manifestPath = path.join(dist, 'integrity.json');
  if (!fs.existsSync(manifestPath))
    throw new Error('Package integrity manifest is missing. Rebuild or reinstall the CLI.');
  const manifest = readJson<Record<string, string>>(manifestPath);
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    !Object.keys(manifest).length
  )
    throw new Error('Package integrity manifest is invalid. Rebuild or reinstall the CLI.');
  for (const [file, hash] of Object.entries(manifest)) {
    let valid = false;
    try {
      valid =
        safeRelative(file) &&
        typeof hash === 'string' &&
        /^[a-f0-9]{64}$/.test(hash) &&
        fs.realpathSync(path.join(dist, file)).startsWith(`${fs.realpathSync(dist)}${path.sep}`) &&
        sha256(fs.readFileSync(path.join(dist, file))) === hash;
    } catch {
      /* Missing or unreadable assets fail verification. */
    }
    if (!valid) throw new Error(`Packaged asset integrity check failed: ${file}`);
  }
  const { directory, snapshot } = currentGeneration(root);
  const index = new Database(path.join(directory, 'code-index.sqlite'), { readonly: true });
  let retrieval: InstanceType<typeof Database> | undefined;
  try {
    retrieval = new Database(path.join(directory, 'retrieval.sqlite'), { readonly: true });
    for (const db of [index, retrieval])
      if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
        throw new Error('SQLite integrity check failed. Run analyze --force.');
    const metadata = index.prepare('SELECT Version, BuildSignature FROM Metadata').get();
    if (metadata?.Version !== CODE_INDEX_VERSION || metadata.BuildSignature !== snapshot.signature)
      throw new Error('Index metadata does not match the snapshot. Run analyze --force.');
    const vectors = retrieval.prepare('SELECT Vector FROM Vectors').all();
    const embedding = retrieval.prepare('SELECT * FROM EmbeddingMetadata').get();
    const count = Number(retrieval.prepare('SELECT count(*) AS count FROM Chunks').get()?.count);
    if (embedding) {
      if (embedding.Signature !== embeddingSignature(readConfig(root)) || vectors.length !== count)
        throw new Error('Embeddings are incompatible or incomplete. Run gitshaman embed.');
      validateVectors(
        vectors.map((row) => JSON.parse(String(row.Vector))),
        count,
        Number(embedding.Dimension)
      );
    } else if (vectors.length) throw new Error('Embedding metadata is missing.');
    return {
      ok: true,
      assets: Object.keys(manifest).length,
      indexVersion: CODE_INDEX_VERSION,
      embeddings: embedding ? 'ready' : 'unavailable',
    };
  } finally {
    index.close();
    retrieval?.close();
  }
}
