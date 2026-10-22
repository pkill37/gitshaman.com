export interface CuratedContribution {
  version: 1;
  owner: string;
  repo: string;
  revision: string;
  slug: string;
  displayName: string;
  description: string;
  analyzerVersion: string;
  sourceFingerprint: string;
  analysis: { exclude: string[]; languages: string[]; enrichment: 'auto' | 'off' };
  summary: {
    fileCount: number;
    symbolCount: number;
    edgeCount: number;
    truncatedFileCount: number;
  };
  capabilities: Array<{ language: string; feature: string; provider: string; status: string }>;
  guideId?: string;
  guidePath?: string;
}

export function validateContribution(value: unknown): CuratedContribution {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Contribution must be an object.');
  const record = value as CuratedContribution;
  const keys = new Set([
    'version',
    'owner',
    'repo',
    'revision',
    'slug',
    'displayName',
    'description',
    'analyzerVersion',
    'sourceFingerprint',
    'analysis',
    'summary',
    'capabilities',
    'guideId',
    'guidePath',
  ]);
  if (Object.keys(record).some((key) => !keys.has(key)))
    throw new Error('Contribution contains unsupported fields.');
  if (
    record.version !== 1 ||
    !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(record.owner) ||
    !/^[\w.-]{1,100}$/.test(record.repo) ||
    ['.', '..'].includes(record.repo) ||
    !/^[a-f0-9]{40}$/.test(record.revision) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.slug) ||
    record.slug.length > 100 ||
    typeof record.displayName !== 'string' ||
    !record.displayName.trim() ||
    record.displayName.length > 120 ||
    typeof record.description !== 'string' ||
    !record.description.trim() ||
    record.description.length > 1000 ||
    typeof record.analyzerVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(record.analyzerVersion) ||
    !/^[a-f0-9]{64}$/.test(record.sourceFingerprint)
  ) {
    throw new Error('Invalid contribution identity, revision, display metadata, or fingerprint.');
  }
  const analysis = record.analysis;
  if (
    !analysis ||
    Object.keys(analysis).some((key) => !['exclude', 'languages', 'enrichment'].includes(key)) ||
    !Array.isArray(analysis.exclude) ||
    analysis.exclude.length > 200 ||
    !analysis.exclude.every(
      (pattern) =>
        typeof pattern === 'string' &&
        pattern.length <= 500 &&
        !pattern.includes('\0') &&
        !pattern.includes('\\') &&
        !pattern.split('/').includes('..')
    ) ||
    !Array.isArray(analysis.languages) ||
    analysis.languages.length > 30 ||
    !analysis.languages.every((name) => typeof name === 'string' && /^[a-z]+$/.test(name)) ||
    !['auto', 'off'].includes(analysis.enrichment)
  ) {
    throw new Error('Invalid portable analysis settings.');
  }
  const counts = ['fileCount', 'symbolCount', 'edgeCount', 'truncatedFileCount'] as const;
  if (
    !record.summary ||
    Object.keys(record.summary).some((key) => !counts.includes(key as (typeof counts)[number])) ||
    !counts.every((key) => Number.isSafeInteger(record.summary[key]) && record.summary[key] >= 0)
  )
    throw new Error('Invalid analysis summary.');
  if (
    !Array.isArray(record.capabilities) ||
    record.capabilities.length > 100 ||
    !record.capabilities.every(
      (entry) =>
        entry &&
        Object.keys(entry).sort().join(',') === 'feature,language,provider,status' &&
        Object.values(entry).every(
          (text) => typeof text === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(text)
        ) &&
        ['available', 'partial', 'unavailable'].includes(entry.status)
    )
  )
    throw new Error('Invalid capability summary.');
  if (
    (record.guideId === undefined) !== (record.guidePath === undefined) ||
    (record.guideId !== undefined &&
      (!/^[a-z0-9-]+$/.test(record.guideId) ||
        !/^docs\/[a-zA-Z0-9_-]+\.md$/.test(record.guidePath!)))
  )
    throw new Error('Invalid guide reference.');
  return record;
}
