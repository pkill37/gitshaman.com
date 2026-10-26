import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { currentGeneration, freshness, fileTree } from './analysis';
import { readConfig, readEligibleFile, workingFiles } from './repository';
import { search } from './search';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

function sendFile(file: string, response: http.ServerResponse): void {
  fs.createReadStream(file)
    .once('error', () => {
      if (response.headersSent) response.destroy();
      else response.writeHead(404).end('File is unavailable');
    })
    .pipe(response);
}
export async function serveWorkspace(
  root: string,
  assets: string,
  port = 0
): Promise<{ server: http.Server; url: string; token: string }> {
  const { directory, snapshot } = currentGeneration(root);
  const config = readConfig(root);
  const token = crypto.randomBytes(32).toString('hex');
  let origin = '';
  const server = http.createServer((request, response) => {
    void (async () => {
      const controller = new AbortController();
      request.on('aborted', () => controller.abort());
      response.once('close', () => {
        if (!response.writableEnded) controller.abort();
      });
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'"
      );
      if (
        request.headers.host !== new URL(origin).host ||
        (request.headers.origin && request.headers.origin !== origin) ||
        (request.headers['sec-fetch-site'] &&
          !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site'])))
      ) {
        response.writeHead(403).end('Forbidden origin');
        return;
      }
      const url = new URL(request.url ?? '/', origin);
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET' }).end();
        return;
      }
      const json = (value: unknown) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(value));
      };
      if (url.pathname.startsWith('/api/')) {
        const authorization = request.headers.authorization ?? '';
        if (authorization !== `Bearer ${token}`) {
          response.writeHead(401).end('Missing session authorization');
          return;
        }
        if (url.pathname === '/api/status') {
          json({
            snapshot,
            ...freshness(root, snapshot),
            name: path.basename(root),
            identity: `local:${snapshot.rootIdentity}:${snapshot.generation}`,
          });
          return;
        }
        if (url.pathname === '/api/tree') {
          json(fileTree(workingFiles(root, config.analysis).files));
          return;
        }
        if (url.pathname === '/api/file') {
          const file = url.searchParams.get('path') ?? '';
          const selected = workingFiles(root, config.analysis).files;
          if (!selected.includes(file)) {
            response.writeHead(404).end('Source is excluded or unavailable');
            return;
          }
          json({ path: file, content: readEligibleFile(root, file).toString('utf8') });
          return;
        }
        if (url.pathname === '/api/index') {
          response.setHeader('Content-Type', 'application/vnd.sqlite3');
          sendFile(path.join(directory, 'code-index.sqlite'), response);
          return;
        }
        if (url.pathname === '/api/search') {
          json(
            await search(
              directory,
              snapshot,
              config,
              url.searchParams.get('q') ?? '',
              url.searchParams.get('semantic') === '1',
              controller.signal
            )
          );
          return;
        }
        response.writeHead(404).end('Unknown API');
        return;
      }
      let relative: string;
      try {
        relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
      } catch {
        response.writeHead(400).end();
        return;
      }
      if (
        relative.split('/').some((part) => part === '..' || part.startsWith('.')) ||
        relative.includes('\\') ||
        relative.includes('\0')
      ) {
        response.writeHead(404).end();
        return;
      }
      const file = path.resolve(assets, relative);
      if (
        !file.startsWith(`${path.resolve(assets)}${path.sep}`) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile() ||
        !fs.realpathSync(file).startsWith(`${fs.realpathSync(assets)}${path.sep}`)
      ) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
      sendFile(file, response);
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(400, {
        'Content-Type': 'application/json',
      });
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed' })
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot resolve workspace port.');
  origin = `http://127.0.0.1:${address.port}`;
  return { server, url: `${origin}/#${token}`, token };
}
