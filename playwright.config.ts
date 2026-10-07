import { defineConfig, devices } from '@playwright/test';

const NODE_ONLY_TEST_FILES = new Set([
  'tests/code-index-builder.spec.ts',
  'tests/corpus-sqlite-index.spec.ts',
  'tests/deploy-r2.spec.ts',
  'tests/github-url.spec.ts',
  'tests/guide-lint.spec.ts',
  'tests/repo-source-routing.spec.ts',
  'tests/semantic-query-service.spec.ts',
]);

function shouldStartWebServer(): boolean {
  const requestedTestFiles = process.argv
    .slice(2)
    .filter((arg) => arg.endsWith('.spec.ts') || arg.startsWith('tests/'))
    .map((arg) => arg.replace(/^\.\//, ''));

  if (requestedTestFiles.length === 0) {
    return true;
  }

  return !requestedTestFiles.every((file) => NODE_ONLY_TEST_FILES.has(file));
}

const useProductionExport = process.env.PERFORMANCE_BUILD === '1';
const testPort = process.env.PLAYWRIGHT_PORT || '38080';
const baseURL = process.env.BASE_URL || `http://localhost:${testPort}`;

/**
 * Playwright configuration for testing the static web app
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'out/playwright-report' }]],
  outputDir: 'out/test-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(shouldStartWebServer()
    ? {
        webServer: {
          command: useProductionExport
            ? `serve out -p ${testPort}`
            : `tsx scripts/prepare-public-assets.ts --dev --sqljs && next dev --turbopack --port ${testPort}`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120000,
        },
      }
    : {}),
});
