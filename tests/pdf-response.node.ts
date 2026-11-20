import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRepositoryFileResponse } from '../src/lib/file-fetch-debug';

test('PDF responses retain binary bytes regardless of the server content type', async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 128, 255]);
  const result = await readRepositoryFileResponse(new Response(bytes), 'docs/Manual.PDF');
  assert.equal(result.content, '');
  assert.equal(result.blob?.type, 'application/pdf');
  assert.deepEqual(new Uint8Array(await result.blob!.arrayBuffer()), bytes);
});

test('source files still decode as text', async () => {
  assert.deepEqual(await readRepositoryFileResponse(new Response('puts "hello"'), 'main.tcl'), {
    content: 'puts "hello"',
  });
});
