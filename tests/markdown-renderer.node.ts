import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { marked } from 'marked';
import { createRepoMarkdownRenderer } from '../src/lib/markdown-renderer';
import { listGuideMarkdownFiles } from '../scripts/guide-docs';

function render(content: string, linkRepoReferences = true) {
  return marked.parse(content, {
    renderer: createRepoMarkdownRenderer({ symbolScopePaths: ['Python/'], linkRepoReferences }),
  }) as string;
}

test('explicit links own their code labels without nested navigation or duplicate icons', () => {
  const labels = [
    '`pthread_create`',
    '**`pthread_create`**',
    'call `pthread_create` here',
    '`repo:bminor/glibc/nptl/pthread_create.c:pthread_create`',
  ];
  for (const label of labels) {
    for (const href of [
      'repo:bminor/glibc/nptl/pthread_create.c:pthread_create',
      'Python/thread_pthread.h#L50',
      'https://example.com',
      '#threads',
    ]) {
      const html = render(`[${label}](${href})`);
      assert.equal((html.match(/<a\b/g) ?? []).length, 1, html);
      assert.equal(
        (html.match(/external-repo-reference-icon/g) ?? []).length,
        href.startsWith('repo:') ? 1 : 0,
        html
      );
      assert.ok(html.includes('class="inline-code-link"'), html);
      assert.ok(!html.includes('data-symbol-scope'), html);
      if (href.startsWith('repo:')) {
        assert.ok(html.includes('data-search-pattern="pthread_create"'));
        assert.ok(html.includes('data-repo-owner="bminor"'));
      }
      if (href.includes('#L50')) assert.ok(html.includes('data-scroll-to-line="50"'));
    }
  }
});

test('standalone symbols and file references keep navigation; disabled links stay disabled', () => {
  assert.match(render('`pthread_create`'), /data-symbol-scope="Python\/"/);
  assert.match(render('`Python/thread_pthread.h`'), /data-repo-path="Python\/thread_pthread.h"/);
  assert.equal(
    (
      render('`repo:bminor/glibc/nptl/pthread_create.c`').match(/external-repo-reference-icon/g) ??
      []
    ).length,
    1
  );
  assert.ok(
    !render('[`pthread_create`](repo:bminor/glibc/nptl/pthread_create.c)', false).includes('<a')
  );
  assert.ok(!render('[`pthread_create`](javascript:alert)', true).includes('<a'));
});

test('all authored guide links have balanced, unnested anchors and at most one repository icon', () => {
  for (const file of listGuideMarkdownFiles()) {
    const html = render(fs.readFileSync(`docs/${file}`, 'utf8'));
    let depth = 0;
    for (const match of html.matchAll(/<a\b[^>]*>|<\/a>/g)) {
      depth += match[0] === '</a>' ? -1 : 1;
      assert.ok(depth >= 0 && depth <= 1, `${file}: nested or unbalanced anchor`);
    }
    assert.equal(depth, 0, file);
    for (const match of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)) {
      assert.ok(
        (match[0].match(/external-repo-reference-icon/g) ?? []).length <= 1,
        `${file}: duplicate icon`
      );
      if (match[0].includes('<code>'))
        assert.ok(match[0].includes('class="inline-code-link"'), `${file}: unstyled code link`);
    }
  }
});
