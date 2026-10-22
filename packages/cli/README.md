# GitShaman CLI

Analyze a Git repository and browse it in the same workspace used by gitshaman.com:

```sh
gitshaman init
gitshaman analyze --no-embed
gitshaman viz
```

Use `gitshaman --help` for commands and options. Requires Git and Node.js 22.22.2 or newer.

## Quiz

Install [Sphinx](https://sphinx-six-theta.vercel.app/) separately for understanding checks:

```sh
npm install -g sphinx-understand
gitshaman quiz install-hooks
gitshaman quiz init
gitshaman quiz
```

`install-hooks` explicitly sets up machine-wide Sphinx Git hooks and reviewer configuration.
Existing hooks are chained by Sphinx; coding-agent integration is skipped. Repository policy
controls which commits and pushes require a check. The optional `--local` mode repairs hook
coverage in repositories with their own `core.hooksPath`.

The browser Quiz panel sits alongside the source editor. It supports questions, answers,
feedback, follow-up scenarios, and explicit sharing of practice questions and explanations.
Shared practice opens on gitshaman.com without a model account and does not approve Git operations.
Personal answer fields and credentials are excluded from practice exports.

For offline study, click **Download for Anki** in the Quiz panel. The UTF-8 text file
contains all collected questions (or the full imported practice set), with questions on
the front and reviewer explanations on the back. Missing explanations include a reminder
to review the source. This export needs no public repository or commit SHA.
In Anki, choose **File → Import**, select the downloaded `gitshaman-quiz-anki.txt`,
choose the **Basic** note type and your destination deck, and map **Front** and **Back**.
The file declares tab-separated fields and HTML formatting for line breaks, following
[Anki's text import format](https://docs.ankiweb.net/importing/text-files.html).

Use `gitshaman quiz check` for terminal interviews, `quiz --json` for JSON,
and `quiz --help` for setup, status, and hook removal commands. Sphinx reviewer settings
are separate from GitShaman embeddings. Review the
[Sphinx documentation](https://github.com/parthh01/sphinx#readme) before configuring a reviewer.

Full documentation: [GitShaman](https://github.com/pkill37/gitshaman.com#cli).

## Development checks

From the repository root, run `npm run test:cli` to build the CLI and run its Node tests plus
the shared workspace tests in Chromium and Firefox. `npm run test:cli:coverage` builds the CLI
and reports line, branch, and function coverage for `packages/cli/src` from the Node suites.
Provider and Sphinx tests use local fixtures without live model requests or hook installation.
