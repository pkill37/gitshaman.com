import { defineConfig, devices } from '@playwright/test';
import nextEnv from '@next/env';
import { firefoxLaunchOptions } from './scripts/firefox-launch-options';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const testPort = process.env.PLAYWRIGHT_PORT || '38080';
const baseURL = process.env.BASE_URL || `http://localhost:${testPort}`;
const testEnvironment = Object.entries(process.env).reduce<Record<string, string>>(
  (environment, [key, value]) => {
    if (key !== 'VSCODE_INJECTION' && typeof value === 'string') {
      environment[key] = value;
    }
    return environment;
  },
  {}
);

/**
 * Playwright configuration for testing the static web app
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Allow the two browser projects to run concurrently, while keeping each
  // browser's tests serial to avoid contention in the shared dev server.
  workers: 2,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { outputFolder: 'out/playwright-report', open: 'never' }],
        ['junit', { outputFile: 'out/playwright-junit.xml' }],
      ]
    : [['html', { outputFolder: 'out/playwright-report', open: 'never' }]],
  outputDir: 'out/test-results',
  preserveOutput: 'failures-only',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      workers: 1,
      grepInvert: /@mobile/,
      use: { ...devices['Desktop Chrome'], launchOptions: { env: testEnvironment } },
    },
    {
      name: 'firefox',
      workers: 1,
      grepInvert: /@mobile/,
      use: { ...devices['Desktop Firefox'], launchOptions: firefoxLaunchOptions(testEnvironment) },
    },
    {
      name: 'mobile-chromium',
      workers: 1,
      grep: /@mobile/,
      use: { ...devices['Pixel 7'], launchOptions: { env: testEnvironment } },
    },
  ],
  webServer: {
    command: `tsx scripts/prepare-public-assets.ts --dev --sqljs && tsx scripts/test-dev-server.ts --port ${testPort}`,
    url: baseURL,
    env: testEnvironment,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    timeout: 120000,
  },
});
