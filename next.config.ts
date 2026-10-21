import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { withMonacoEditor } from './scripts/monaco-plugin';

const nextConfig: NextConfig = {
  // Playwright captures browser diagnostics directly, including intentional
  // failures in retry tests. Avoid duplicating them in the server output.
  logging: process.env.GITSHAMAN_TEST_SERVER === '1' ? { browserToTerminal: false } : undefined,
  // Curated routes are exported. Arbitrary GitHub routes use the static app
  // shell fallback (404.html) and are loaded in the browser.
  output: process.env.NEXT_OUTPUT_EXPORT === 'false' ? undefined : 'export',

  // Trailing slash ensures python http.server serves index.html from directories
  trailingSlash: true,

  // GitShaman routes include repository-like segments and curated slugs such as
  // `/nt5.1-kernel/`. Next treats a dot in the final segment as a file and
  // otherwise emits automatic 308 trailing-slash redirects, which can break
  // static-host fallback routes and image consumers in production.
  skipTrailingSlashRedirect: true,

  // Disable image optimization for static export (or use unoptimized: true)
  images: {
    unoptimized: true,
  },

  webpack: (config) => {
    config.module.rules.push({
      test: /\.md$/,
      resourceQuery: /raw/,
      type: 'asset/source',
    });
    return config;
  },

  // Configure Turbopack (Next.js 16+) to support raw markdown imports
  turbopack: {
    rules: {
      '*.md': {
        loaders: ['raw-loader'],
        as: '*.js',
      },
    },
  },
};

// Automatically bundle Monaco Editor workers during build/dev
export default function config(phase: string): NextConfig {
  return withMonacoEditor({
    ...nextConfig,
    // Let unlisted paths reach the 404 app-shell fallback in development.
    output: phase === PHASE_DEVELOPMENT_SERVER ? undefined : nextConfig.output,
  });
}
