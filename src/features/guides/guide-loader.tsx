// Guide Loader - Loads markdown guides from docs/ folder and converts them to React components
import { parseGuideMarkdown } from './parser';
import { GuideSection } from '@/lib/project-guides';
import { getGuideDocument, getAvailableGuideIds } from './docs-loader';

/**
 * Load a guide from markdown (docs/ folder) and parse it into React components
 *
 * @param guideId - The unique identifier for the guide (e.g., 'cpython-guide')
 * @param openFileInTab - Callback function to open files in the editor
 * @returns Array of GuideSection objects with interactive React components
 * @throws Error if guide not found or parsing fails
 */
export function loadGuideFromMarkdown(
  guideId: string,
  openFileInTab: (
    path: string,
    searchPattern?: string,
    scrollToLine?: number,
    searchScope?: string[],
    repoTarget?: { owner: string; repo: string }
  ) => void
): GuideSection[] {
  const guideDoc = getGuideDocument(guideId);

  if (!guideDoc) {
    const availableGuides = getAvailableGuideIds();
    throw new Error(`Guide not found: ${guideId}. Available guides: ${availableGuides.join(', ')}`);
  }

  return parseGuideMarkdown(guideDoc.content, openFileInTab);
}
