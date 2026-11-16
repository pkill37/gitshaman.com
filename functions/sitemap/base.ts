import { CURATED_REPOS } from '../../src/lib/curated-repos';
import type { PagesFunctionContext } from '../_source-page';

export function onRequestGet(context: PagesFunctionContext): Response {
  const origin = new URL(context.request.url).origin;
  const urls = [`${origin}/`, ...CURATED_REPOS.map((repo) => `${origin}/${repo.slug}/`)]
    .map((url) => `<url><loc>${url}</loc></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    {
      headers: {
        'content-type': 'application/xml; charset=UTF-8',
        'cache-control': 'public, s-maxage=3600',
      },
    }
  );
}
