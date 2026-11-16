import { Suspense } from 'react';
import Link from 'next/link';
import CuratedRepositoryPortalLink from './CuratedRepositoryPortalLink';
import HeroInputSection from './HeroInputSection';
import HomeRoute from './HomeRoute';
import {
  CURATED_REPOS,
  getCuratedRepoAvatarUrl,
  getCuratedRepoPath,
  type CuratedRepoConfig,
} from '@/lib/curated-repos';
import { SOURCE_REPOSITORY_URL, SITE_NAME } from '@/lib/site';

const DISCORD_URL = 'https://discord.gg/fuXYz44tSs';

const CURATED_REPO_CATEGORIES = [
  {
    id: 'os-kernels',
    title: 'OS kernels',
    slugs: [
      'linux-kernel',
      'xnu-kernel',
      'nt5.1-kernel',
      'freebsd-kernel',
      'ghostbsd-kernel',
      'nextbsd-kernel',
      'little-kernel',
      'sel4-microkernel',
      'reactos',
    ],
  },
  {
    id: 'aosp',
    title: 'AOSP',
    slugs: ['lineageos-android', 'grapheneos-platform-manifest'],
  },
  {
    id: 'languages',
    title: 'Languages',
    slugs: [
      'cpython',
      'go-language',
      'typescript-compiler',
      'gnu-c-library',
      'llvm-project',
      'gcc-compiler',
    ],
  },
] as const;

function CuratedRepositoryCard({ repo }: { repo: CuratedRepoConfig }) {
  const content = (
    <>
      <span className="flex items-center gap-3">
        <span className="shaman-repository-card-avatar" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getCuratedRepoAvatarUrl(repo)}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            decoding="async"
          />
        </span>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-[#f8f3e7]">{repo.displayName}</span>
          <span className="mt-1 block text-xs text-gray-400">
            {repo.owner}/{repo.repo}
          </span>
        </span>
      </span>
      <span className="mt-4 block text-sm leading-6 text-gray-300">{repo.description}</span>
    </>
  );
  const className = `shaman-repository-card shaman-explainer-card rounded-xl p-5 ${repo.dimmed ? 'opacity-35 grayscale' : ''}`;

  return repo.dimmed ? (
    <span className={className} aria-label={`${repo.displayName} is currently unavailable`}>
      {content}
    </span>
  ) : (
    <CuratedRepositoryPortalLink
      href={getCuratedRepoPath(repo.owner, repo.repo)}
      githubUrl={`https://github.com/${repo.owner}/${repo.repo}`}
      className={className}
    >
      {content}
    </CuratedRepositoryPortalLink>
  );
}

function LandingPage() {
  const reposBySlug = new Map(CURATED_REPOS.map((repo) => [repo.slug, repo]));
  const repoCategories = CURATED_REPO_CATEGORIES.map((category) => ({
    ...category,
    repos: category.slugs.flatMap((slug) => {
      const repo = reposBySlug.get(slug);
      return repo ? [repo] : [];
    }),
  })).filter((category) => category.repos.length > 0);

  return (
    <div className="shaman-landing code-background relative flex min-h-screen flex-col text-gray-100">
      <div className="circuit-traces" aria-hidden="true">
        <div className="circuit-trace" />
        <div className="circuit-trace" />
        <div className="circuit-trace" />
        <div className="circuit-trace" />
      </div>
      <header className="shaman-brandbar shaman-brandbar--landing relative z-10">
        <Link className="shaman-wordmark" href="/" aria-label={`${SITE_NAME} home`}>
          git<span className="shaman-wordmark-sha">sha</span>man
          <span className="shaman-wordmark-domain">.com</span>
        </Link>
        <div className="shaman-brandbar-context">
          <a
            href={SOURCE_REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="shaman-header-link"
          >
            GitHub
          </a>
          <span className="shaman-sigil" aria-hidden="true">
            ◈
          </span>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="shaman-header-link"
          >
            Discord
          </a>
        </div>
      </header>

      <main className="shaman-landing-main relative z-10 flex flex-1 flex-col items-center px-4 pt-8 pb-10 sm:pt-10">
        <div className="mx-auto w-full max-w-5xl">
          <section className="shaman-url-panel mx-auto mb-14 max-w-5xl rounded-xl p-6 text-center sm:p-8">
            <HeroInputSection>
              <div className="shaman-hero-portals mt-6 text-left">
                <div className="mb-3 text-center text-xs uppercase tracking-[0.16em]">
                  <span className="shaman-panel-label">
                    Curated guides for essential FOSS projects
                  </span>
                </div>
                <div className="space-y-8">
                  {repoCategories.map((category) => (
                    <section key={category.id} aria-labelledby={`repo-category-${category.id}`}>
                      <h2
                        id={`repo-category-${category.id}`}
                        className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[#efc66f]"
                      >
                        {category.title}
                      </h2>
                      <div className="shaman-curated-repo-grid grid gap-4">
                        {category.repos.map((repo) => (
                          <CuratedRepositoryCard key={`${repo.owner}/${repo.repo}`} repo={repo} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </HeroInputSection>
          </section>

          <section aria-labelledby="how-gitshaman-works" className="mx-auto mb-14 max-w-5xl">
            <h2
              id="how-gitshaman-works"
              className="mb-6 text-center text-xl font-semibold text-[#f8f3e7]"
            >
              From source trees to navigable evidence
            </h2>
            <div className="grid gap-4 text-sm leading-6 text-gray-300 md:grid-cols-3">
              <article className="shaman-explainer-card rounded-xl p-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/features/vscode-lsp.svg"
                  alt="VS Code editor connected to LSP diagnostics and symbols"
                  loading="lazy"
                  decoding="async"
                  className="shaman-feature-image mb-4 w-full rounded-lg"
                />
                <h3 className="mb-2 font-semibold text-[#efc66f]">VS Code Editor + LSP</h3>
                <p>
                  Explore repositories in a familiar editor shell with language-aware navigation,
                  diagnostics, symbols, and reference paths.
                </p>
              </article>
              <article className="shaman-explainer-card rounded-xl p-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/features/code-indexing.svg"
                  alt="Repository files flowing into a searchable code index"
                  loading="lazy"
                  decoding="async"
                  className="shaman-feature-image mb-4 w-full rounded-lg"
                />
                <h3 className="mb-2 font-semibold text-[#efc66f]">Code Indexing</h3>
                <p>
                  Turn large source trees into searchable maps of files, symbols, definitions,
                  references, and implementation relationships.
                </p>
              </article>
              <article className="shaman-explainer-card rounded-xl p-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/features/semantic-enrichment.svg"
                  alt="Semantic graph connecting code symbols, files, and relationships"
                  loading="lazy"
                  decoding="async"
                  className="shaman-feature-image mb-4 w-full rounded-lg"
                />
                <h3 className="mb-2 font-semibold text-[#efc66f]">Semantic Enrichment</h3>
                <p>
                  Layer compiler, LSP, guide, and graph context onto code so people and agents can
                  query meaning instead of raw text.
                </p>
              </article>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  const landing = <LandingPage />;
  return (
    <Suspense fallback={landing}>
      <HomeRoute landing={landing} />
    </Suspense>
  );
}
