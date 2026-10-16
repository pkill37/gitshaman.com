#!/usr/bin/env node

// Minimal LSP server for testing clangd versions with incomplete call hierarchy support.
const mode = process.env.TEST_CLANGD_CALL_HIERARCHY;
let buffer = Buffer.alloc(0);
let unsupportedRequests = 0;
const range = { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } };

function respond(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function handle({ id, method, params }) {
  if (method === 'exit') process.exit(0);
  if (id === undefined) return;
  const unsupported =
    (mode === 'prepare' && method === 'textDocument/prepareCallHierarchy') ||
    (mode === 'outgoing' && method === 'callHierarchy/outgoingCalls');
  if (unsupported) {
    unsupportedRequests++;
    respond({
      id,
      error: {
        code: unsupportedRequests === 1 ? -32601 : -32603,
        message: unsupportedRequests === 1 ? 'method not found' : 'unsupported method retried',
      },
    });
    return;
  }
  if (mode === 'fatal' && method === 'callHierarchy/outgoingCalls') {
    respond({ id, error: { code: -32603, message: 'internal failure' } });
    return;
  }
  if (mode === 'absent' && method.includes('CallHierarchy')) {
    respond({ id, error: { code: -32603, message: 'unadvertised method requested' } });
    return;
  }
  let result = null;
  if (method === 'initialize') {
    result = { capabilities: mode === 'absent' ? {} : { callHierarchyProvider: true } };
  } else if (method === 'textDocument/documentSymbol') {
    result = ['main', 'helper'].map((name) => ({
      name,
      kind: 12,
      range,
      selectionRange: range,
    }));
  } else if (method === 'textDocument/hover') {
    result = { contents: 'Semantic hover from clangd' };
  } else if (method === 'textDocument/references' || method === 'callHierarchy/outgoingCalls') {
    result = [];
  } else if (method === 'textDocument/prepareCallHierarchy') {
    result = [{ name: 'main', uri: params.textDocument.uri, range, selectionRange: range }];
  }
  respond({ id, result });
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd))[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length);
    buffer = buffer.subarray(bodyStart + length);
    handle(JSON.parse(body.toString()));
  }
});
