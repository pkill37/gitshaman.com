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
    renderer: createRepoMarkdownRenderer({ symbolScopePaths: ['malloc/malloc.c'] }),
  }) as string;
  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Software ecosystem map', exact: true })
  ).toHaveAttribute('aria-busy', 'false');
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
    await expect(wrapper.locator('a')).toHaveCount(8);
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
