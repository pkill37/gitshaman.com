import { test, expect } from '@playwright/test';
import { CURATED_TEST_SITEMAP_PATHS } from './helpers/curated-repos';

function expectUrlPath(url: string | null, path: string): void {
  expect(url).toBeTruthy();
  expect(new URL(url!).pathname).toBe(path);
}

/**
 * SEO Tests
 * Validates meta tags, structured data, robots.txt, sitemap, etc.
 */
test.describe('SEO Checks', () => {
  test('homepage has required meta tags', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Check for title
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title).toBe('GitShaman: Semantic Code Intelligence');
    expect(title.length).toBeGreaterThan(10);
    expect(title.length).toBeLessThan(60);

    // Check for meta description
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toBeTruthy();
    expect(description).toContain('indexed files');
    expect(description).toContain('curated guides');
    expect(description?.length).toBeGreaterThan(50);
    expect(description?.length).toBeLessThan(160);

    // Check for viewport meta tag
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toBeTruthy();

    // Check for charset
    const charset = await page.locator('meta[charset]').getAttribute('charset');
    expect(charset).toBe('utf-8');
  });

  test('repository pages have proper meta tags', async ({ page }) => {
    await page.goto('/linux-kernel', { waitUntil: 'domcontentloaded' });

    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title).toBe('Linux | gitshaman.com');

    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toContain('Linux kernel source code');

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expectUrlPath(canonical, '/linux-kernel/');

    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const twitterTitle = await page.locator('meta[name="twitter:title"]').getAttribute('content');
    expect(ogTitle).toBe(title);
    expect(twitterTitle).toBe(title);
  });

  test('repository pages expose useful content without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/linux-kernel', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Linux source explorer');
    await expect(page.locator('body')).toContainText('kernel architecture');
    await context.close();
  });

  test('homepage exposes feature explanations without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    for (const name of ['VS Code Editor + LSP', 'Code Indexing', 'Semantic Enrichment']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('main')).toContainText('language-aware navigation');
    await expect(page.getByRole('main')).toContainText(
      'references, and implementation relationships'
    );
    await context.close();
  });

  test('has Open Graph meta tags', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const ogDescription = await page
      .locator('meta[property="og:description"]')
      .getAttribute('content');
    const ogType = await page.locator('meta[property="og:type"]').getAttribute('content');

    expect(ogTitle).toBeTruthy();
    expect(ogDescription).toBeTruthy();
    expect(ogType).toBeTruthy();

    const imageUrl = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(imageUrl).toBeTruthy();
    const parsedImageUrl = new URL(imageUrl!);
    const imageResponse = await page.request.get(
      `${parsedImageUrl.pathname}${parsedImageUrl.search}`
    );
    expect(imageResponse.ok()).toBe(true);
    const imageBytes = await imageResponse.body();
    expect([...imageBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test('has Twitter Card meta tags', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute('content');
    const twitterTitle = await page.locator('meta[name="twitter:title"]').getAttribute('content');

    expect(twitterCard).toBeTruthy();
    expect(twitterTitle).toBeTruthy();
  });

  test('robots.txt is properly formatted', async ({ page }) => {
    await page.goto('/robots.txt', { waitUntil: 'domcontentloaded' });
    const content = await page.textContent('body');

    expect(content?.toLowerCase()).toContain('user-agent');
    expect(content).toContain('Allow:');
    expect(content).toContain('Sitemap:');
  });

  test('sitemap.xml is valid', async ({ page }) => {
    await page.goto('/sitemap.xml', { waitUntil: 'domcontentloaded' });
    const content = await page.textContent('body');

    expect(content).toContain('urlset');
    expect(content).toContain('xmlns');
    expect(content).toContain('url');
    expect(content).toContain('loc');
  });

  test('sitemap contains all repository pages', async ({ page }) => {
    await page.goto('/sitemap.xml', { waitUntil: 'domcontentloaded' });
    const content = await page.textContent('body');

    for (const repo of CURATED_TEST_SITEMAP_PATHS) {
      expect(content).toContain(repo);
    }
    expect(content).not.toContain('/technology/');
  });

  test('has canonical URLs', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expectUrlPath(canonical, '/');
  });

  test('has valid structured data for the shipped product', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    const parsed = schemas.map((schema) => JSON.parse(schema) as Record<string, unknown>);
    const webApp = parsed.find((schema) => schema['@type'] === 'WebApplication');

    expect(webApp).toBeTruthy();
    expect(webApp?.description).toContain('indexed files');
    expect(JSON.stringify(webApp)).not.toContain('LSP/MCP-grounded');
  });

  test('curated repositories are crawlable links', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'Linux', exact: true })).toHaveAttribute(
      'href',
      '/linux-kernel/'
    );
  });

  test('unrelated one-segment routes remain 404s', async ({ request }) => {
    const response = await request.get('/definitely-not-a-gitshaman-route/');
    expect(response.status()).toBe(404);
  });

  test('has proper heading hierarchy', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Check for h1
    const h1 = await page.locator('main h1:visible').count();
    expect(h1).toBeGreaterThan(0);
    expect(h1).toBeLessThanOrEqual(1); // Should have exactly one h1

    // Check that headings are in order (no h3 without h2, etc.)
    const headings = await page.$$eval(
      'main h1, main h2, main h3, main h4, main h5, main h6',
      (elements) =>
        elements.map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim() || '',
        }))
    );

    let lastLevel = 0;
    for (const heading of headings) {
      const level = parseInt(heading.tag.charAt(1));
      // Allow skipping levels down but not up
      if (lastLevel > 0 && level > lastLevel + 1) {
        // This is a warning, not a failure, but we'll log it
        console.warn(`Heading hierarchy issue: ${heading.tag} after h${lastLevel}`);
      }
      lastLevel = level;
    }
  });

  test('has semantic HTML structure', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Check for semantic elements
    const main = await page.locator('main').count();
    const nav = await page.locator('nav').count();
    const header = await page.locator('header').count();

    // At least one semantic element should be present
    expect(main + nav + header).toBeGreaterThan(0);
  });

  test('has proper alt text for images', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const missingAltSrc = await page.$$eval('main img', (images) => {
      const missingAlt = images.find(
        (img) => !img.hasAttribute('alt') && img.getAttribute('role') !== 'presentation'
      );
      return missingAlt?.getAttribute('src') ?? null;
    });

    // Empty alt text is valid for decorative images; a missing alt attribute is not.
    if (missingAltSrc) {
      throw new Error(`Image missing alt text: ${missingAltSrc}`);
    }
  });

  test('has proper lang attribute', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBeTruthy();
    expect(lang?.length).toBeGreaterThan(0);
  });
});
