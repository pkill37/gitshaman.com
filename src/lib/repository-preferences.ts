import {
  getDefaultCuratedRepoSourceMode,
  normalizeCuratedRepoSourceMode,
} from '@/lib/curated-content-url';
import type { CuratedRepoSourceMode } from '@/lib/repo-static';

export const CORPUS_SOURCE_MODE_STORAGE_KEY = 'repository-workspace-explorer-corpus-source-mode';

export function getStoredCuratedRepoSourceMode(): CuratedRepoSourceMode {
  let nextSourceMode = getDefaultCuratedRepoSourceMode();
  try {
    if (typeof window !== 'undefined') {
      const savedSourceMode = localStorage.getItem(CORPUS_SOURCE_MODE_STORAGE_KEY);
      if (savedSourceMode === 'local-filesystem' || savedSourceMode === 'r2-bucket') {
        nextSourceMode = savedSourceMode;
      }
    }
  } catch {
    // Keep the environment default.
  }
  return normalizeCuratedRepoSourceMode(nextSourceMode);
}
