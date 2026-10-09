import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { withMonacoEditor } from './scripts/monaco-plugin';

const nextConfig: NextConfig = {
  // Curated routes are exported. Arbitrary GitHub routes use the static app
  // shell fallback (public/_redirects) and are loaded in the browser.
  output: process.env.NEXT_OUTPUT_EXPORT === 'false' ? undefined : 'export',

  // Trailing slash ensures python http.server serves index.html from directories
  trailingSlash: true,

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
