# Contributing

GitShaman is a static Next.js application for browsing curated source repositories through guides,
indexed search, cross-references, diagrams, and knowledge checks. Guide content lives in `docs/`.

## Development

```bash
npm install
npm run dev
```

The development server runs at <http://localhost:3000>. Its preparation step downloads the curated
repository snapshots used by the local corpus.

Run these checks before submitting changes:

```bash
npm run guides:validate  # validate guide markdown, prose, and repository references
npm run lint             # types, ESLint, Prettier, Markdown, prose, and dependencies
npm run build            # create the static export in out/
npm test                 # run prose regression tests and Playwright tests
```

Guide prose should read like a calm field manual. Prefer direct verbs such as "open", "trace",
"inspect", "compare", and "verify". Avoid hedged instructions such as "you can", "you should",
"try to", and "you may want to"; write the action itself instead.

`npm run lint:guide-prose` enforces these rules plus `write-good` checks for wordiness, adverbs,
weasel words, repeated words, and cliches. All findings fail the command; no environment variable
opts out. The check runs in `guides:validate`, `lint` (including pre-commit), and production builds.
`npm run test:lint` runs its regression tests.

The linter reads rendered paragraphs, headings, lists, blockquotes, and table cells across `docs/`,
including nested directories. Emphasis, link labels, and wrapped lines remain subject to the rules.
Code blocks, inline code, link destinations, HTML blocks/comments, and document/chapter YAML metadata
are excluded; `_template.md` is a scaffold rather than a guide. Diagnostics use original file lines
and columns. An empty guide corpus fails validation.

Passive voice and the opt-in ban on forms of “to be” remain disabled: technical descriptions can
use them to identify state and ownership. The exact vocabulary exceptions are `read-only`,
`user-space`, `kernel-space`, `single`, `only`, `simple`, `simply-typed`, and `Objective-C`.
Exceptions match whole terms, including at the start of a sentence; they do not exempt other prose.

Configuration is read from `.env.development`, `.env.production`, `.env.example`, and an optional
uncommitted `.env.local`. Public client-side variables use the `NEXT_PUBLIC_` prefix.

Before changing Next.js behavior or APIs, consult the version-matched documentation in
`node_modules/next/dist/docs/`.

## Repository data

Curated repositories are defined in `src/lib/curated-repos.ts` and downloaded under
`repos/<owner>/<repo>/<revision>/`. Development builds stage the browser-readable corpus in
`public/repos`; production builds read it from the configured public R2 origin. Arbitrary
repositories are loaded through the unauthenticated GitHub API.

## Guides

For an existing guide:

1. Edit the matching file in `docs/`.
2. Keep source paths relative to the repository root.
3. Prefer complete paths such as `kernel/fork.c` over ambiguous filenames.
4. Link source files with standard Markdown links.
5. Run `npm run guides:validate`.

Create a new guide from `docs/_template.md` and save it as `docs/<owner>_<repo>.md`. If the
repository is new, add its configuration to `src/lib/curated-repos.ts`.

Each guide starts with document frontmatter:

```yaml
---
curatedRepoId: repo-config-id
owner: owner
repo: repo
revision: pinned-ref-or-sha
guideId: owner-repo-guide
name: Human Name
description: Short description of the guide
defaultOpenIds:
  - ch1
---
```

Each chapter uses section frontmatter:

```yaml
---
id: ch1
title: Chapter 1 - Mental Model
difficulty: beginner
learningGoals:
  - Explain the subsystem in one sentence.
trace:
  - path: path/to/file.c:symbol_name
    description: Start here
    type: source
questions:
  - prompt: What owns this state?
    answer: The central subsystem structure owns it.
fileRecommendations:
  readingOrder:
    - path: path/to/file.c:symbol_name
      description: Why this file matters
      type: source
---
```

Supported navigation syntax includes:

- `path/to/file.c` to open a file
- `path/to/file.c:123` to open near a line
- `path/to/file.c:symbol_name` to search for a symbol
- `path/to/doc.rst#heading` to preserve a documentation anchor

Chapter diagrams use `chapter-graph` fenced blocks. Every edge must use
`source -> target : label`.

## Troubleshooting

If repository files do not load, download the relevant curated corpus:

```bash
tsx scripts/download-repos.ts --only=torvalds/linux --depth=1
```

Use `tsx scripts/download-repos.ts --list` to see available curated repositories. Restart the
development server after changing environment variables.

Repository downloads and code indexing run as separate bounded-concurrency phases. Defaults are
selected from the available CPU count, and can be overridden for benchmarking or constrained
machines with `REPO_DOWNLOAD_CONCURRENCY` and `CODE_INDEX_CONCURRENCY`.
