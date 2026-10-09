import { test, expect } from '@playwright/test';

const WORKER_PATHS = [
  'editor/editor.worker.js',
  'language/json/json.worker.js',
  'language/css/css.worker.js',
  'language/html/html.worker.js',
  'language/typescript/ts.worker.js',
];

for (const workerPath of WORKER_PATHS) {
  test(`Monaco worker initializes: ${workerPath}`, async ({ page }) => {
    // Use the app's origin without loading the editor or allowing its fallback
    // to hide a broken worker. Worker assets still come from the real server.
    await page.route('**/__monaco-worker-test__', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Workers</title>' })
    );
    await page.goto('/__monaco-worker-test__');

    const reply = await page.evaluate(
      (path) =>
        new Promise<{ type: number; seq: string; err?: unknown }>((resolve, reject) => {
          const worker = new Worker(`/monaco-editor/vs/${path}`, { type: 'module' });
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error(`Worker initialization timed out: ${path}`));
          }, 10000);

          worker.onerror = (event) => {
            clearTimeout(timeout);
            worker.terminate();
            reject(new Error(event.message || `Worker failed: ${path}`));
          };
          worker.onmessage = (event) => {
            clearTimeout(timeout);
            worker.terminate();
            resolve(event.data);
          };

          // Monaco 0.53 bootstraps on the first message. Language workers
          // additionally receive their configuration before accepting RPC.
          worker.postMessage(null);
          if (path !== 'editor/editor.worker.js') {
            worker.postMessage({
              languageId: path.split('/')[1],
              languageSettings: {},
              options: {},
              compilerOptions: {},
              extraLibs: {},
            });
          }
          worker.postMessage({
            vsWorker: 1,
            type: 0,
            req: '1',
            channel: 'default',
            method: '$initialize',
            args: [1],
          });
        }),
      workerPath
    );

    expect(reply).toMatchObject({ type: 1, seq: '1' });
    expect(reply.err).toBeUndefined();
  });
}
