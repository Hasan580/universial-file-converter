'use strict';

const globals = require('globals');

module.exports = [
    { ignores: ['src/renderer/vendor/**', '_legacy/**', 'node_modules/**', 'dist/**', 'build/**'] },
    {
        files: ['src/main/**/*.js', 'src/preload/**/*.js', 'test/**/*.js', 'scripts/**/*.js'],
        languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
        rules: { 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-redeclare': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }] }
    },
    {
        files: ['src/renderer/**/*.js'],
        languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
        rules: { 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-redeclare': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }] }
    }
];
