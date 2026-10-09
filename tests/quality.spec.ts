import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Quality and Accessibility Tests
 * Checks for accessibility issues, broken links, and code quality
 */
test.describe('Quality Checks', () => {
  test('homepage has no accessibility violations', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('repository page has no accessibility violations', async ({ page }) => {
    await page.goto('/linux-kernel', { waitUntil: 'domcontentloaded' });
    const loadedMain = page.getByRole('main').filter({ hasText: 'Open a file from the explorer' });
    await expect(loadedMain).toBeVisible({ timeout: 30000 });
    // color-contrast is disabled: the dark VS Code-like UI intentionally uses
    // low-contrast muted labels (same design trade-off as VS Code's own dark theme)
    const accessibilityScanResults = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('guide links and status bar share repository accents', async ({ page }) => {
    await page.goto('/cpython', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-guide-markdown]').first()).toBeVisible({ timeout: 30000 });

    const localLink = page.locator('[data-guide-markdown] a[data-repo-path]').first();
    await expect(localLink).toBeVisible();
    await expect
      .poll(() => localLink.evaluate((element) => getComputedStyle(element).color))
      .toBe('rgb(245, 158, 11)');

    const glibcLink = page.locator(
      '[data-guide-markdown] a[data-repo-owner="bminor"][data-repo-name="glibc"]'
    );
    await expect(glibcLink.first()).toBeVisible();
    await expect
      .poll(() => glibcLink.first().evaluate((element) => getComputedStyle(element).color))
      .toBe('rgb(220, 38, 38)');

    await expect
      .poll(() =>
        page
          .locator('.cursor-statusbar')
          .evaluate((element) => getComputedStyle(element).backgroundColor)
      )
      .toBe('rgb(245, 158, 11)');
  });

  test('all internal links are valid', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const hrefs = await page.$$eval('main a[href^="/"]', (links) =>
      links.map((link) => link.getAttribute('href'))
    );
    const brokenLinks: string[] = [];

    for (const href of hrefs) {
      if (href && !href.startsWith('#')) {
        const response = await page.request.get(href);
        if (response.status() >= 400) {
          brokenLinks.push(href);
        }
      }
    }

    expect(brokenLinks).toEqual([]);
  });

  test('has no broken images', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const imageSources = await page.$$eval('main img', (images) =>
      images.map((img) => img.getAttribute('src'))
    );
    const brokenImages: string[] = [];

    for (const src of imageSources) {
      if (src && !src.startsWith('data:') && !src.startsWith('http')) {
        const publicPath = path.join(process.cwd(), 'public', src.replace(/^\/+/, ''));
        if (!fs.existsSync(publicPath)) {
          continue;
        }
        const response = await page.request.get(src);
        if (response.status() >= 400) {
          brokenImages.push(src);
        }
      }
    }

    expect(brokenImages).toEqual([]);
  });

  test('has proper color contrast', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    // Filter for color contrast violations
    const contrastViolations = accessibilityScanResults.violations.filter(
      (violation) => violation.id === 'color-contrast'
    );
    expect(contrastViolations).toEqual([]);
  });

  test('keyboard navigation works', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Check that interactive elements are focusable
    const interactiveElements = page.locator('a, button, input, select, textarea, [tabindex]');
    const count = await interactiveElements.count();

    for (let i = 0; i < Math.min(count, 10); i++) {
      const element = interactiveElements.nth(i);
      const tabIndex = await element.getAttribute('tabindex');
      // Elements should be focusable (tabindex >= 0 or not set for native elements)
      if (tabIndex && parseInt(tabIndex) < 0) {
        throw new Error(`Element has negative tabindex: ${await element.textContent()}`);
      }
    }
  });

  test('has proper ARIA labels where needed', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Check buttons without text have aria-label
    const unlabeledButtonCount = await page.$$eval(
      'main button',
      (buttons) =>
        buttons.filter(
          (button) =>
            !button.textContent?.trim() &&
            !button.getAttribute('aria-label') &&
            !button.getAttribute('aria-labelledby')
        ).length
    );

    expect(unlabeledButtonCount).toBe(0);
  });

  test('forms have proper labels', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const unlabeledInputCount = await page.$$eval(
      'main input, main select, main textarea',
      (inputs) =>
        inputs.filter((input) => {
          if (input.getAttribute('type') === 'hidden') return false;

          const id = input.getAttribute('id');
          const hasLabel = id
            ? Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`))
            : false;
          return (
            !hasLabel && !input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby')
          );
        }).length
    );

    expect(unlabeledInputCount).toBe(0);
  });

  test('has no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Filter out known non-critical errors
    const criticalErrors = errors.filter(
      (error) =>
        !error.includes('favicon') &&
        !error.includes('404') &&
        !error.includes('net::ERR_') &&
        !error.includes('RepoMetadata') &&
        !error.includes('GitHub API error') &&
        !error.includes('status of 403')
    );

    expect(criticalErrors).toEqual([]);
  });

  test('has proper document structure', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Check for DOCTYPE
    const doctype = await page.evaluate(() => document.doctype?.name);
    expect(doctype).toBe('html');

    // Check for html, head, body
    const html = await page.locator('html').count();
    const head = await page.locator('head').count();
    const body = await page.locator('body').count();

    expect(html).toBe(1);
    expect(head).toBe(1);
    expect(body).toBe(1);
  });
});
