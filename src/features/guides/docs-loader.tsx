// Auto-discovery system for docs/ markdown guides
import { parseFrontmatter as matter } from '@/lib/frontmatter';
import { getCuratedRepo, isCuratedRepo } from '@/lib/curated-repos';
import { DOCS_MARKDOWN } from './generated-docs';

/**
 * Guide metadata extracted from frontmatter
 */
interface GuideMetadata {
  curatedRepoId: string;
  owner: string;
  repo: string;
  revision: string;
  guideId: string;
  name: string;
  description: string;
  defaultOpenIds: string[];
}

/**
 * Guide with metadata and content
 */
export interface GuideDocument {
  metadata: GuideMetadata;
  content: string;
}

/**
 * Parse guide metadata and content from markdown
 */
function parseGuideDocument(markdown: string, filePath: string): GuideDocument {
  try {
    const { data, content } = matter(markdown);

    // Validate required fields
    const requiredFields = [
      'curatedRepoId',
      'owner',
      'repo',
      'revision',
      'guideId',
      'name',
      'description',
    ];
    const missingFields = requiredFields.filter((field) => !data[field]);

    if (missingFields.length > 0) {
      throw new Error(
        `Missing required frontmatter fields in ${filePath}: ${missingFields.join(', ')}`
      );
    }

    const curatedRepoId = String(data.curatedRepoId);
    const owner = String(data.owner);
    const repo = String(data.repo);
    const revision = String(data.revision);
    const guideId = String(data.guideId);
    const curatedRepo = getCuratedRepo(owner, repo);

    if (!curatedRepo) {
      throw new Error(`Guide ${filePath} references non-curated repo ${owner}/${repo}`);
    }
    if (curatedRepo.id !== curatedRepoId) {
      throw new Error(
        `Guide ${filePath} has curatedRepoId=${curatedRepoId} but config expects ${curatedRepo.id}`
      );
    }
    if (curatedRepo.revision !== revision) {
      throw new Error(
        `Guide ${filePath} has revision=${revision} but config expects ${curatedRepo.revision}`
      );
    }
    if (curatedRepo.guideId !== guideId) {
      throw new Error(
        `Guide ${filePath} has guideId=${guideId} but config expects ${curatedRepo.guideId}`
      );
    }

    return {
      metadata: {
        curatedRepoId,
        owner,
        repo,
        revision,
        guideId,
        name: String(data.name),
        description: String(data.description),
        defaultOpenIds: Array.isArray(data.defaultOpenIds) ? data.defaultOpenIds.map(String) : [],
      },
      content,
    };
  } catch (error) {
    console.error(`Failed to parse guide document ${filePath}:`, error);
    throw error;
  }
}

function getDocsMarkdownSignature(): string {
  return Object.entries(DOCS_MARKDOWN)
    .map(([filePath, markdown]) => `${filePath}:${markdown.length}:${markdown.slice(0, 64)}`)
    .join('|');
}

/**
 * Cache for parsed guide documents. The cache is invalidated whenever the raw
 * imported markdown changes, which matters during local dev / HMR.
 */
let guidesCache: Map<string, GuideDocument> | null = null;
let guidesCacheSignature: string | null = null;

/**
 * Get all guide documents, parsed and cached
 */
function getAllGuideDocuments(): Map<string, GuideDocument> {
  const signature = getDocsMarkdownSignature();

  if (guidesCache && guidesCacheSignature === signature) {
    return guidesCache;
  }

  guidesCache = new Map();
  guidesCacheSignature = signature;

  for (const [filePath, markdown] of Object.entries(DOCS_MARKDOWN)) {
    try {
      const frontmatter = matter(markdown).data;
      const active = getCuratedRepo(String(frontmatter.owner), String(frontmatter.repo));
      if (active?.contribution && active.guideId !== frontmatter.guideId) continue;
      const doc = parseGuideDocument(markdown, filePath);
      guidesCache.set(doc.metadata.guideId, doc);
    } catch (error) {
      console.error(`Failed to load guide from ${filePath}:`, error);
    }
  }

  return guidesCache;
}

/**
 * Get a specific guide by guideId
 */
export function getGuideDocument(guideId: string): GuideDocument | null {
  const guides = getAllGuideDocuments();
  return guides.get(guideId) || null;
}

/**
 * Get guide by owner/repo
 */
export function getGuideByRepo(owner: string, repo: string): GuideDocument | null {
  const guides = getAllGuideDocuments();

  for (const doc of guides.values()) {
    if (doc.metadata.owner === owner && doc.metadata.repo === repo) {
      return doc;
    }
  }

  return null;
}

export function getCuratedGuideByRepo(owner: string, repo: string): GuideDocument | null {
  if (!isCuratedRepo(owner, repo)) {
    return null;
  }

  return getGuideByRepo(owner, repo);
}

/**
 * Get list of all available guide IDs
 */
export function getAvailableGuideIds(): string[] {
  const guides = getAllGuideDocuments();
  return Array.from(guides.keys());
}
