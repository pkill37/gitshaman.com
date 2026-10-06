import { test, expect, type Locator, type Page } from '@playwright/test';

const BUG_REPORT_ROUTE = '/linux-kernel';

async function openBugReportDialog(page: Page): Promise<Locator> {
  await page.goto(BUG_REPORT_ROUTE, { waitUntil: 'domcontentloaded' });
  const reportButton = page.getByRole('button', { name: 'Report a bug' });
  await expect(reportButton).toBeVisible();
  await page.waitForFunction(() => window.__explorarBugReportConsoleCaptureReady === true);
  await reportButton.click();

  const dialog = page.getByRole('dialog', { name: 'Report a bug' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function readGeneratedIssue(page: Page) {
  const href = await page.getByRole('link', { name: 'Open GitHub Issue' }).getAttribute('href');
  expect(href).toBeTruthy();

  const url = new URL(href ?? '');
  return {
    href: href ?? '',
    title: url.searchParams.get('title') ?? '',
    body: url.searchParams.get('body') ?? '',
    labels: url.searchParams.get('labels') ?? '',
  };
}

test.describe('Static bug reporting', () => {
  test('opens a GitHub issue with diagnostics, console logs, and screenshot preview', async ({
    page,
  }) => {
    await page.goto(BUG_REPORT_ROUTE, { waitUntil: 'domcontentloaded' });
    const reportButton = page.getByRole('button', { name: 'Report a bug' });
    await expect(reportButton).toBeVisible();
    await page.waitForFunction(() => window.__explorarBugReportConsoleCaptureReady === true);

    await page.evaluate(() => {
      window.__explorarBugReportConsoleLogs?.push(
        {
          level: 'warn',
          message: 'bug report test warning',
          timestamp: new Date().toISOString(),
        },
        {
          level: 'error',
          message: 'bug report test error',
          timestamp: new Date().toISOString(),
        }
      );
    });

    await reportButton.click();

    const dialog = page.getByRole('dialog', { name: 'Report a bug' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('bug report test warning')).toBeVisible();
    await expect(dialog.getByText('bug report test error')).toBeVisible();
    await expect(dialog.getByAltText('Captured bug report screenshot preview')).toBeVisible({
      timeout: 15000,
    });

    await dialog
      .getByLabel('What happened?')
      .fill('The repository cards did not respond when clicked.');

    const issueHref = await dialog
      .getByRole('link', { name: 'Open GitHub Issue' })
      .getAttribute('href');

    expect(issueHref).toContain('https://github.com/pkill37/gitshaman.com/issues/new');
    expect(issueHref).toContain('Bug+report%3A+%2Flinux-kernel');
    expect(issueHref).toContain('The+repository+cards+did+not+respond');
    expect(issueHref).toContain('bug+report+test+warning');
    expect(issueHref).toContain('bug+report+test+error');
  });

  test('strips query strings and hashes from the diagnostic URL', async ({ page }) => {
    await page.goto(`${BUG_REPORT_ROUTE}?access_token=secret-token#private-fragment`, {
      waitUntil: 'domcontentloaded',
    });
    const reportButton = page.getByRole('button', { name: 'Report a bug' });
    await expect(reportButton).toBeVisible();
    await page.waitForFunction(() => window.__explorarBugReportConsoleCaptureReady === true);
    await reportButton.click();

    const issue = await readGeneratedIssue(page);
    const sanitizedUrl = new URL(BUG_REPORT_ROUTE, page.url()).toString();

    expect(issue.body).toContain(`- URL: ${sanitizedUrl}`);
    expect(issue.body).not.toContain('access_token=secret-token');
    expect(issue.body).not.toContain('private-fragment');
  });

  test('redacts secrets from user description and console diagnostics', async ({ page }) => {
    const dialog = await openBugReportDialog(page);

    await page.evaluate(() => {
      window.__explorarBugReportConsoleLogs?.push({
        level: 'error',
        message: 'Request failed with Bearer abc123 and ghp_abcdefghijklmnopqrstuvwxyz0123456789',
        timestamp: new Date().toISOString(),
      });
    });

    await dialog
      .getByLabel('What happened?')
      .fill(
        [
          'The page failed with password=hunter2.',
          'The token was ghp_abcdefghijklmnopqrstuvwxyz0123456789.',
          '```',
        ].join('\n')
      );

    const issue = await readGeneratedIssue(page);

    expect(issue.body).toContain('password=[REDACTED]');
    expect(issue.body).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(issue.body).toContain("'''");
    expect(issue.body).not.toContain('hunter2');
    expect(issue.body).not.toContain('Bearer abc123');
    expect(issue.body).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  test('uses the expected GitHub issue metadata for manual reports', async ({ page }) => {
    await openBugReportDialog(page);

    const issue = await readGeneratedIssue(page);

    expect(issue.href).toContain('https://github.com/pkill37/gitshaman.com/issues/new');
    expect(issue.title).toBe('Bug report: /linux-kernel/');
    expect(issue.labels).toBe('bug,user-report');
    expect(issue.body).toContain('## What happened?');
    expect(issue.body).toContain('## Screenshot');
    expect(issue.body).toContain('## Diagnostics');
    expect(issue.body).toContain('## Recent console logs');
  });
});
