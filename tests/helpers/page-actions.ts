import { expect, type Page } from '@playwright/test';

export async function openGuideFile(page: Page, path: string): Promise<void> {
  const segments = path.split('/');
  for (let index = 0; index < segments.length - 1; index += 1) {
    const directoryPath = segments.slice(0, index + 1).join('/');
    const directoryItem = page.locator(`[data-file-path="${directoryPath}"]`);
    await expect(directoryItem).toBeVisible();
    await directoryItem.click();
  }

  const fileItem = page.locator(`[data-file-path="${path}"]`);
  await expect(fileItem).toBeVisible();
  await fileItem.click();
}
