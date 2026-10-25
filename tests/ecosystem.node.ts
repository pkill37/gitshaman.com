import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { extractReferences, generateEcosystemIndex } from '../scripts/ecosystem-index';
import { parseRepoNavigationTarget } from '../src/lib/markdown-navigation';
import { ecosystem, sharedLesson } from '../src/features/ecosystem/data';
import { mergeRelationships, neighborhood } from '../src/features/ecosystem/model';

test('extracts prose, reference links and recommendations with chapter and target provenance', () => {
  const raw = `---
owner: python
repo: cpython
---
---
id: ch2
fileRecommendations:
  source:
    - path: repo:bminor/glibc/malloc/malloc.c:__libc_malloc
---
[allocation](repo:bminor/glibc/malloc/malloc.c:__libc_malloc)
[again][alloc]

[alloc]: repo:bminor/glibc/malloc/malloc.c:__libc_malloc
[read](repo:torvalds/linux/fs/read_write.c#L621)
\`\`\`md
[ignored](repo:golang/go/src/runtime/proc.go)
\`\`\`
---
## References
A horizontal rule does not start metadata.
`;
  const refs = extractReferences(raw, 'test.md');
  assert.equal(refs.length, 2);
  const allocations = refs.find((edge) => edge.to === 'bminor/glibc')!;
  assert.equal(allocations.kind, 'reference');
  assert.equal(allocations.sources.length, 3);
  assert.equal(allocations.sources[0].kind, 'recommendation');
  assert.equal(allocations.sources[0].line, 9);
  assert.equal(allocations.sources[1].line, 11);
  assert.ok(
    allocations.sources.every(
      (source) => source.chapter === 'ch2' && source.target?.searchPattern === '__libc_malloc'
    )
  );
  assert.equal(refs[1].sources[0].target?.scrollToLine, 621);
  assert.equal(mergeRelationships([...refs, ...refs])[0].sources.length, 3);
});
test('neighborhood includes immediate incoming and outgoing relationships only', () => {
  const selected = neighborhood(ecosystem, 'bminor/glibc');
  assert.ok(selected.nodes.some((node) => node.id === 'python/cpython'));
  assert.ok(selected.nodes.some((node) => node.id === 'torvalds/linux'));
  assert.ok(!selected.nodes.some((node) => node.id === 'rust'));
  assert.ok(
    selected.relationships.every(
      (edge) => edge.from === 'bminor/glibc' || edge.to === 'bminor/glibc'
    )
  );
  assert.equal(
    neighborhood(ecosystem, 'freertos/freertos-kernel').nodes[0]?.id,
    'freertos/freertos-kernel'
  );
  assert.equal(ecosystem.nodes.find((node) => node.id === 'rust')?.repository, undefined);
  assert.equal(ecosystem.nodes.find((node) => node.id === 'swift')?.repository, undefined);
});
test('generation is deterministic and excludes raw guide prose', () => {
  generateEcosystemIndex();
  const first = fs.readFileSync('src/features/ecosystem/generated-index.json', 'utf8');
  generateEcosystemIndex();
  assert.equal(fs.readFileSync('src/features/ecosystem/generated-index.json', 'utf8'), first);
  assert.ok(!first.includes('Understanding glibc Before Code'));
});
test('technical source trails resolve to files at curated revisions', async () => {
  const { CURATED_REPOS } = await import('../src/lib/curated-repos');
  for (const edge of ecosystem.relationships.filter((edge) => edge.kind !== 'reference')) {
    for (const source of edge.sources) {
      if (!source.target) continue;
      const repo = CURATED_REPOS.find(
        (repo) => repo.owner === source.target!.owner && repo.repo === source.target!.repo
      )!;
      const path = `repos/${repo.owner}/${repo.repo}/${repo.revision}/${source.target.path}`;
      if (!fs.existsSync(`repos/${repo.owner}/${repo.repo}/${repo.revision}`)) continue;
      assert.ok(fs.existsSync(path), path);
      if (source.target.searchPattern)
        assert.ok(
          fs.readFileSync(path, 'utf8').includes(source.target.searchPattern),
          source.target.searchPattern
        );
    }
  }
});

test('shared lesson targets resolve against the curated source snapshots', async () => {
  const { CURATED_REPOS } = await import('../src/lib/curated-repos');
  const targets = [...sharedLesson.matchAll(/\]\((repo:[^)]+)\)/g)].map((match) =>
    parseRepoNavigationTarget(match[1])!
  );
  assert.ok(targets.length >= 12);
  for (const target of targets) {
    assert.ok(target);
    const repo = CURATED_REPOS.find(
      (repo) => repo.owner === target.owner && repo.repo === target.repo
    )!;
    const root = `repos/${repo.owner}/${repo.repo}/${repo.revision}`;
    if (!fs.existsSync(root)) continue;
    assert.ok(fs.existsSync(`${root}/${target.path}`), target.path);
    if (target.searchPattern)
      assert.ok(fs.readFileSync(`${root}/${target.path}`, 'utf8').includes(target.searchPattern));
  }
});
