import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { marked } from 'marked';
import { createRepoMarkdownRenderer } from '../src/lib/markdown-renderer';
import { listGuideMarkdownFiles } from '../scripts/guide-docs';
import { collectMarkdownRepoLinks } from '../src/lib/markdown-repo-links';

function render(content: string, linkRepoReferences = true) {
  return marked.parse(content, {
    renderer: createRepoMarkdownRenderer({ linkRepoReferences }),
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

test('inline snippets remain code even when they resemble files, versions, or symbols', () => {
  for (const snippet of [
    'pthread_create',
    'read(2)',
    'object.member',
    'thread.state',
    'android-17.0.0_r1',
    '/sbin/init',
    '/system/bin/init',
    'a/b',
    'Python/thread_pthread.h',
    'repo:bminor/glibc/nptl/pthread_create.c',
    '[example](missing.c)',
  ]) {
    const html = render(`\`${snippet}\``);
    assert.ok(html.includes('<code>'), html);
    assert.ok(!html.includes('<a'), html);
    assert.ok(!html.includes('data-repo-path'), html);
  }
});

test('authored navigation links work while disabled and unsafe links stay disabled', () => {
  assert.match(
    render('[`thread`](Python/thread_pthread.h)'),
    /data-repo-path="Python\/thread_pthread.h"/
  );
  assert.match(render('[`Kconfig`](Kconfig)'), /data-repo-path="Kconfig"/);
  assert.match(
    render('[`binding`](dts/bindings/gpio/nordic,nrf-gpio.yaml)'),
    /data-repo-path="dts\/bindings\/gpio\/nordic,nrf-gpio.yaml"/
  );
  assert.ok(
    !render('[`pthread_create`](repo:bminor/glibc/nptl/pthread_create.c)', false).includes('<a')
  );
  assert.ok(!render('[`pthread_create`](javascript:alert)', true).includes('<a'));
  assert.ok(
    !render('[`Python/thread_pthread.h`](Python/thread_pthread.h)').includes('data-search-pattern')
  );
  assert.ok(!render('[`Kconfig`](Kconfig)').includes('data-search-pattern'));
  assert.match(render('[contact](mailto:team@example.com)'), /href="mailto:team@example.com"/);
});

test('only explicit Markdown links contribute file recommendations, including reference links', () => {
  const markdown = [
    '`object.member` and `/sbin/init` and `missing/file.c`',
    '`[example](not-a-link.c)`',
    '[`function()`](real/file.c:function)',
    '[binding][gpio]',
    '[gpio]: dts/bindings/gpio/nordic,nrf-gpio.yaml',
    '![image](images/diagram.svg)',
    '![alt text with [an example](not-a-file.c)](images/diagram.svg)',
    '```md\n[example](another-example.c)\n```',
    '[external](https://example.com) and [section](#section) and [contact](mailto:team@example.com)',
  ].join('\n\n');
  assert.deepEqual(collectMarkdownRepoLinks(markdown), [
    { href: 'real/file.c:function', label: '`function()`' },
    { href: 'dts/bindings/gpio/nordic,nrf-gpio.yaml', label: 'binding' },
  ]);
});

test('file links inside lists, tables, and emphasized text still become recommendations', () => {
  assert.deepEqual(
    collectMarkdownRepoLinks(
      [
        '- [list entry](list.c)',
        '  - **[nested entry](nested.c)**',
        '',
        '| File |',
        '| --- |',
        '| [table entry](table.c) |',
        '',
        '> [quoted entry](quoted.c)',
      ].join('\n')
    ),
    [
      { href: 'list.c', label: 'list entry' },
      { href: 'nested.c', label: 'nested entry' },
      { href: 'table.c', label: 'table entry' },
      { href: 'quoted.c', label: 'quoted entry' },
    ]
  );
});

test('all authored guide links have balanced, unnested anchors and at most one repository icon', () => {
  for (const file of listGuideMarkdownFiles()) {
    const markdown = fs.readFileSync(`docs/${file}`, 'utf8');
    const html = render(markdown);
    assert.equal(
      (html.match(/data-repo-path=/g) ?? []).length,
      collectMarkdownRepoLinks(markdown).length,
      `${file}: navigation must come only from authored links`
    );
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
