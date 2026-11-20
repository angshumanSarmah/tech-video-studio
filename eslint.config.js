// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Forbids imports whose specifier matches `regex`. (Gitignore-style `group` patterns can't be
 * used for `#` subpath imports: a leading `#` is a comment in gitignore syntax.)
 * @param {string} message @param {string} regex
 */
const forbidImports = (message, regex) => ({
  'no-restricted-imports': ['error', { patterns: [{ regex, message }] }],
});

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'data/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...vue.configs['flat/recommended'],

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.vue'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },

  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },

  // Node-side code
  {
    files: [
      'apps/studio/src/{core,server,worker}/**',
      'apps/studio/scripts/**',
      'packages/renderer/scripts/**',
      '**/*.config.{ts,js}',
    ],
    languageOptions: { globals: globals.node },
  },
  { files: ['apps/studio/src/web/**'], languageOptions: { globals: globals.browser } },
  { files: ['packages/renderer/src/**'], languageOptions: { globals: globals.browser } },

  // Process boundaries: heavy work lives only in the worker; web never touches Node code.
  {
    files: ['apps/studio/src/server/**'],
    rules: forbidImports(
      'The server must not import worker or web code, or render (@remotion/renderer, @remotion/bundler); enqueue jobs instead.',
      '^#(worker|web)/|/(worker|web)/|^@remotion/(renderer|bundler)',
    ),
  },
  {
    files: ['apps/studio/src/worker/**'],
    rules: forbidImports(
      'The worker must not import server or web code.',
      '^#(server|web)/|/(server|web)/',
    ),
  },
  {
    files: ['apps/studio/src/web/**'],
    rules: forbidImports(
      'Web code may only import #web/*, npm packages and @explainer-studio/shared.',
      '^(#(core|server|worker)/|node:)',
    ),
  },
  {
    files: ['apps/studio/src/core/**'],
    rules: forbidImports(
      'core is shared by server and worker; it must not depend on either. Rendering (@remotion/renderer, @remotion/bundler) runs only in the worker.',
      '^#(server|worker|web)/|/(server|worker|web)/|^@remotion/(renderer|bundler)',
    ),
  },

  prettier,
);
