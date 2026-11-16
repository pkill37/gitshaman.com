import { CURATED_REPOS } from '../src/lib/curated-repos';
import { getManifestFiles, type PagesFunctionContext } from './_source-page';

const SITEMAP_CHUNK_SIZE = 45_000;

export async function onRequestGet(context: PagesFunctionContext): Promise<Response> {
  const origin = new URL(context.request.url).origin;
  const chunks = await Promise.all(
    CURATED_REPOS.map(async (repo) => {
      const files = await getManifestFiles(repo.slug, context.env);
      return Array.from(
        { length: Math.ceil(files.length / SITEMAP_CHUNK_SIZE) },
        (_, chunk) => `${origin}/sitemap/${repo.slug}/${chunk}`
      );
    })
  );
  const locations = [`${origin}/sitemap/base`, ...chunks.flat()]
    .map((url) => `<sitemap><loc>${url}</loc></sitemap>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations}</sitemapindex>`,
    {
      headers: {
        'content-type': 'application/xml; charset=UTF-8',
        'cache-control': 'public, s-maxage=3600',
      },
    }
  );
}
