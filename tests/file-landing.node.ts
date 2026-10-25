import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPedagogicalLandingLine } from '../src/lib/file-landing';

test('RST glossary opens at its starred title, before code-like glossary examples', () => {
  const content =
    '.. _glossary:\n\n********\nGlossary\n********\n\n.. glossary::\n\n   callable\n      def example():\n          pass\n';
  assert.equal(findPedagogicalLandingLine('Doc/glossary.rst', content), 4);
});

test('documentation without a heading starts at the top instead of a code example', () => {
  for (const extension of ['rst', 'md', 'txt']) {
    assert.equal(
      findPedagogicalLandingLine(
        `intro.${extension}`,
        '\nIntroduction\n\ndef example():\n    pass\n'
      ),
      1
    );
  }
});

test('documentation headings and source definitions retain their landing positions', () => {
  assert.equal(findPedagogicalLandingLine('intro.md', 'Preamble\n\n# Introduction\n'), 3);
  assert.equal(
    findPedagogicalLandingLine('intro.rst', '.. label:\n\nIntroduction\n============\n'),
    3
  );
  assert.equal(findPedagogicalLandingLine('main.py', '# comment\n\ndef main():\n    pass\n'), 3);
});
