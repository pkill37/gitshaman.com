import { expect, test } from '@playwright/test';

test.describe('Mobile navigation', { tag: '@mobile' }, () => {
  test('homepage remains usable on a phone viewport', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
  });
});
