import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { STATE, sha256, type Config } from './repository';

export function embeddingSignature(config: Config): string {
  return sha256(
    JSON.stringify({
      provider: config.embeddings.provider,
      endpoint: config.embeddings.endpoint,
      model: config.embeddings.model,
    })
  );
}

export function validateVectors(value: unknown, count: number, dimension?: number): number[][] {
  if (!Array.isArray(value) || value.length !== count)
    throw new Error('Embedding provider returned an incomplete batch.');
  let expected = dimension;
  return value.map((vector: unknown) => {
    if (
      !Array.isArray(vector) ||
      !vector.length ||
      vector.length > 65536 ||
      !vector.every((number) => typeof number === 'number' && Number.isFinite(number))
    )
      throw new Error('Embedding provider returned an invalid vector.');
    expected ??= vector.length;
    if (vector.length !== expected)
      throw new Error('Embedding dimensions changed. Rebuild embeddings with a consistent model.');
    const norm = Math.sqrt(
      vector.reduce((sum: number, number: number) => sum + number * number, 0)
    );
    if (!Number.isFinite(norm) || norm === 0)
      throw new Error('Embedding provider returned a zero or overflowing vector.');
    return vector.map((number: number) => number / norm);
  });
}

export async function embeddingRequest(
  config: Config,
  input: string[],
  signal?: AbortSignal
): Promise<number[][]> {
  const { provider, endpoint, model, apiKeyEnv } = config.embeddings;
  const key = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
  if (provider === 'openrouter' && !key)
    throw new Error(
      'Configure embeddings.apiKeyEnv and set that environment variable for OpenRouter.'
    );
  const url = `${endpoint.replace(/\/$/, '')}${provider === 'ollama' ? '/api/embed' : '/embeddings'}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          input,
          ...(provider === 'ollama' ? { truncate: false } : {}),
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
          : AbortSignal.timeout(60_000),
        redirect: 'error',
      });
    } catch {
      signal?.throwIfAborted();
      throw new Error(
        `Embedding provider unavailable. Check the endpoint and install the configured model (${model}).`
      );
    }
    if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 2) break;
    await response.body?.cancel();
    await delay(200 * 2 ** attempt, undefined, { signal });
  }
  if (!response?.ok) {
    await response?.body?.cancel();
    throw new Error(
      `Embedding request failed (HTTP ${response?.status ?? 'unknown'}). Check the configured model and provider credentials.`
    );
  }
  const body = (await response.json()) as {
    embeddings?: unknown;
    data?: Array<{ index: number; embedding: number[] }>;
  };
  const vectors =
    provider === 'ollama'
      ? body.embeddings
      : body.data
          ?.sort((a, b) => a.index - b.index)
          .map((entry, index) => {
            if (entry.index !== index)
              throw new Error('Embedding response has missing or duplicate indexes.');
            return entry.embedding;
          });
  return validateVectors(vectors, input.length);
}

export async function embedGeneration(
  root: string,
  directory: string,
  config: Config,
  signal?: AbortSignal
): Promise<{ chunks: number; reused: number; dimension: number }> {
  const original = path.join(directory, 'retrieval.sqlite');
  const temporary = path.join(directory, `vectors-${crypto.randomUUID()}.sqlite`);
  let db: InstanceType<typeof Database> | undefined;
  let cache: InstanceType<typeof Database> | undefined;
  const signature = embeddingSignature(config);
  let dimension: number | undefined;
  let reused = 0;
  try {
    fs.copyFileSync(original, temporary);
    db = new Database(temporary);
    cache = new Database(path.join(root, STATE, 'embedding-cache.sqlite'));
    cache.exec(
      'CREATE TABLE IF NOT EXISTS Embeddings(Signature TEXT NOT NULL, Hash TEXT NOT NULL, Vector TEXT NOT NULL, PRIMARY KEY(Signature, Hash));'
    );
    db.exec('DELETE FROM Vectors; DELETE FROM EmbeddingMetadata;');
    const chunks = db.prepare('SELECT Id, Hash, Content FROM Chunks ORDER BY Id').all();
    if (!chunks.length) throw new Error('No source chunks to embed.');
    const lookup = cache.prepare('SELECT Vector FROM Embeddings WHERE Signature = ? AND Hash = ?');
    const put = cache.prepare('INSERT OR REPLACE INTO Embeddings VALUES (?, ?, ?)');
    const insert = db.prepare('INSERT INTO Vectors VALUES (?, ?)');
    for (let offset = 0; offset < chunks.length; offset += 16) {
      signal?.throwIfAborted();
      const batch = chunks.slice(offset, offset + 16);
      const missing: typeof batch = [];
      for (const chunk of batch) {
        const hit = lookup.get(signature, chunk.Hash);
        if (!hit) {
          missing.push(chunk);
          continue;
        }
        const [vector] = validateVectors([JSON.parse(String(hit.Vector))], 1, dimension);
        dimension ??= vector.length;
        insert.run(chunk.Id, JSON.stringify(vector));
        reused++;
      }
      if (!missing.length) continue;
      const vectors = validateVectors(
        await embeddingRequest(
          config,
          missing.map((chunk) => String(chunk.Content)),
          signal
        ),
        missing.length,
        dimension
      );
      dimension ??= vectors[0].length;
      for (let index = 0; index < missing.length; index++) {
        const vector = JSON.stringify(vectors[index]);
        insert.run(missing[index].Id, vector);
        put.run(signature, missing[index].Hash, vector);
      }
    }
    db.prepare('INSERT INTO EmbeddingMetadata VALUES (?, ?)').run(signature, dimension);
    signal?.throwIfAborted();
    db.close();
    cache.close();
    fs.renameSync(temporary, original);
    return { chunks: chunks.length, reused, dimension: dimension! };
  } finally {
    try {
      db?.close();
    } catch {
      /* Already closed before atomic publication. */
    }
    try {
      cache?.close();
    } catch {
      /* Already closed. */
    }
    fs.rmSync(temporary, { force: true });
  }
}
