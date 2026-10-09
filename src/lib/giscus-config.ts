export interface GiscusConfig {
  repo: `${string}/${string}`;
  repoId: string;
  category: string;
  categoryId: string;
}

export function getGiscusConfig(): GiscusConfig | null {
  const repo = process.env.NEXT_PUBLIC_GISCUS_REPO?.trim() || 'pkill37/gitshaman.com';
  const repoId =
    process.env.NEXT_PUBLIC_GISCUS_REPO_ID?.trim() ||
    (repo === 'pkill37/gitshaman.com' ? 'R_kgDOQh8H3w' : undefined);
  const category =
    process.env.NEXT_PUBLIC_GISCUS_CATEGORY?.trim() ||
    (repo === 'pkill37/gitshaman.com' ? 'Q&A' : undefined);
  const categoryId =
    process.env.NEXT_PUBLIC_GISCUS_CATEGORY_ID?.trim() ||
    (repo === 'pkill37/gitshaman.com' && category === 'Q&A' ? 'DIC_kwDOQh8H384CzaBX' : undefined);
  if (!/^[\w-]+\/[\w.-]+$/.test(repo) || !repoId || !category || !categoryId) return null;
  return { repo: repo as GiscusConfig['repo'], repoId, category, categoryId };
}

export function getRepositoryDiscussionTerm(owner: string, repo: string): string {
  return `gitshaman:repo:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}
