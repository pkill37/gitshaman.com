import crypto from 'node:crypto';

import { CODE_INDEX_VERSION } from '../src/lib/code-index';
import type { CuratedRepoConfig } from '../src/lib/curated-repos';

const CORPUS_BUILD_SIGNATURE_VERSION = 1;

export type CorpusBuildTreeNode = {
  name: string;
  type: 'file' | 'directory' | 'f' | 'd';
  children?: readonly CorpusBuildTreeNode[];
};

type CorpusBuildIdentity = Pick<
  CuratedRepoConfig,
  'id' | 'owner' | 'repo' | 'ref' | 'revision' | 'guideId'
> & { contribution?: CuratedRepoConfig['contribution'] };

type NormalizedCorpusBuildTreeNode = {
  name: string;
  type: 'f' | 'd';
  children?: NormalizedCorpusBuildTreeNode[];
};

function normalizeTreeNode(node: CorpusBuildTreeNode): NormalizedCorpusBuildTreeNode {
  const type = node.type === 'directory' || node.type === 'd' ? 'd' : 'f';
  const normalized: NormalizedCorpusBuildTreeNode = {
    name: node.name,
    type,
  };

  if (node.children?.length) {
    normalized.children = node.children.map(normalizeTreeNode);
  }

  return normalized;
}

function computeCorpusTreeFingerprint(tree: readonly CorpusBuildTreeNode[]): string {
  const normalizedTree = tree.map(normalizeTreeNode);
  return crypto.createHash('sha256').update(JSON.stringify(normalizedTree)).digest('hex');
}

export function getCorpusBuildSignature(
  config: CorpusBuildIdentity,
  tree: readonly CorpusBuildTreeNode[]
): string {
  return JSON.stringify({
    corpusBuildSignatureVersion: CORPUS_BUILD_SIGNATURE_VERSION,
    searchIndexVersion: CODE_INDEX_VERSION,
    id: config.id,
    owner: config.owner,
    repo: config.repo,
    ref: config.ref,
    revision: config.revision,
    guideId: config.guideId,
    ...(config.contribution
      ? {
          analysis: config.contribution.analysis,
          analyzerVersion: config.contribution.analyzerVersion,
        }
      : {}),
    treeFingerprint: computeCorpusTreeFingerprint(tree),
  });
}
