import { expect, test } from '@playwright/test';

test('repository chat mounts once across tab and sidebar navigation', async ({ page }) => {
  test.skip(
    !process.env.NEXT_PUBLIC_GISCUS_REPO_ID,
    'Run with the documented giscus test configuration.'
  );
  const requests: string[] = [];
  await page.route('https://giscus.app/**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <label>Comment<textarea aria-label="Comment"></textarea></label>
        <script>
          parent.postMessage({ giscus: { resizeHeight: 320, discussion: { url: 'https://github.com/pkill37/gitshaman.com/discussions/123' } } }, '*');
        </script>
      </body></html>`,
    });
  });
  await page.goto('/cpython', { waitUntil: 'domcontentloaded' });
  const guide = page.getByRole('tab', { name: 'Guide', exact: true });
  const chat = page.getByRole('tab', { name: 'Chat', exact: true });
  await expect(guide).toHaveAttribute('aria-selected', 'true');
  expect(requests).toHaveLength(0);
  await chat.click();
  await expect(chat).toHaveAttribute('aria-selected', 'true');
  const comment = page
    .frameLocator('giscus-widget iframe')
    .getByRole('textbox', { name: 'Comment' });
  await expect(comment).toBeVisible();
  const widgetUrl = new URL(requests[0]);
  expect(widgetUrl.searchParams.get('term')).toBe('gitshaman:repo:python/cpython');
  expect(widgetUrl.searchParams.get('strict')).toBe('1');
  await guide.click();
  await chat.click();
  await page.getByRole('button', { name: 'Hide guide sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Show guide sidebar', exact: true }).click();
  expect(requests).toHaveLength(1);
});
