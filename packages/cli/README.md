# GitShaman CLI

Analyze a Git repository and browse it in the same workspace used by gitshaman.com:

```sh
gitshaman init
gitshaman analyze --no-embed
gitshaman viz
```

Use `gitshaman --help` for commands and options. Requires Git and Node.js 22.22.2 or newer.

Full documentation: [GitShaman](https://github.com/pkill37/gitshaman.com#cli).

## Development checks

From the repository root, run `npm run test:cli` to build the CLI and run its Node tests plus
the shared workspace tests in Chromium and Firefox. `npm run test:cli:coverage` builds the CLI
and reports line, branch, and function coverage for `packages/cli/src` from the Node suites.
Provider tests use local fixtures without live model requests.
