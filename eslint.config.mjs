import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Disable ESLint formatting rules — Prettier handles formatting separately
  prettierConfig,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'packages/cli/dist/**',
    'next-env.d.ts',
    // Ignore downloaded curated corpus and other generated static payloads
    'repos/**',
    // Ignore downloaded repository files
    'public/repos/**',
    'public/monaco-editor/**',
    'out/repos/**',
  ]),
]);

export default eslintConfig;
