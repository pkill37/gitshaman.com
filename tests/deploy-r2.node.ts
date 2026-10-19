import { describe, test } from 'node:test';
import { expect } from '@playwright/test';

import { CODE_INDEX_VERSION } from '@/lib/code-index';
import { CURATED_REPOS } from '@/lib/curated-repos';
import { getCorpusBuildSignature } from '../scripts/corpus-build-signature';
import {
  buildRepoBucketPrefix,
  buildRepoCodeIndexKey,
  buildRepoManifestKey,
  buildRepoRequiredArtifactKeys,
  buildCanonicalDeploymentPayload,
  computeDeploymentSignature,
} from '../scripts/deploy-r2';

describe('R2 deploy', () => {
  test('builds repo object keys for every curated repo', () => {
    for (const repo of CURATED_REPOS) {
      expect(buildRepoBucketPrefix('explorar-repos', repo)).toBe(
        `s3://explorar-repos/repos/${repo.owner}/${repo.repo}/${repo.revision}/`
      );
      expect(buildRepoManifestKey(repo)).toBe(
        `repos/${repo.owner}/${repo.repo}/${repo.revision}/repo-manifest.json`
      );
      expect(buildRepoCodeIndexKey(repo)).toBe(
        `repos/${repo.owner}/${repo.repo}/${repo.revision}/code-index.sqlite`
      );
      expect(buildRepoRequiredArtifactKeys(repo)).toEqual([
        `repos/${repo.owner}/${repo.repo}/${repo.revision}/repo-manifest.json`,
        `repos/${repo.owner}/${repo.repo}/${repo.revision}/code-index.sqlite`,
      ]);
    }
  });

  test('canonical deployment signatures are order-independent but content-sensitive', () => {
    const repoA = {
      id: 'a',
      owner: 'owner-a',
      repo: 'repo-a',
      revision: 'one',
      buildSignature: 'build-a',
    };
    const repoB = {
      id: 'b',
      owner: 'owner-b',
      repo: 'repo-b',
      revision: 'two',
      buildSignature: 'build-b',
    };
    const payload = buildCanonicalDeploymentPayload([repoA, repoB]);
    expect(computeDeploymentSignature(payload)).toBe(
      computeDeploymentSignature(buildCanonicalDeploymentPayload([repoB, repoA]))
    );
    expect(
      computeDeploymentSignature(
        buildCanonicalDeploymentPayload([{ ...repoA, revision: 'changed' }, repoB])
      )
    ).not.toBe(computeDeploymentSignature(payload));
    expect(computeDeploymentSignature(buildCanonicalDeploymentPayload([repoA, repoB], 2))).not.toBe(
      computeDeploymentSignature(payload)
    );
  });

  test('corpus build signatures change when the generated tree changes', () => {
    const repo = {
      id: 'torvalds-linux',
      owner: 'torvalds',
      repo: 'linux',
      ref: 'v6.1',
      revision: 'v6.1',
      guideId: 'linux-kernel-guide',
    };

    const signatureA = getCorpusBuildSignature(repo, [
      {
        name: 'arch',
        type: 'd',
        children: [
          {
            name: 'arm64',
            type: 'd',
            children: [{ name: 'entry.S', type: 'f' }],
          },
        ],
      },
    ]);

    const signatureB = getCorpusBuildSignature(repo, [
      {
        name: 'arch',
        type: 'd',
        children: [
          {
            name: 'arm64',
            type: 'd',
            children: [
              { name: 'entry.S', type: 'f' },
              { name: 'entry.c', type: 'f' },
            ],
          },
        ],
      },
    ]);

    expect(signatureA).not.toBe(signatureB);
    expect(JSON.parse(signatureA)).toMatchObject({
      corpusBuildSignatureVersion: 1,
      searchIndexVersion: CODE_INDEX_VERSION,
      owner: 'torvalds',
      repo: 'linux',
      revision: 'v6.1',
    });
  });
});
