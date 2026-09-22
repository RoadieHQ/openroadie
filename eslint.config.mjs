// Flat config (ESLint 9). Migrated from the legacy .eslintrc.js — same rules,
// overrides, and ordering. Config objects apply in array order; later objects
// win for overlapping rules on matching files (the flat-config equivalent of
// eslintrc `overrides`). `ignores` inside a config with `files` is the
// equivalent of the old `excludedFiles`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import pluginSecurity from 'eslint-plugin-security';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

const HARD_COLOR_SCALE_CLASS_PATTERN =
  '\\b(?:text|bg|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b';

const HARDCODED_HEX_IN_TAILWIND_PATTERN =
  '\\b(?:text|bg|border|outline|ring|shadow|from|via|to)-\\[#[0-9a-fA-F]+\\]';

const MOTION_CLASS_PATTERN =
  '\\b(?:motion-safe:|motion-reduce:)?(?:transition(?:-[a-zA-Z0-9_\\[\\],().%-]+)?|duration-\\d+|ease-(?:linear|in|out|in-out|\\[[^\\]]+\\])|animate-[a-zA-Z0-9_-]+|fade-(?:in|out)-\\d+|zoom-(?:in|out)-\\d+|slide-(?:in-from|out-to)-\\S+)\\b';

// Raw inline CSS transition/animation *value* strings (e.g. `opacity 0.3s ease`)
// that the class-name pattern above cannot see. These belong in
// motionStyleTransitions / motionAnimations from @roadiehq/ui/motion so timings
// stay centralized. Matches an animatable property immediately followed by a
// duration.
const MOTION_INLINE_VALUE_PATTERN =
  '\\b(?:all|opacity|transform|width|height|stroke(?:-width)?|color|background(?:-color)?|border(?:-color)?|box-shadow|fill|left|right|top|bottom)\\s+[0-9.]+m?s\\b';

// Base type-safety guards that must survive in every override that replaces
// `no-restricted-syntax` (override rule configs replace, they do not merge).
const DOUBLE_CAST_RESTRICTED_SYNTAX = [
  {
    selector: 'TSAsExpression > TSUnknownKeyword',
    message:
      'Avoid `as unknown as X` double-casting. Use generics, type guards, or Zod schemas instead.',
  },
];

// Internal HTTP calls must resolve credentials through internalFetchServiceRef
// (`core.internalFetch`) — the "Request failed" class of bug (sc-34243) came
// from call sites reaching for the global fetch, or hand-rolling credential
// threading and forgetting it somewhere. Flag the three shapes that
// reintroduce it: a direct global-fetch call, a `?? fetch` fallback that
// silently drops the injected fetchApi, and a bare `{ fetch }` handed to a
// client. Genuinely external calls (AWS endpoints, remote schema URLs,
// telemetry sinks) disable inline, naming the external target.
const BACKEND_FETCH_RESTRICTED_SYNTAX = [
  {
    selector: "CallExpression[callee.name='fetch']",
    message:
      'Internal backend calls must go through internalFetchServiceRef (`core.internalFetch`) or an injected InternalFetchApi so credentials are resolved per call. If this call targets an external service, disable this rule inline and name the target.',
  },
  {
    selector: "LogicalExpression > Identifier[name='fetch']",
    message:
      'Falling back to the global fetch (`?? fetch`) silently drops internal credential resolution — require the injected fetchApi instead.',
  },
  {
    selector: "ObjectExpression > Property[shorthand=true][value.name='fetch']",
    message:
      'A bare `{ fetch }` sends no credentials on internal calls — inject internalFetchServiceRef (or its `.asService()`) instead.',
  },
];

const MOTION_RESTRICTED_SYNTAX = [
  {
    selector: `Literal[value=/${MOTION_CLASS_PATTERN}/]`,
    message:
      'Use shared motion classes from @roadiehq/ui/motion or motion-* CSS utilities instead of raw Tailwind motion utilities.',
  },
  {
    selector: `TemplateElement[value.raw=/${MOTION_CLASS_PATTERN}/]`,
    message:
      'Use shared motion classes from @roadiehq/ui/motion or motion-* CSS utilities instead of raw Tailwind motion utilities.',
  },
  {
    selector: `Literal[value=/${MOTION_INLINE_VALUE_PATTERN}/]`,
    message:
      'Use motionStyleTransitions / motionAnimations from @roadiehq/ui/motion instead of a raw inline CSS transition/animation string.',
  },
  {
    selector: `TemplateElement[value.raw=/${MOTION_INLINE_VALUE_PATTERN}/]`,
    message:
      'Use motionStyleTransitions / motionAnimations from @roadiehq/ui/motion instead of a raw inline CSS transition/animation string.',
  },
];

