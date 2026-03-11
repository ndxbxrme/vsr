import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.github/**',
      'dist/**',
      'apps/**/dist/**',
      'packages/**/dist/**',
      'coverage/**',
      'packages/db/drizzle/**',
      'playwright-report/**',
      'test-results/**',
      'apps/web/**/*.vue',
      'sources/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
);
