import { parseArgs } from 'node:util';
import { safeRelative } from './repository';

export function parseCommandLine(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      repo: { type: 'string' },
      committed: { type: 'boolean' },
      'no-embed': { type: 'boolean' },
      force: { type: 'boolean' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      source: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      slug: { type: 'string' },
      guide: { type: 'string' },
    },
  });
  if (values.help || !positionals.length) {
    return { values, help: true };
  }
  const [command, target, ...extra] = positionals;
  const commands = new Set([
    'init',
    'analyze',
    'viz',
    'parser',
    'embed',
    'version',
    'verify',
    'checksum',
    'share',
  ]);
  if (!commands.has(command)) throw new Error(`Unknown command: ${command}. Run gitshaman --help.`);
  if (extra.length || (target && command !== 'parser'))
    throw new Error(`Unexpected argument for ${command}.`);
  const flags: Record<string, string[]> = {
    analyze: ['committed', 'no-embed', 'force'],
    viz: ['port', 'no-open'],
    share: ['dry-run', 'source', 'name', 'description', 'slug', 'guide', 'no-open'],
  };
  for (const flag of Object.keys(values))
    if (!['repo', 'json', 'help'].includes(flag) && !flags[command]?.includes(flag))
      throw new Error(`--${flag} is not supported by ${command}.`);
  let port = 0;
  if (command === 'viz') {
    if (values.port !== undefined && (!/^\d+$/.test(values.port) || Number(values.port) > 65535))
      throw new Error('--port must be an integer between 0 and 65535.');
    port = Number(values.port ?? 0);
  }
  let parserPath: string | undefined = target;
  if (command === 'parser' && target) {
    parserPath = target.replace(/\/+$/, '').replace(/^(?:\.\/)+/, '');
    if (parserPath === '.') parserPath = undefined;
    else if (!safeRelative(parserPath)) throw new Error('Parser path must be repository-relative.');
  }
  return { values, command, target: command === 'parser' ? parserPath : target, port };
}
