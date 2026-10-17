// Minimal bug-finding lint: real mistakes only, no style rules.
import globals from 'globals';

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'getter-return': 'error',
  'no-func-assign': 'error',
};

export default [
  { ignores: ['node_modules/**', 'assets/**', 'dist/**', '**/*.bundle.js', 'tools/dog_viewer.src.js'] },
  { files: ['src/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } }, rules },
  { files: ['tools/**/*.{js,mjs}'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } }, rules },
  { files: ['*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } }, rules },
];
