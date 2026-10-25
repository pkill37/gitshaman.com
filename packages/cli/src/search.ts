import path from 'node:path';
import Database from 'better-sqlite3';
import { embeddingRequest, embeddingSignature, validateVectors } from './embeddings';
import type { Config } from './repository';
import type { Snapshot } from './analysis';

export type SearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  provider: 'lexical' | 'semantic';
  snapshot: string;
};
function chunkSearchResult(
  row: Record<string, unknown>,
  score: number,
  provider: SearchResult['provider'],
  snapshot: string
): SearchResult {
  return {
    path: String(row.Path),
    startLine: Number(row.StartLine),
    endLine: Number(row.EndLine),
    snippet: String(row.Content),
    score,
    provider,
    snapshot,
  };
}

export async function search(
  directory: string,
  snapshot: Snapshot,
  config: Config,
  text: string,
  semantic = false,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  if (!text.trim() || text.length > 2000) throw new Error('Search requires 1–2000 characters.');
  const db = new Database(path.join(directory, 'retrieval.sqlite'), { readonly: true });
  try {
    const terms = text.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 20) ?? [];
    const rows = terms.length
      ? db
          .prepare(
            `SELECT c.*, bm25(ChunkSearch) AS Rank FROM ChunkSearch JOIN Chunks c ON c.Id = ChunkSearch.rowid WHERE ChunkSearch MATCH ? ORDER BY Rank LIMIT 100`
          )
          .bind(terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR '))
          .all()
      : [];
    const results = new Map<number, SearchResult>();
    rows.forEach((row, rank) =>
      results.set(
        Number(row.Id),
        chunkSearchResult(row, 1 / (rank + 1), 'lexical', snapshot.signature)
      )
    );
    if (semantic) {
      const metadata = db.prepare('SELECT * FROM EmbeddingMetadata').get();
      if (!metadata || metadata.Signature !== embeddingSignature(config))
        throw new Error('Compatible embeddings are unavailable. Run gitshaman embed.');
      const [vector] = validateVectors(
        await embeddingRequest(config, [text], signal),
        1,
        Number(metadata.Dimension)
      );
      const matches = db
        .prepare('SELECT c.*, v.Vector FROM Vectors v JOIN Chunks c ON c.Id = v.ChunkId')
        .all()
        .map((row) => {
          const [stored] = validateVectors([JSON.parse(String(row.Vector))], 1, vector.length);
          const score = stored.reduce((sum, value, index) => sum + value * vector[index], 0);
          return { row, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 30);
      for (const { row, score } of matches) {
        if (score < 0.15) continue;
        const existing = results.get(Number(row.Id));
        results.set(
          Number(row.Id),
          chunkSearchResult(row, score + (existing?.score ?? 0), 'semantic', snapshot.signature)
        );
      }
    }
    return [...results.values()].sort((a, b) => b.score - a.score).slice(0, 30);
  } finally {
    db.close();
  }
}
