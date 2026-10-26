import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'test-results', 'playwright-report', 'node_modules', '.claude', 'functions'] },
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: { allowDefaultProject: ['src/sw.ts'], defaultProject: 'tsconfig.sw.json' },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tests/**/*.ts', '*.config.ts', '*.config.js'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
);
