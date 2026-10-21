#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CANCELED_RENDER_MESSAGE = 'unhandledRejection: Canceled: Canceled';

function forwardOutput(output: NodeJS.WriteStream, chunk: Buffer): void {
  const text = chunk.toString();
  const filtered = text
    .split(/(?<=\n)/)
    .filter((line) => !line.includes(CANCELED_RENDER_MESSAGE))
    .join('');
  if (filtered) output.write(filtered);
}

function main(): void {
  const nextCli = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
  const nodeOptions = process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
    ? ['--no-experimental-webstorage']
    : [];
  const child = spawn(
    process.execPath,
    [...nodeOptions, nextCli, 'dev', '--turbopack', ...process.argv.slice(2)],
    {
      env: { ...process.env, GITSHAMAN_TEST_SERVER: '1' },
      stdio: ['inherit', 'pipe', 'pipe'],
    }
  );

  child.stdout.on('data', (chunk: Buffer) => forwardOutput(process.stdout, chunk));
  child.stderr.on('data', (chunk: Buffer) => forwardOutput(process.stderr, chunk));
  child.on('error', (error) => {
    console.error(`Failed to start the Next.js test server: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
