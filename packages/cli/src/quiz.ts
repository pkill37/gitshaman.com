import { spawn, execFile } from 'node:child_process';
import { constants } from 'node:os';
import type { QuizRequest, QuizSession } from '../../../src/lib/quiz';

export const QUIZ_HELP = `Usage: gitshaman quiz [check|init|status|doctor|install-hooks|uninstall-hooks] [options]

  check            Start or resume a Sphinx understanding check in the terminal
  init             Create this repository's Sphinx policy and ignore files
  status           Show Sphinx policy and pending checks
  doctor           Check Sphinx setup
  install-hooks    Set up Sphinx Git hooks (machine-wide by default)
  uninstall-hooks  Remove Sphinx integrations (machine-wide by default)

Options: --repo <directory> --help
Check/init/status/doctor: --json
Check: --staged     Quiz staged changes instead of committed changes
Hooks: --local      Install/remove explicit repository hook integration

Run gitshaman quiz with no action to open Quiz in the browser workspace.
Use quiz check for a terminal interview, or quiz --json for Sphinx JSON.
Browser: --port <number> --no-open (requires init and analyze first)
Requires sphinx-understand on PATH: npm install -g sphinx-understand
Hook installation is opt-in. Existing hooks are handled by Sphinx.
Reviewer models and credentials use Sphinx configuration, separate from embeddings.
Docs: https://github.com/parthh01/sphinx#readme
`;

export type QuizOptions = { staged?: boolean; local?: boolean; json?: boolean };

function parseSession(value: unknown): QuizSession {
  const session = value as QuizSession | null;
  if (
    !session ||
    typeof session !== 'object' ||
    Array.isArray(session) ||
    typeof session.status !== 'string' ||
    !session.status ||
    (session.id !== undefined &&
      (typeof session.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(session.id))) ||
    (session.feedback !== undefined && typeof session.feedback !== 'string') ||
    (session.progress !== undefined &&
      (!session.progress ||
        !Number.isInteger(session.progress.completed) ||
        !Number.isInteger(session.progress.total) ||
        session.progress.completed < 0 ||
        session.progress.total < session.progress.completed)) ||
    (session.question !== undefined &&
      (!session.question ||
        !session.id ||
        typeof session.question.id !== 'string' ||
        typeof session.question.prompt !== 'string' ||
        !session.question.prompt.trim() ||
        !Array.isArray(session.question.choices) ||
        !session.question.choices.every((choice) => typeof choice === 'string')))
  )
    throw new Error('Sphinx returned an invalid assessment.');
  return session;
}

export async function requestQuiz(
  root: string,
  request: QuizRequest,
  signal?: AbortSignal
): Promise<QuizSession> {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    (request.staged !== undefined && typeof request.staged !== 'boolean')
  )
    throw new Error('Invalid quiz request.');
  const args: string[] = [];
  if (request.action === 'start') {
    args.push('check');
    if (request.staged) args.push('--staged');
  } else if (['resume', 'answer', 'explain'].includes(request.action)) {
    if (typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.id))
      throw new Error('Invalid assessment ID.');
    args.push(request.action === 'resume' ? 'check' : request.action);
    if (request.action === 'resume') args.push('--id', request.id);
    else args.push(request.id);
    if (request.action === 'answer') {
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 16000)
        throw new Error('Enter an answer of 1–16000 characters.');
      args.push('--text', request.text);
    }
  } else throw new Error('Unsupported quiz action.');
  args.push('--json');
  return new Promise((resolve, reject) => {
    execFile(
      'sphinx',
      args,
      { cwd: root, signal, timeout: 25 * 60 * 1000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              (error as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'Sphinx is not installed. Run npm install -g sphinx-understand, then configure your reviewer with sphinx install.'
                : stderr.trim() || error.message
            )
          );
          return;
        }
        try {
          resolve(parseSession(JSON.parse(stdout)));
        } catch (reason) {
          reject(reason);
        }
      }
    );
  });
}

export function quizArguments(action = 'check', options: QuizOptions = {}): string[] {
  const actions: Record<string, string[]> = {
    check: ['check'],
    init: ['init'],
    status: ['status'],
    doctor: ['doctor'],
    'install-hooks': ['install', '--agents', 'none', '--no-launch'],
    'uninstall-hooks': ['uninstall'],
  };
  if (!Object.hasOwn(actions, action))
    throw new Error(`Unknown quiz action: ${action}. Run gitshaman quiz --help.`);
  if (options.staged && action !== 'check')
    throw new Error('--staged is only supported by quiz check.');
  if (options.local && !['install-hooks', 'uninstall-hooks'].includes(action))
    throw new Error('--local is only supported by quiz install-hooks or uninstall-hooks.');
  if (options.json && ['install-hooks', 'uninstall-hooks'].includes(action))
    throw new Error('Sphinx hook installation/removal does not support --json.');
  // Upstream's repository repair mode accepts only --repo (and --yes).
  if (action === 'install-hooks' && options.local) return ['install', '--repo'];
  return [
    ...actions[action],
    ...(options.staged ? ['--staged'] : []),
    ...(options.local ? ['--repo'] : []),
    ...(options.json ? ['--json'] : []),
  ];
}

// Inherit the terminal: Sphinx owns the interview and receives answers directly.
// Never use a shell or fetch a package implicitly when a quiz starts.
export async function runQuiz(
  root: string,
  action = 'check',
  options: QuizOptions = {}
): Promise<number> {
  const args = quizArguments(action, options);
  return new Promise((resolve, reject) => {
    const child = spawn('sphinx', args, { cwd: root, stdio: 'inherit' });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    const cleanup = () => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    child.once('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(
        error.code === 'ENOENT'
          ? new Error(
              'Sphinx is not installed. Run npm install -g sphinx-understand, then retry gitshaman quiz.'
            )
          : error
      );
    });
    child.once('exit', (code, signal) => {
      cleanup();
      resolve(code ?? (signal ? 128 + constants.signals[signal] : 1));
    });
  });
}
