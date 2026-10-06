import { expect, test } from '@playwright/test';

import { CODE_INDEX_VERSION } from '@/lib/code-index';
import { CURATED_REPOS } from '@/lib/curated-repos';
import { getCorpusBuildSignature } from '../scripts/corpus-build-signature';
import {
  buildRepoBucketPrefix,
  buildRepoCodeIndexKey,
  buildRepoManifestKey,
  buildRepoRequiredArtifactKeys,
  buildRepoSyncArgs,
  buildBulkCorpusSyncArgs,
  buildCanonicalDeploymentPayload,
  computeDeploymentSignature,
} from '../scripts/deploy-r2';

test.describe('R2 deploy', () => {
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

  test('sync args are incremental and non-destructive', () => {
    const args = buildRepoSyncArgs(
      '/tmp/explorar-repos/littlekernel/lk/a521fe60e1a16d5670fe24b7fca2c5155b3339c4',
      's3://explorar-repos/repos/littlekernel/lk/a521fe60e1a16d5670fe24b7fca2c5155b3339c4/'
    );

    expect(args).toEqual([
      's3',
      'sync',
      '/tmp/explorar-repos/littlekernel/lk/a521fe60e1a16d5670fe24b7fca2c5155b3339c4/',
      's3://explorar-repos/repos/littlekernel/lk/a521fe60e1a16d5670fe24b7fca2c5155b3339c4/',
      '--no-progress',
      '--size-only',
    ]);
    expect(args).not.toContain('--delete');
  });

  test('builds one non-destructive bulk corpus sync', () => {
    expect(buildBulkCorpusSyncArgs('/tmp/repos', 'explorar-repos')).toEqual([
      's3',
      'sync',
      '/tmp/repos/',
      's3://explorar-repos/repos/',
      '--no-progress',
      '--size-only',
    ]);
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
