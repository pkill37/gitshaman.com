import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { parseFrontmatter } from '../src/lib/frontmatter';

test('parses nested guide metadata and preserves section delimiters in the body', () => {
  const body = '## Guide\n\n---\nid: chapter\ntitle: Chapter\n---\nText';
  const result = parseFrontmatter(
    '---\nowner: example\nlearningGoals:\n  - Read code\ntrace:\n  - path: src/main.c\n    description: Entry point\n---\n' +
      body
  );
  assert.deepEqual(result.data, {
    owner: 'example',
    learningGoals: ['Read code'],
    trace: [{ path: 'src/main.c', description: 'Entry point' }],
  });
  assert.equal(result.content, body);
});

test('handles absent, empty, and Windows frontmatter', () => {
  assert.deepEqual(parseFrontmatter('Text\n---\nText'), {
    data: {},
    content: 'Text\n---\nText',
  });
  assert.deepEqual(parseFrontmatter('---\n---\nBody'), { data: {}, content: 'Body' });
  assert.deepEqual(parseFrontmatter('\uFEFF---\r\nid: chapter\r\n---\r\nBody'), {
    data: { id: 'chapter' },
    content: 'Body',
  });
});

test('guide parser and document loader bundle for the browser without Node builtins', async () => {
  await build({
    entryPoints: ['src/features/guides/parser.tsx', 'src/features/guides/docs-loader.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    loader: { '.md': 'text' },
    outdir: '/tmp/gitshaman-frontmatter-test',
    write: false,
  });
});
