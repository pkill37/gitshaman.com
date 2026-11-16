import { encodePath, getManifestFiles, type PagesFunctionContext } from '../../_source-page';

const SITEMAP_CHUNK_SIZE = 45_000;

export async function onRequestGet(context: PagesFunctionContext): Promise<Response> {
  const repoSlug = context.params.repoSlug;
  const chunkValue = context.params.chunk;
  if (typeof repoSlug !== 'string' || typeof chunkValue !== 'string') {
    return new Response('Not found', { status: 404 });
  }
  const chunk = Number(chunkValue);
  if (!Number.isInteger(chunk) || chunk < 0) return new Response('Not found', { status: 404 });

  const files = await getManifestFiles(repoSlug, context.env);
  const entries = files
    .slice(chunk * SITEMAP_CHUNK_SIZE, (chunk + 1) * SITEMAP_CHUNK_SIZE)
    .map(
      (filePath) =>
        `<url><loc>${new URL(context.request.url).origin}/${repoSlug}/file/${encodePath(filePath)}/</loc></url>`
    )
    .join('');
  if (!entries) return new Response('Not found', { status: 404 });

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,
    {
      headers: {
        'content-type': 'application/xml; charset=UTF-8',
        'cache-control': 'public, s-maxage=3600',
      },
    }
  );
}
