import { MetadataRoute } from 'next';
import { CURATED_REPOS } from '@/lib/curated-repos';
import { getSiteUrl } from '@/lib/site';

export const dynamic = 'force-static';

const siteUrl = getSiteUrl();

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    ...CURATED_REPOS.map(({ slug, sitemapPriority }) => ({
      url: `${siteUrl}/${slug}/`,
      changeFrequency: 'weekly' as const,
      priority: sitemapPriority,
    })),
  ];
}
