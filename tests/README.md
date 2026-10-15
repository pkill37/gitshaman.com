# Test suite

The suite covers Node checks plus smoke, repository UI, SEO, accessibility, and browser integration.

## Commands

```bash
# Default suite
npm test

# One file while iterating
npx playwright test tests/quality.spec.ts
```

## Server behavior

`playwright.config.ts` starts the app automatically when a browser-backed spec needs it:

- default: `tsx scripts/prepare-public-assets.ts --dev --sqljs && tsx scripts/test-dev-server.ts --port 38080`

Override the target with `BASE_URL` or `PLAYWRIGHT_PORT`.

## Local corpus tests

Some tests validate optional local repository data under `repos/`. They skip when the corpus is not present. To exercise them locally, run:

```bash
npm run corpus:sync
npm test
```

## Helpers

Shared browser test helpers live in `tests/helpers/`:

- `corpus-routing.ts` mocks local/R2 corpus requests.
- `curated-repos.ts` keeps curated route samples in one place.
- `debug-logs.ts` reads and waits for browser debug log entries.
- `page-actions.ts` contains common UI actions such as opening a file from the tree.

Prefer helpers over duplicating route setup, debug-log polling, or file-tree navigation in specs.

## Notes

- CI uses Playwright retries and two workers through `playwright.config.ts`.
- Test output and reports are written under `out/`.
