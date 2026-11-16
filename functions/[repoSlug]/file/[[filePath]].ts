import {
  escapeHtml,
  fetchSourcePreview,
  getFilePath,
  getSourcePageData,
  type PagesFunctionContext,
} from '../../_source-page';

export async function onRequestGet(context: PagesFunctionContext): Promise<Response> {
  const repoSlug = context.params.repoSlug;
  const filePath = getFilePath(context.params);
  if (typeof repoSlug !== 'string' || !filePath) {
    return new Response('Not found', { status: 404 });
  }

  const page = getSourcePageData(repoSlug, filePath);
  if (!page) return new Response('Not found', { status: 404 });

  const sourcePreview = await fetchSourcePreview(
    page.repo.owner,
    page.repo.repo,
    page.repo.revision,
    filePath,
    context.env
  );
  if (sourcePreview === null) return new Response('Not found', { status: 404 });

  const requestUrl = new URL(context.request.url);
  const canonicalUrl = `${requestUrl.origin}${page.canonicalPath}`;
  const title = `${page.fileName} — ${page.repo.displayName} source`;
  const description = `Read ${filePath} in the pinned ${page.repo.displayName} source tree on GitShaman.`;
  const githubPath = filePath.split('/').map(encodeURIComponent).join('/');
  const githubUrl = `https://github.com/${page.repo.owner}/${page.repo.repo}/blob/${page.repo.revision}/${githubPath}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | gitshaman.com</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
</head>
<body>
  <main>
    <nav><a href="${escapeHtml(page.explorerPath)}">Open in GitShaman</a> · <a href="${escapeHtml(githubUrl)}">View on GitHub</a></nav>
    <article>
      <p>${escapeHtml(page.repo.displayName)} source file</p>
      <h1>${escapeHtml(filePath)}</h1>
      <p>${escapeHtml(description)}</p>
      <pre><code>${escapeHtml(sourcePreview)}</code></pre>
    </article>
  </main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      'cache-control': 'public, max-age=300, s-maxage=86400',
    },
  });
}
