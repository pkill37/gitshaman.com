import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMakefilePath } from '../src/lib/monaco-makefile';

test('recognizes Makefile names and includes throughout repository paths', () => {
  for (const path of [
    'Makefile',
    'src/Makefile',
    'src/makefile',
    'build/GNUmakefile',
    'nt/base/makefil0',
    'nt/base/MAKEFIL0',
    'build/Makefile.in',
    'build/Makefile.am',
    'build/rules.mk',
    'build/RULES.MK',
    'nt\\base\\makefil0',
  ]) {
    assert.equal(isMakefilePath(path), true, path);
  }
  for (const path of ['src/main.c', 'Makefile/main.c', 'CMakeLists.txt']) {
    assert.equal(isMakefilePath(path), false, path);
  }
});
