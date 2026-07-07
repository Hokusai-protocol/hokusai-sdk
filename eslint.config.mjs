import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const coreRestrictedImports = [
  '@hokusai/adapter-*',
  '../../adapter-*',
  '../adapter-*',
  '../../../examples/*',
  '../../examples/*',
  '../examples/*',
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '**/plugin/dist/**',
      '**/dist-bundle/**',
      '.typecheck/**',
      'coverage/**',
      'node_modules/**',
      'features/**',
      '**/*.d.ts',
      '**/*.d.ts.map',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: coreRestrictedImports,
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
);
