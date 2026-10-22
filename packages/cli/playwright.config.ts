import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests',
  testMatch: 'cli-workspace.spec.ts',
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  outputDir: '../../out/cli-tests',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
