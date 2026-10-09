import { test, expect } from '@playwright/test';

async function installVitalsObservers(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const state = { lcp: 0, cls: 0, longTasks: [] as number[] };
    Object.assign(window, { __gitshamanVitals: state });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const paint = entry as PerformanceEntry & { renderTime?: number; loadTime?: number };
        state.lcp = paint.renderTime || paint.loadTime || entry.startTime;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!shift.hadRecentInput) state.cls += shift.value ?? 0;
      }
    }).observe({ type: 'layout-shift', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
}

async function readVitals(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const state = (
      window as typeof window & {
        __gitshamanVitals: { lcp: number; cls: number; longTasks: number[] };
      }
    ).__gitshamanVitals;
    return {
      ...state,
      totalBlockingTime: state.longTasks.reduce(
        (total, duration) => total + Math.max(0, duration - 50),
        0
      ),
    };
  });
}

/**
 * Web Vitals Performance Tests
 * Measures Core Web Vitals: LCP, FID, CLS, FCP, TTFB
 */
test.describe('Web Vitals Performance', () => {
  test.skip(
    process.env.PERFORMANCE_BUILD !== '1',
    'Performance budgets are only stable against the production export. Run with PERFORMANCE_BUILD=1.'
  );

  test('homepage meets performance thresholds', async ({ page }) => {
    await installVitalsObservers(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const vitals = await readVitals(page);

    // LCP should be under 2.5s for good performance
    expect(vitals.lcp).toBeGreaterThan(0);
    expect(vitals.lcp).toBeLessThanOrEqual(2500);
    expect(vitals.cls).toBeLessThanOrEqual(0.1);
    expect(vitals.totalBlockingTime).toBeLessThanOrEqual(200);

    // Measure First Contentful Paint (FCP)
    const fcp = await page.evaluate(() => {
      const paintEntries = performance.getEntriesByType('paint');
      const fcpEntry = paintEntries.find((entry) => entry.name === 'first-contentful-paint');
      return fcpEntry ? fcpEntry.startTime : 0;
    });

    // FCP should be under 1.8s
    expect(fcp).toBeLessThan(1800);

    // Measure Time to First Byte (TTFB)
    const ttfb = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        'navigation'
      )[0] as PerformanceNavigationTiming;
      return navigation.responseStart - navigation.requestStart;
    });

    // TTFB should be under 800ms
    expect(ttfb).toBeLessThan(800);
  });

  test('repository page meets performance thresholds', async ({ page }) => {
    await page.goto('/linux-kernel', { waitUntil: 'domcontentloaded' });

    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        'navigation'
      )[0] as PerformanceNavigationTiming;
      const paintEntries = performance.getEntriesByType('paint');
      const fcpEntry = paintEntries.find((entry) => entry.name === 'first-contentful-paint');

      return {
        ttfb: navigation.responseStart - navigation.requestStart,
        fcp: fcpEntry ? fcpEntry.startTime : 0,
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.fetchStart,
        loadComplete: navigation.loadEventEnd - navigation.fetchStart,
      };
    });

    expect(metrics.ttfb).toBeLessThan(800);
    expect(metrics.fcp).toBeLessThan(1800);
    expect(metrics.domContentLoaded).toBeLessThan(3000);
    expect(metrics.loadComplete).toBeLessThan(5000);
  });

  test('bundle size is reasonable', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const resources = await page.evaluate(() => {
      return performance.getEntriesByType('resource').map((entry) => {
        const resourceEntry = entry as PerformanceResourceTiming;
        return {
          name: resourceEntry.name,
          size: resourceEntry.transferSize,
          type: resourceEntry.initiatorType,
        };
      });
    });

    const jsResources = resources.filter((r) => r.type === 'script');
    const totalJSSize = jsResources.reduce((sum: number, r) => sum + r.size, 0);

    // The production export has a stricter deterministic gzip budget; this catches network regressions.
    expect(totalJSSize).toBeLessThan(300 * 1024);

    const remoteImages = resources.filter(
      (resource) =>
        resource.type === 'img' && new URL(resource.name).origin !== new URL(page.url()).origin
    );
    expect(remoteImages).toHaveLength(0);
  });
});
