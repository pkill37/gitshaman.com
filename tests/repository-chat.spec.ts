import { expect, test } from '@playwright/test';

test('repository chat loads on demand and preserves drafts across sidebar navigation', async ({
  page,
}) => {
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
  await guide.focus();
  await page.keyboard.press('ArrowRight');
  await expect(chat).toBeFocused();
  await expect(chat).toHaveAttribute('aria-selected', 'true');
  const comment = page
    .frameLocator('giscus-widget iframe')
    .getByRole('textbox', { name: 'Comment' });
  await comment.fill('A draft about this repository');
  const widgetUrl = new URL(requests[0]);
  expect(widgetUrl.searchParams.get('term')).toBe('gitshaman:repo:python/cpython');
  expect(widgetUrl.searchParams.get('strict')).toBe('1');
  await guide.click();
  await chat.click();
  await expect(comment).toHaveValue('A draft about this repository');
  await page.getByRole('button', { name: 'Hide guide sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Show guide sidebar', exact: true }).click();
  await expect(comment).toHaveValue('A draft about this repository');
  expect(requests).toHaveLength(1);
});

test('chat offers a retry when the discussion service fails', async ({ page }) => {
  test.skip(
    !process.env.NEXT_PUBLIC_GISCUS_REPO_ID,
    'Run with the documented giscus test configuration.'
  );
  let attempts = 0;
  await page.route('https://giscus.app/**', async (route) => {
    attempts++;
    const message = attempts === 1 ? { error: 'Service unavailable' } : { resizeHeight: 320 };
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>parent.postMessage({ giscus: ${JSON.stringify(message)} }, '*');</script>`,
    });
  });
  await page.goto('/cpython', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByText('Discussion could not be loaded.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Retry discussion' }).click();
  await expect(page.getByRole('button', { name: 'Retry discussion' })).toHaveCount(0);
  await expect.poll(() => attempts).toBe(2);
});
