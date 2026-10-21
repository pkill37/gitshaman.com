import { expect, test } from '@playwright/test';

test('activity buttons toggle a single pane beside the editor', async ({ page }) => {
  await page.goto('/cpython', { waitUntil: 'domcontentloaded' });
  const explorer = page.getByRole('button', { name: 'File editor', exact: true });
  const search = page.getByRole('button', { name: 'File search', exact: true });
  const chat = page.getByRole('button', { name: 'Chat', exact: true });
  const sidebar = page.getByRole('main').locator('.vscode-sidebar');
  const discussion = page.getByRole('region', { name: 'Repository discussion' });

  await expect(sidebar).toBeVisible();
  const resizer = page.getByRole('separator', { name: 'Resize left pane' });
  await resizer.focus();
  await resizer.press('ArrowRight');
  const sharedWidth = await resizer.getAttribute('aria-valuenow');
  await expect(sidebar).toHaveCSS('width', `${sharedWidth}px`);
  await explorer.click();
  await expect(explorer).toHaveAttribute('aria-pressed', 'false');
  await expect(sidebar).toHaveCount(0);
  await explorer.click();
  await expect(sidebar).toBeVisible();
  await search.click();
  await expect(explorer).toHaveAttribute('aria-pressed', 'false');
  await expect(search).toHaveAttribute('aria-pressed', 'true');
  await expect(sidebar).toHaveCSS('width', `${sharedWidth}px`);
  await chat.click();
  await expect(search).toHaveAttribute('aria-pressed', 'false');
  await expect(sidebar).toHaveCount(0);
  await expect(discussion).toBeVisible();
  await expect(page.locator('.repository-panel-chat')).toHaveCSS('width', `${sharedWidth}px`);
  await expect(page.locator('.vscode-editor-container')).toBeVisible();
  await chat.click();
  await expect(discussion).toBeHidden();
  await expect(chat).toHaveAttribute('aria-pressed', 'false');
});

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
  const editor = page.getByRole('button', { name: 'File editor', exact: true });
  const chat = page.getByRole('button', { name: 'Chat', exact: true });
  await expect(editor).toHaveAttribute('aria-pressed', 'true');
  expect(requests).toHaveLength(0);
  await chat.click();
  await expect(chat).toHaveAttribute('aria-pressed', 'true');
  const comment = page
    .frameLocator('giscus-widget iframe')
    .getByRole('textbox', { name: 'Comment' });
  await expect(comment).toBeVisible();
  const widgetUrl = new URL(requests[0]);
  expect(widgetUrl.searchParams.get('term')).toBe('gitshaman:repo:python/cpython');
  expect(widgetUrl.searchParams.get('strict')).toBe('1');
  await editor.click();
  await expect(comment).toBeHidden();
  await chat.click();
  await expect(comment).toBeVisible();
  await page.getByRole('button', { name: 'Hide guide sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Show guide sidebar', exact: true }).click();
  expect(requests).toHaveLength(1);
});
