import { Suspense } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import RepositoryExplorerClient from '@/features/repository/RepositoryExplorerClient';
import { getCuratedRepoRouteParams, resolveCuratedRepoRoute } from '@/lib/curated-repos';
import { getCuratedGuideByRepo } from '@/features/guides/docs-loader';
import { parseGitHubUrl } from '@/lib/github-url';

// Arbitrary repositories are served by the static app-shell fallback. Keeping
// this false lets Next's static export remain valid for the curated paths.
export const dynamicParams = false;

export async function generateStaticParams() {
  return getCuratedRepoRouteParams();
}

function WorkspaceBootFallback() {
  return <div className="shaman-workspace-enter shaman-workspace-boot vscode-theme-dark" />;
}

function NoScriptRepositorySummary({ title, description }: { title: string; description: string }) {
  return (
    <noscript>
      <section style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <h1>{title}</h1>
        <p>{description}</p>
      </section>
    </noscript>
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
        <Suspense fallback={<WorkspaceBootFallback />}>
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
      <Suspense fallback={<WorkspaceBootFallback />}>
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
