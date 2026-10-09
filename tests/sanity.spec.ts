import { test, expect } from '@playwright/test';
import { CURATED_TEST_REPOS } from './helpers/curated-repos';

/**
 * Sanity checks for the static web app
 * Ensures basic functionality works and pages load without errors
 */
test.describe('Sanity Checks', () => {
  test('homepage loads successfully', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/gitshaman/i);
  });

  test('no console errors on homepage', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(errors).toHaveLength(0);
  });

  test('repository pages load successfully', async ({ page }) => {
    for (const { slug } of CURATED_TEST_REPOS) {
      const response = await page.goto(`/${slug}`, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('robots.txt is accessible', async ({ page }) => {
    const response = await page.goto('/robots.txt', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    const content = await page.textContent('body');
    expect(content).toContain('User-Agent');
  });

  test('sitemap.xml is accessible', async ({ page }) => {
    const response = await page.goto('/sitemap.xml', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    const content = await page.textContent('body');
    expect(content).toContain('urlset');
  });
});
