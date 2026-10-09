import { expect, type Page } from '@playwright/test';

export type DebugEntry = {
  label: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
};

export async function resetDebugLogs(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__explorarDebugLogs = [];
  });
}

export async function readDebugLogs(page: Page): Promise<DebugEntry[]> {
  return page.evaluate(() => (window.__explorarDebugLogs ?? []) as DebugEntry[]);
}

export async function expectDebugLog(
  page: Page,
  predicate: (entry: DebugEntry) => boolean,
  message: string,
  timeout = 30000
): Promise<void> {
  await expect
    .poll(
      async () => {
        const logs = await readDebugLogs(page);
        return logs.some(predicate);
      },
      { timeout, message }
    )
    .toBeTruthy();
}
