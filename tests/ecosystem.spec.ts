import { expect, test } from '@playwright/test';

test('overview map supports keyboard selection, context nodes and source trails', async ({
  page,
}) => {
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Software ecosystem map', exact: true });
  await expect(map).toBeVisible();
  const rust = map.getByRole('button', { name: 'Rust · compiler', exact: true });
  await expect(rust).toBeEnabled();
  await rust.focus();
  await page.keyboard.press('Enter');
  await expect(rust).toHaveAttribute('aria-pressed', 'true');
  await expect(map.getByRole('link', { name: /Open Rust/ })).toHaveCount(0);
  await map.getByText('Relationships and source trails for Rust', { exact: true }).click();
  await expect(map.getByRole('link', { name: 'Rust Compiler Development Guide' })).toBeVisible();
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await map.getByRole('button', { name: 'Reset zoom' }).click();
  await map.getByText('How software fits together', { exact: true }).click();
  await expect(map.getByRole('link', { name: 'Linux ksys_read()' })).toHaveAttribute(
    'href',
    /file=fs%2Fread_write.c&search=ksys_read/
  );
});

test('landing source links retain symbols and guides do not render the ecosystem', async ({
  page,
}) => {
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Software ecosystem map', exact: true });
  await expect(map).toHaveAttribute('aria-busy', 'false');
  await map.getByText('How software fits together', { exact: true }).click();
  await map.getByRole('link', { name: 'glibc __libc_read()' }).click();
  await expect(page).toHaveURL(
    /gnu-c-library\/?\?file=sysdeps%2Funix%2Fsysv%2Flinux%2Fread.c&search=__libc_read/
  );
  await expect(page.getByRole('tab', { selected: true }).filter({ visible: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(
    page.getByRole('region', { name: 'Software ecosystem map', exact: true })
  ).toHaveCount(0);
  await expect(page.locator('.ecosystem-guide')).toHaveCount(0);
});

test('ecosystem fits mobile viewport and exposes scrollable diagram @mobile', async ({ page }) => {
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Software ecosystem map', exact: true });
  await expect(map).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await map.getByRole('button', { name: 'Swift · compiler' }).click();
  await expect(map.getByRole('heading', { name: 'Swift', exact: true })).toBeVisible();
});