export default tseslint.config(
  // Replaces the old `ignorePatterns`.
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/scripts/**',
      '**/*.d.ts',
    ],
  },

  // Recommended presets (replaces the eslintrc `extends`).
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  pluginSecurity.configs.recommended,

  // Base config: which files get linted (replaces the CLI `--ext .ts,.tsx`),
  // language options (replaces `env` + `parserOptions`), react-hooks plugin
  // (kept to the two classic rules to match the old v4 `recommended`), and the
  // project-wide rule set.
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      // react-hooks: match the pre-v7 `recommended` (classic rules only; do not
      // opt into v7's React Compiler ruleset).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // a11y: downgraded to warn until existing violations are fixed
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/heading-has-content': 'warn',
      'jsx-a11y/no-autofocus': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-var-requires': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'error',
      'no-restricted-syntax': ['error', ...DOUBLE_CAST_RESTRICTED_SYNTAX],
      'no-prototype-builtins': 'error',
      // Fires on every dynamically-constructed fs path and can't tell validated
      // paths from unvalidated ones — all findings to date were false positives
      // carrying "path is validated" disables. Other security rules stay on.
      'security/detect-non-literal-fs-filename': 'off',
    },
  },

  // Tests are relaxed.
  {
    files: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // App + UI source (excluding the motion module itself and tests): forbid
  // framer-motion and raw motion utilities.
  {
    files: ['packages/app/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    ignores: ['packages/ui/src/lib/motion.ts', '**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'framer-motion',
              message: 'Use `motion/react` for JS animations.',
            },
            {
              // Data-loading standard (.claude/rules/data-loading.md): server
              // reads/writes go through TanStack Query, never react-use's async
              // fetch hooks. Live SSE streams are the one exception and disable
              // this inline (see use-execution.ts).
              name: 'react-use',
              importNames: ['useAsync', 'useAsyncFn', 'useAsyncRetry'],
              message:
                'Use `useQuery`/`useMutation` (see .claude/rules/data-loading.md), not react-use async hooks, for server data. `useLocalStorage` etc. are still fine.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...DOUBLE_CAST_RESTRICTED_SYNTAX,
        ...MOTION_RESTRICTED_SYNTAX,
      ],
    },
  },

  // Backend allows require() for lazy-loading optional dependencies.
  {
    files: [
      'packages/backend/**/*.{ts,tsx}',
      'packages/backend-defaults/**/*.{ts,tsx}',
      'plugins/*-backend/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Backend + plugin source (excluding tests): internal HTTP calls go through
  // internalFetchServiceRef, never the bare global fetch — see
  // BACKEND_FETCH_RESTRICTED_SYNTAX above. Tests are excluded so the earlier
  // test relaxation of `no-restricted-syntax` is not clobbered.
  {
    files: [
      'packages/backend/**/*.{ts,tsx}',
      'packages/backend-defaults/**/*.{ts,tsx}',
      'packages/extensions-api/**/*.{ts,tsx}',
      'plugins/**/*.{ts,tsx}',
    ],
    ignores: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...DOUBLE_CAST_RESTRICTED_SYNTAX,
        ...BACKEND_FETCH_RESTRICTED_SYNTAX,
      ],
    },
  },

  // Migrations, seeds, and executable bins intentionally use CommonJS because
  // they are consumed directly by Node/Knex-style runtimes.
  {
    files: ['**/migrations/**/*.js', '**/seeds/**/*.js', '**/bin/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-redeclare': 'off',
    },
  },

  // These public API surfaces intentionally use namespace/empty-interface
  // declaration shapes for compatibility and declaration merging.
  {
    files: [
      'packages/extensions-api/src/services/**/*.{ts,tsx}',
      'packages/types/src/json.ts',
      'plugins/ai-node/src/definitions.ts',
    ],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-namespace': 'off',
    },
  },

  // Forked database utilities lazy-load optional database drivers.
  {
    files: ['plugins/backend-common/src/forked/database/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Base packages must not depend on internal overlay packages.
  {
    files: [
      'packages/backend-defaults/**/*.{ts,tsx}',
      'packages/extensions-api/**/*.{ts,tsx}',
      'packages/config/**/*.{ts,tsx}',
      'packages/config-loader/**/*.{ts,tsx}',
      'plugins/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@roadiehq/internal-*'],
              message:
                'Base packages must not import internal overlay packages.',
            },
          ],
        },
      ],
    },
  },

  // App components: force the @roadiehq/ui primitives over raw HTML elements.
  {
    files: ['packages/app/src/components/**/*.{ts,tsx}'],
    rules: {
      'react/forbid-elements': [
        'error',
        {
          forbid: [
            {
              element: 'button',
              message: 'Use the @roadiehq/ui Button primitive.',
            },
            {
              element: 'input',
              message: 'Use the @roadiehq/ui Input primitive.',
            },
            {
              element: 'select',
              message: 'Use the @roadiehq/ui Select primitive.',
            },
            {
              element: 'textarea',
              message: 'Use the @roadiehq/ui Textarea primitive.',
            },
          ],
        },
      ],
    },
  },

  // Design-token / motion / double-cast restrictions for component source.
  // Split from the forbid-elements config above so it can exclude tests: the
  // test config relaxes `no-restricted-syntax`, and a later config matching test
  // files would otherwise clobber that relaxation.
  {
    files: ['packages/app/src/components/**/*.{ts,tsx}'],
    ignores: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...DOUBLE_CAST_RESTRICTED_SYNTAX,
        ...MOTION_RESTRICTED_SYNTAX,
        {
          selector: `Literal[value=/${HARD_COLOR_SCALE_CLASS_PATTERN}/]`,
          message:
            'Prefer semantic token classes (e.g. text-muted-foreground, bg-success/10) over hard color scale classes.',
        },
        {
          selector: `TemplateElement[value.raw=/${HARD_COLOR_SCALE_CLASS_PATTERN}/]`,
          message:
            'Prefer semantic token classes (e.g. text-muted-foreground, bg-success/10) over hard color scale classes.',
        },
        {
          selector: `Literal[value=/${HARDCODED_HEX_IN_TAILWIND_PATTERN}/]`,
          message:
            'Use semantic color tokens instead of hardcoded hex values in Tailwind classes (e.g. bg-primary instead of bg-[#1f5493]).',
        },
        {
          selector: `TemplateElement[value.raw=/${HARDCODED_HEX_IN_TAILWIND_PATTERN}/]`,
          message:
            'Use semantic color tokens instead of hardcoded hex values in Tailwind classes (e.g. bg-primary instead of bg-[#1f5493]).',
        },
      ],
    },
  },

  // Prettier last: turn off formatting rules that conflict with Prettier.
  eslintConfigPrettier,
);
