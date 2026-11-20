import { expect, test } from '@playwright/test';
import { marked } from 'marked';
import { createRepoMarkdownRenderer } from '../src/lib/markdown-renderer';

test('cross-repository code links render one colored tag', async ({ page }) => {
  await page.goto('/cpython/');
  for (const symbol of ['pthread_create', 'kernel_clone']) {
    const link = page
      .locator(`[data-guide-markdown]:visible a[data-repo-owner][data-search-pattern="${symbol}"]`)
      .first();
    await expect(link).toBeVisible({ timeout: 60000 });
    await expect(link).toHaveClass('inline-code-link');
    await expect(link.locator('a')).toHaveCount(0);
    await expect(link.locator('.external-repo-reference-icon')).toHaveCount(1);
    const code = link.locator('code');
    await expect(code).toHaveCSS('border-top-width', '0px');
    await expect(code).toHaveCSS('background-image', 'none');
    await expect(code).toHaveCSS('box-shadow', 'none');
    expect(await code.evaluate((element) => getComputedStyle(element).color)).toBe(
      await link.evaluate((element) => getComputedStyle(element).color)
    );
  }
});

test('guide and preview styles render local, remote, mixed and emphasized code links as single tags', async ({
  page,
}) => {
  const markdown = [
    '[`read` wrapper](repo:bminor/glibc/sysdeps/unix/sysv/linux/read.c:__libc_read)',
    '[**`__libc_malloc`**](malloc/malloc.c:__libc_malloc)',
    '[call `malloc` here](malloc/malloc.c:__libc_malloc)',
    '[`repo:torvalds/linux/kernel/fork.c:kernel_clone`](repo:torvalds/linux/kernel/fork.c:kernel_clone)',
    '[`manual`](https://example.com)',
    '[`threads`](#threads)',
    '`malloc/malloc.c`',
    '`malloc`',
  ].join('\n\n');
  const html = marked.parse(markdown, {
    renderer: createRepoMarkdownRenderer(),
  }) as string;
  await page.goto('/');
  await page.evaluate((html) => {
    for (const attribute of ['data-guide-markdown', 'data-markdown-preview']) {
      const wrapper = document.createElement('section');
      wrapper.setAttribute(attribute, '');
      wrapper.setAttribute('data-link-audit', '');
      wrapper.innerHTML = html;
      document.body.append(wrapper);
    }
  }, html);
  const wrappers = page.locator('[data-link-audit]');
  for (const wrapper of await wrappers.all()) {
    await expect(wrapper.locator('a')).toHaveCount(6);
    await expect(wrapper.locator('a code').filter({ hasText: 'malloc/malloc.c' })).toHaveCount(0);
    for (const link of await wrapper.locator('a').all()) {
      await expect(link).toHaveClass('inline-code-link');
      await expect(link.locator('a')).toHaveCount(0);
      const code = link.locator('code');
      await expect(code).toHaveCSS('border-top-width', '0px');
      await expect(code).toHaveCSS('background-image', 'none');
      await expect(code).toHaveCSS('box-shadow', 'none');
      expect(await code.evaluate((element) => getComputedStyle(element).color)).toBe(
        await link.evaluate((element) => getComputedStyle(element).color)
      );
    }
    await expect(wrapper.locator('.external-repo-reference-icon')).toHaveCount(2);
  }
});

test('repository history keeps previews across links, reloads and arbitrary returns', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    });
  });
  // History navigation works independently of source loading and its large indexes.
  await page.route('**/repos/**', (route) => route.abort());
  const sourcePageRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/gnu-c-library/file/')) {
      sourcePageRequests.push(request.url());
    }
  });
  await page.goto('/cpython/');
  const crossRepoLink = page
    .locator(
      '[data-guide-markdown]:visible a[data-repo-owner][data-search-pattern="pthread_create"]'
    )
    .first();
  await expect(crossRepoLink).toBeVisible({ timeout: 60000 });
  const destination = await crossRepoLink.getAttribute('data-repo-name');
  await crossRepoLink.click();

  const history = page.getByRole('navigation', { name: 'Navigation History' });
  await expect(history).toBeVisible({ timeout: 60000 });
  await expect(history.locator('a')).toHaveCount(2);
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.locator('.repository-history-arrow')).toHaveCount(1);
  const chronologicalSteps = await history.getByRole('listitem').evaluateAll((steps) =>
    steps.map((step) => {
      const rect = step.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    })
  );
  expect(chronologicalSteps[1].x).toBeGreaterThan(chronologicalSteps[0].x);
  expect(chronologicalSteps[1].y).toBe(chronologicalSteps[0].y);
  await expect(history.locator('a').first()).toContainText('cpython');
  await expect(history.locator('a[aria-current="location"]')).not.toContainText('cpython');
  if (destination) await expect(history.locator('a').last()).toContainText(destination);
  const destinationUrl = page.url();
  expect(new URL(destinationUrl).pathname).toBe('/gnu-c-library/');
  expect(new URL(destinationUrl).searchParams.get('file')).toBe('nptl/pthread_create.c');
  expect(new URL(destinationUrl).searchParams.get('search')).toBe('pthread_create');

  await page.reload();
  await expect(history.locator('a')).toHaveCount(2, { timeout: 60000 });
  expect(new URL(page.url()).pathname).toBe('/gnu-c-library/');
  await history.locator('a').first().click();
  await expect(page).toHaveURL(/\/cpython\//, { timeout: 60000 });
  await expect(history.locator('a')).toHaveCount(3, { timeout: 60000 });
  await expect(history.locator('a').nth(1)).not.toContainText('cpython');
  await history.locator('a').nth(1).click();
  await expect(history.locator('a')).toHaveCount(4, { timeout: 60000 });
  expect(new URL(page.url()).pathname.split('/')[1]).toBe(
    new URL(destinationUrl).pathname.split('/')[1]
  );
  expect(new URL(page.url()).searchParams.get('file')).toBe('nptl/pthread_create.c');
  expect(sourcePageRequests).toEqual([]);
  const removedId = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gitshaman:repository-history:v1')!)[0].id as string
  );
  const currentUrl = page.url();
  await history.getByRole('button', { name: /^Remove visit 1:/ }).click();
  await expect(history.locator('a')).toHaveCount(3);
  await expect(history.locator('.repository-history-arrow')).toHaveCount(2);
  expect(page.url()).toBe(currentUrl);
  await expect(
    page.getByRole('button', { name: 'Navigation History 3', exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(history.locator('a')).toHaveCount(3);
  expect(
    await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem('gitshaman:repository-history:v1')!).some(
          (visit: { id: string }) => visit.id === id
        ),
      removedId
    )
  ).toBe(false);
  await history.locator('[data-current] button').click();
  await expect(history.locator('a')).toHaveCount(2);
  await expect(history.locator('[aria-current]')).toHaveCount(0);
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('search', 'updated');
    window.history.pushState(null, '', url);
  });
  await expect(history.locator('a')).toHaveCount(2);
  await history.getByRole('button', { name: /^Remove visit 1:/ }).click();
  await expect(history).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Navigation History 1', exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('gitshaman:repository-history:v1')!))
  ).toHaveLength(1);
});
