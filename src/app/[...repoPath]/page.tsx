import { Suspense } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import RepositoryExplorerClient from '@/features/repository/RepositoryExplorerClient';
import { getCuratedRepoRouteParams, resolveCuratedRepoRoute } from '@/lib/curated-repos';
import { getCuratedGuideByRepo, type GuideDocument } from '@/features/guides/docs-loader';
import { parseGitHubUrl } from '@/lib/github-url';

// Arbitrary repositories are served by the static app-shell fallback. Keeping
// this false lets Next's static export remain valid for the curated paths.
export const dynamicParams = false;

export async function generateStaticParams() {
  return getCuratedRepoRouteParams();
}

function WorkspaceBootFallback({ title, description }: { title: string; description: string }) {
  return (
    <div className="shaman-workspace-enter shaman-workspace-boot vscode-theme-dark" role="status">
      <div className="shaman-workspace-boot-panel">
        <p className="shaman-workspace-boot-kicker">Loading source workspace</p>
        <p className="shaman-workspace-boot-title">{title}</p>
        <p>{description}</p>
        <div className="shaman-workspace-boot-steps" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function NoScriptRepositorySummary({ title, description }: { title: string; description: string }) {
  return (
    <noscript>
      <section style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <h2>{title}</h2>
        <p>{description}</p>
      </section>
    </noscript>
  );
}

function extractGuideSummary(guide: GuideDocument | null) {
  if (!guide) {
    return {
      chapters: [] as string[],
      directories: [] as Array<{ path: string; description: string }>,
    };
  }
  const chapters = [...guide.content.matchAll(/^title:\s*(.+)$/gm)]
    .map((match) => match[1].trim())
    .slice(0, 6);
  const directories = [
    ...guide.content.matchAll(/- path:\s*([^\n]+\/)[\s\S]*?description:\s*([^\n]+)/g),
  ]
    .map((match) => ({ path: match[1].trim(), description: match[2].trim() }))
    .filter(
      (entry, index, entries) => entries.findIndex((item) => item.path === entry.path) === index
    )
    .slice(0, 6);
  return { chapters, directories };
}

function CuratedRepositorySeoSummary({
  displayName,
  description,
  githubUrl,
  guide,
}: {
  displayName: string;
  description: string;
  githubUrl: string;
  guide: GuideDocument | null;
}) {
  const { chapters, directories } = extractGuideSummary(guide);
  return (
    <section className="sr-only" aria-labelledby="repo-summary-title">
      <div>
        <p className="shaman-repo-seo-kicker">Curated source guide</p>
        <h1 id="repo-summary-title">{displayName} source explorer</h1>
        <p>{description}</p>
        <a href={githubUrl}>View upstream repository</a>
      </div>
      {chapters.length > 0 && (
        <div>
          <h2>Guide chapters</h2>
          <ol>
            {chapters.map((chapter) => (
              <li key={chapter}>{chapter}</li>
            ))}
          </ol>
        </div>
      )}
      {directories.length > 0 && (
        <div>
          <h2>Key directories</h2>
          <ul>
            {directories.map((directory) => (
              <li key={directory.path}>
                <code>{directory.path}</code> — {directory.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

interface PageProps {
  params: Promise<{
    repoPath: string[];
  }>;
}

export default async function RepositoryRoutePage({ params }: PageProps) {
  const { repoPath } = await params;
  const resolved = resolveCuratedRepoRoute(repoPath);

  if (!resolved && repoPath.length < 2) notFound();

  if (!resolved) {
    const directTarget = parseGitHubUrl(`https://github.com/${repoPath.join('/')}`);
    if (!directTarget) notFound();
    return (
      <>
        <NoScriptRepositorySummary
          title={`${directTarget.owner}/${directTarget.repo} source explorer`}
          description="Browse repository source code, files, and guide context with JavaScript enabled."
        />
        <Suspense
          fallback={
            <WorkspaceBootFallback
              title={`${directTarget.owner}/${directTarget.repo} source explorer`}
              description="Loading the requested public GitHub repository."
            />
          }
        >
          <RepositoryExplorerClient
            owner={directTarget.owner}
            repo={directTarget.repo}
            directTarget={directTarget}
            loadingTitle={`${directTarget.owner}/${directTarget.repo} source explorer`}
            loadingDescription="Loading the requested public GitHub repository."
          />
        </Suspense>
      </>
    );
  }

  if (resolved.isLegacyPath) {
    permanentRedirect(resolved.canonicalPath);
  }

  const guide = getCuratedGuideByRepo(resolved.config.owner, resolved.config.repo);

  return (
    <>
      <NoScriptRepositorySummary
        title={`${resolved.config.displayName} source explorer`}
        description={`${resolved.config.seoDescription} Explore the repository's kernel architecture and source guide with JavaScript enabled.`}
      />
      <CuratedRepositorySeoSummary
        displayName={resolved.config.displayName}
        description={resolved.config.seoDescription}
        githubUrl={`https://github.com/${resolved.config.owner}/${resolved.config.repo}`}
        guide={guide}
      />
      <Suspense
        fallback={
          <WorkspaceBootFallback
            title={`${resolved.config.displayName} source explorer`}
            description={resolved.config.seoDescription}
          />
        }
      >
        <RepositoryExplorerClient
          owner={resolved.config.owner}
          repo={resolved.config.repo}
          guideContent={guide?.content}
          guideDefaultOpenIds={guide?.metadata.defaultOpenIds}
          loadingTitle={`${resolved.config.displayName} source explorer`}
          loadingDescription={resolved.config.seoDescription}
        />
      </Suspense>
    </>
  );
}
