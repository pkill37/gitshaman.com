# Test suite

The suite has two layers:

- **Default Playwright checks**: smoke, repository UI, SEO, accessibility, browser integration, and script-style specs.
- **Opt-in performance budgets**: Core Web Vitals and bundle checks against the production export.

## Commands

```bash
# Default suite
npm test

# Same suite without opening the HTML report
npm run test:e2e

# Production performance budgets
npm run test:perf

# One file while iterating
npx playwright test tests/quality.spec.ts
```

## Server behavior

`playwright.config.ts` starts the app automatically when a browser-backed spec needs it:

- default: `tsx scripts/prepare-public-assets.ts --sqljs && next dev --turbopack --port 38080`
- performance: `serve out -p 38080` when `PERFORMANCE_BUILD=1`

Override the target with `BASE_URL` or `PLAYWRIGHT_PORT`.

## Local corpus tests

Some tests validate optional local repository data under `repos/`. They skip when the corpus is not present. To exercise them locally, run:

```bash
npm run corpus:sync
npm run test:e2e
```

## Helpers

Shared browser test helpers live in `tests/helpers/`:

- `corpus-routing.ts` mocks local/R2 corpus requests.
- `curated-repos.ts` keeps curated route samples in one place.
- `debug-logs.ts` reads and waits for browser debug log entries.
- `page-actions.ts` contains common UI actions such as opening a file from the tree.

Prefer helpers over duplicating route setup, debug-log polling, or file-tree navigation in specs.

## Notes

- Performance tests are skipped unless `PERFORMANCE_BUILD=1`; dev-server timings are too noisy for budgets.
- CI uses Playwright retries and a single worker through `playwright.config.ts`.
- Test output and reports are written under `out/`.
