import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**'] },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: { ...js.configs.recommended.rules },
  },
];
