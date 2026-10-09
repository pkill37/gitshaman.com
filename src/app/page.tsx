import { Suspense } from 'react';
import Link from 'next/link';
import CuratedRepositoryPortalLink from './CuratedRepositoryPortalLink';
import HeroInputSection from './HeroInputSection';
import HomeRoute from './HomeRoute';
import { CURATED_REPOS, getCuratedRepoPath, type CuratedRepoConfig } from '@/lib/curated-repos';
import { SOURCE_REPOSITORY_URL, SITE_NAME } from '@/lib/site';

const DISCORD_URL = 'https://discord.gg/fuXYz44tSs';
const INDEX_REPO_SLUG_ORDER = [
  'linux-kernel',
  'xnu-kernel',
  'nt5.1-kernel',
  'freebsd-kernel',
  'ghostbsd-kernel',
  'nextbsd-kernel',
  'little-kernel',
  'sel4-microkernel',
  'reactos',
  'cpython',
  'gnu-c-library',
  'llvm-project',
] as const;
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
    id: 'languages',
    title: 'Languages',
    slugs: ['cpython', 'go-language', 'typescript-compiler', 'gnu-c-library', 'llvm-project'],
  },
] as const;

function CompactRepositoryPortal({ repo }: { repo: CuratedRepoConfig }) {
  const avatarUrl = `/avatars/${repo.avatarFile ?? `${repo.owner}.png`}`;
  const content = (
    <>
      <span className="shaman-compact-portal-avatar" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarUrl} alt="" width={24} height={24} loading="lazy" decoding="async" />
      </span>
      <span className="min-w-0 flex-1 truncate">{repo.displayName}</span>
    </>
  );
  const className = `shaman-compact-portal ${repo.dimmed ? 'opacity-35 grayscale' : ''}`;

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
  const indexedRepos = [...CURATED_REPOS].sort((a, b) => {
    const aIndex = INDEX_REPO_SLUG_ORDER.indexOf(a.slug as (typeof INDEX_REPO_SLUG_ORDER)[number]);
    const bIndex = INDEX_REPO_SLUG_ORDER.indexOf(b.slug as (typeof INDEX_REPO_SLUG_ORDER)[number]);
    return (
      (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
      (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex)
    );
  });
  const reposBySlug = new Map(indexedRepos.map((repo) => [repo.slug, repo]));
  const categorizedRepoSlugs = new Set<string>(
    CURATED_REPO_CATEGORIES.flatMap((category) => [...category.slugs])
  );
  const repoCategories = [
    ...CURATED_REPO_CATEGORIES.map((category) => ({
      ...category,
      repos: category.slugs.flatMap((slug) => {
        const repo = reposBySlug.get(slug);
        return repo ? [repo] : [];
      }),
    })),
    {
      id: 'more',
      title: 'More',
      repos: indexedRepos.filter((repo) => !categorizedRepoSlugs.has(repo.slug)),
    },
  ].filter((category) => category.repos.length > 0);

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

      <main className="relative z-10 flex flex-1 flex-col items-center px-4 pt-8 pb-10 sm:pt-10">
        <div className="mx-auto w-full max-w-5xl">
          <section className="shaman-url-panel mx-auto mb-14 max-w-3xl rounded-xl p-6 text-center sm:p-8">
            <HeroInputSection>
              <div className="shaman-hero-portals mt-6 text-left">
                <div className="mb-3 text-center text-xs uppercase tracking-[0.16em]">
                  <span className="shaman-panel-label">
                    Curated with care for important free and open-source projects
                  </span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {repoCategories.map((category) => (
                    <div key={category.id} className="shaman-hero-portal-group rounded-lg p-3">
                      <div className="flex flex-wrap gap-2">
                        {category.repos.map((repo) => (
                          <CompactRepositoryPortal key={`${repo.owner}/${repo.repo}`} repo={repo} />
                        ))}
                      </div>
                    </div>
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
