import type { Metadata, Viewport } from 'next';
import { Geist_Mono } from 'next/font/google';
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import './globals.css';
import { getSiteUrl, SITE_NAME } from '@/lib/site';

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const siteUrl = getSiteUrl();
const siteName = SITE_NAME;
const brandName = 'GitShaman';
const defaultTitle = 'GitShaman: Semantic Code Intelligence';
const defaultDescription =
  'Explore large codebases with indexed files, symbols, references, dependency views, and curated guides for developers and agents.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: brandName,
  title: {
    default: defaultTitle,
    template: `%s | ${siteName}`,
  },
  description: defaultDescription,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: 'Developer Tools',
  classification: 'Developer Tools, Educational Software',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: brandName,
    title: defaultTitle,
    description: defaultDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: defaultTitle,
    description: defaultDescription,
    creator: '@gitshaman',
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
  verification: {
    // Add your verification codes here when available
    // google: 'your-google-verification-code',
    // yandex: 'your-yandex-verification-code',
    // bing: 'your-bing-verification-code',
  },
  alternates: {
    canonical: siteUrl,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon1.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon0.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon.ico',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: brandName,
  },
};

export const viewport: Viewport = {
  themeColor: '#fff9ef',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const webAppSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: brandName,
    alternateName: siteName,
    description: defaultDescription,
    url: siteUrl,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript. Runs in a modern web browser.',
    featureList: [
      'Replace github.com with gitshaman.com to open repository workspaces',
      'Explore arbitrary GitHub repositories',
      'Search indexed source files, symbols, and references',
      'Browse curated source-code guides linked to implementation evidence',
      'Explore dependency relationships across large repositories',
    ],
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Organization',
      name: brandName,
      url: siteUrl,
    },
  };

  const webSiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: brandName,
    alternateName: siteName,
    url: siteUrl,
    description: defaultDescription,
    potentialAction: {
      '@type': 'ViewAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/{owner}/{repo}`,
      },
      name: 'Open a GitHub repository in GitShaman',
    },
    publisher: {
      '@type': 'Organization',
      name: brandName,
      url: siteUrl,
    },
  };

  const serializeJsonLd = (value: object) => JSON.stringify(value).replace(/</g, '\\u003c');

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistMono.variable} antialiased`}>
        <script
          id="webapp-schema"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(webAppSchema),
          }}
        />
        <script
          id="website-schema"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(webSiteSchema),
          }}
        />
        {children}
      </body>
    </html>
  );
}
