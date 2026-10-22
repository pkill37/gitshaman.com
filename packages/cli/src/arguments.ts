import { parseArgs } from 'node:util';
import { safeRelative } from './repository';
import { quizArguments } from './quiz';

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
      staged: { type: 'boolean' },
      local: { type: 'boolean' },
    },
  });
  if (values.help || !positionals.length) {
    return { values, help: positionals[0] === 'quiz' ? ('quiz' as const) : ('main' as const) };
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
    'quiz',
  ]);
  if (!commands.has(command)) throw new Error(`Unknown command: ${command}. Run gitshaman --help.`);
  if (extra.length || (target && !['parser', 'quiz'].includes(command)))
    throw new Error(`Unexpected argument for ${command}.`);
  const flags: Record<string, string[]> = {
    analyze: ['committed', 'no-embed', 'force'],
    viz: ['port', 'no-open'],
    share: ['dry-run', 'source', 'name', 'description', 'slug', 'guide', 'no-open'],
    quiz: ['staged', 'local', 'port', 'no-open'],
  };
  for (const flag of Object.keys(values))
    if (!['repo', 'json', 'help'].includes(flag) && !flags[command]?.includes(flag))
      throw new Error(`--${flag} is not supported by ${command}.`);
  const quizBrowser = command === 'quiz' && !target && !values.json;
  if (quizBrowser && values.local)
    throw new Error('--local is only supported by quiz install-hooks or uninstall-hooks.');
  if (command === 'quiz' && !quizBrowser) {
    if (values.port !== undefined || values['no-open'])
      throw new Error('--port and --no-open apply to the quiz browser workspace.');
    quizArguments(target, { staged: values.staged, local: values.local, json: values.json });
  }
  let port = 0;
  if (command === 'viz' || quizBrowser) {
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
  return { values, command, target: command === 'parser' ? parserPath : target, quizBrowser, port };
}
