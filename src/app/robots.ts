import { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site';

export const dynamic = 'force-static';

const siteUrl = getSiteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
