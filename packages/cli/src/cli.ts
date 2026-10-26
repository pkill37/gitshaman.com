import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { parseCommandLine } from './arguments';
import { verify } from './verify';
import { findSymbolsInFile } from '../../../src/lib/cross-reference';
import { parseSymbols } from '../../../src/lib/code-analysis';
import {
  CLI_VERSION,
  initialize,
  language,
  readConfig,
  readEligibleFile,
  repositoryRoot,
  withWriter,
  workingFiles,
  writeJson,
} from './repository';
import { analyze, checksums, componentVersions, currentGeneration } from './analysis';
import { embedGeneration } from './embeddings';
import { serveWorkspace } from './server';
import { share } from './share';

const HELP = `GitShaman ${CLI_VERSION} — local repository analysis

Usage: gitshaman <command> [options]

  init          Initialize this Git worktree
  analyze       Build source indexes and available embeddings
  viz           Open the local source workspace and graph
  parser [path] Inspect extracted symbols and dependencies
  embed         Refresh embeddings independently
  version       Show component versions
  verify        Verify packaged assets, indexes, and embeddings
  checksum      Refresh observed source checksums
  share         Contribute a public commit through a GitHub PR

Global: --repo <directory> --json --help
Analyze: --committed --no-embed --force
Viz: --port <number> --no-open
Share: --dry-run --source owner/repo --name <name> --description <text>
       --slug <slug> --guide <markdown-file> --no-open

Chat and MCP are deferred. Run analyze again to refresh source changes.
`;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
export function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () =>
    process.stderr.write('Could not open a browser automatically. Open the printed URL.\n')
  );
  child.unref();
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseCommandLine(args);
  const { values } = parsed;
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const { command, target, port } = parsed;
  const print = (result: unknown) =>
    process.stdout.write(
      `${values.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`
    );
  if (command === 'version') {
    let clangd = 'unavailable';
    try {
      clangd = execFileSync(process.env.CLANGD_PATH || 'clangd', ['--version'], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).split('\n')[0];
    } catch {
      /* Optional compiler. */
    }
    print({ ...componentVersions(), clangd });
    return;
  }
  const root = repositoryRoot(values.repo ?? process.cwd());
  if (command === 'init') {
    print(initialize(root));
    return;
  }
  const config = readConfig(root);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Operation cancelled.'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    if (command === 'analyze')
      print(
        await analyze(root, {
          committed: values.committed,
          noEmbed: values['no-embed'],
          force: values.force,
          signal: controller.signal,
        })
      );
    else if (command === 'checksum') print(await withWriter(root, async () => checksums(root)));
    else if (command === 'verify') print(verify(root, dist));
    else if (command === 'embed')
      print(
        await withWriter(root, async () => {
          const { directory, snapshot } = currentGeneration(root);
          const result = await embedGeneration(root, directory, config, controller.signal);
          snapshot.embeddings = 'ready';
          writeJson(path.join(directory, 'snapshot.json'), snapshot);
          return result;
        })
      );
    else if (command === 'parser') {
      const files = workingFiles(root, config.analysis).files;
      const selected = target
        ? files.filter(
            (file) => file === target || file.startsWith(`${target.replace(/\/$/, '')}/`)
          )
        : files;
      if (target && !selected.length)
        throw new Error(
          'Parser path is excluded or does not exist; use a repository-relative path.'
        );
      print(
        selected.map((file) => {
          const content = readEligibleFile(root, file)
            .subarray(0, 64 * 1024)
            .toString('utf8');
          return {
            path: file,
            language: language(file),
            symbols: findSymbolsInFile(content, file),
            structure: parseSymbols(file, content),
            provider: 'heuristic',
            confidence: 'low',
          };
        })
      );
    } else if (command === 'share') {
      const result = await withWriter(root, () =>
        share(root, {
          source: values.source,
          name: values.name,
          description: values.description,
          slug: values.slug,
          guide: values.guide,
          dryRun: values['dry-run'],
          noOpen: values['no-open'],
        })
      );
      print(result);
      if (!values['no-open'] && !values['dry-run'] && typeof result.url === 'string')
        openBrowser(result.url);
    } else if (command === 'viz') {
      const workspace = await serveWorkspace(root, path.join(dist, 'workspace'), port);
      const { server } = workspace;
      const { url } = workspace;
      print({ url });
      if (!values['no-open']) openBrowser(url);
      await new Promise<void>((resolve) => {
        const stop = () => {
          server.closeAllConnections();
          server.close();
        };
        server.once('close', () => {
          controller.signal.removeEventListener('abort', stop);
          resolve();
        });
        controller.signal.addEventListener('abort', stop, { once: true });
        if (controller.signal.aborted) stop();
      });
    }
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`gitshaman: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
