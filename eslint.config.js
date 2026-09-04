const eslint = require('@eslint/js');
const eslintConfigGoogle = require('eslint-config-google');
const babelEslintParser = require('@babel/eslint-parser');
const globals = require('globals');
const jsdoc = require('eslint-plugin-jsdoc');

module.exports = [
  eslint.configs.recommended,
  eslintConfigGoogle,
  jsdoc.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: babelEslintParser,
      parserOptions: {
        requireConfigFile: false,
      },
      globals: {
        ...globals.node,
        ...globals.mocha,
        _: 'readonly',
      },
    },
    plugins: {
      jsdoc: jsdoc,
    },
    rules: {
      'arrow-parens': ['error', 'as-needed'],
      'max-len': ['error', {
        code: 120,
        ignoreComments: true,
      }],
      // Existing recipe/service code predates google 0.14 indent/comma-dangle.
      // Do not autofix those files; this PR is packaging hygiene only.
      'indent': 'off',
      'comma-dangle': 'off',
      // Disable the deprecated 'require-jsdoc' rule
      'require-jsdoc': 'off',
      // Use the jsdoc/require-jsdoc rule instead
      'jsdoc/require-jsdoc': ['error', {
        require: {
          FunctionDeclaration: true,
          MethodDefinition: false,
          ClassDeclaration: false,
          ArrowFunctionExpression: false,
          FunctionExpression: false,
        },
      }],
      // Disable the deprecated 'valid-jsdoc' rule from google's config
      'valid-jsdoc': 'off',
      // Configure jsdoc rules to mimic 'valid-jsdoc'
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/tag-lines': 'off',
      'jsdoc/check-tag-names': ['error', {
        definedTags: ['returns'],
      }],
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-types': 'error',
      'jsdoc/valid-types': 'error',
    },
  },
  {
    ignores: [
      'temp/',
      'cache/',
      'dist/',
      '_site/',
      'docs/.vitepress/cache/',
      'docs/.vitepress/dist/',
      'coverage/',
      '.nyc_output/',
    ],
  },
];
