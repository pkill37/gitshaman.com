import type { Metadata } from 'next';
import { getCuratedRepoRouteParams, resolveCuratedRepoRoute } from '@/lib/curated-repos';
import { getSiteUrl, SITE_NAME } from '@/lib/site';
import RepositoryAppProvider from '@/features/repository/RepositoryAppProvider';

export const dynamicParams = false;

export async function generateStaticParams() {
  return getCuratedRepoRouteParams();
}

const siteUrl = getSiteUrl();

export async function generateMetadata({
  params,
}: {
  params: Promise<{ repoPath: string[] }>;
}): Promise<Metadata> {
  const { repoPath } = await params;
  const resolved = resolveCuratedRepoRoute(repoPath);

  if (!resolved) {
    return {};
  }

  const { config, canonicalPath, isLegacyPath } = resolved;
  const canonicalUrl = `${siteUrl}${canonicalPath}/`;

  if (isLegacyPath) {
    return {
      title: config.displayName,
      description: `Legacy route for ${config.displayName}. Redirecting to the canonical ${SITE_NAME} URL.`,
      alternates: {
        canonical: canonicalUrl,
      },
      robots: {
        index: false,
        follow: true,
      },
    };
  }

  return {
    title: config.displayName,
    description: config.seoDescription,
    openGraph: {
      title: `${config.displayName} | ${SITE_NAME}`,
      description: config.seoDescription,
      url: canonicalUrl,
      type: 'website',
      siteName: SITE_NAME,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${config.displayName} | ${SITE_NAME}`,
      description: config.seoDescription,
      creator: '@gitshaman',
    },
    alternates: {
      canonical: canonicalUrl,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  };
}

interface RepositoryRouteLayoutProps {
  children: React.ReactNode;
  params: Promise<{ repoPath: string[] }>;
}

export default async function RepositoryRouteLayout({
  children,
  params,
}: RepositoryRouteLayoutProps) {
  const { repoPath } = await params;
  const resolved = resolveCuratedRepoRoute(repoPath);

  if (!resolved) return <RepositoryAppProvider>{children}</RepositoryAppProvider>;
  if (resolved.isLegacyPath) {
    return <RepositoryAppProvider>{children}</RepositoryAppProvider>;
  }

  const { config, canonicalPath } = resolved;
  const repoUrl = `${siteUrl}${canonicalPath}/`;
  const githubUrl = `https://github.com/${config.owner}/${config.repo}`;

  const softwareSourceCodeSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: config.displayName,
    codeRepository: githubUrl,
    url: repoUrl,
    description: config.seoDescription,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: siteUrl,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: config.displayName,
        item: repoUrl,
      },
    ],
  };

  const serializeJsonLd = (value: object) => JSON.stringify(value).replace(/</g, '\\u003c');

  return (
    <RepositoryAppProvider>
      <script
        id="software-source-code-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(softwareSourceCodeSchema),
        }}
      />
      <script
        id="breadcrumb-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(breadcrumbSchema),
        }}
      />
      {children}
    </RepositoryAppProvider>
  );
}
