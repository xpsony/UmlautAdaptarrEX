import next from "eslint-config-next";
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...next,
  {
    settings: { react: { version: "19" } },
  },
  {
    ignores: [
      ".next/**",
      "dist/**",
      "node_modules/**",
      "old_code/**",
      "data/**",
      "src/generated/**",
    ],
  },
  {
    // Typed linting: enable the project service so type-aware rules
    // (no-floating-promises et al.) can read tsconfig.json automatically.
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Catch dead imports/vars; allow `_`-prefixed names as intentional.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // verbatimModuleSyntax requires explicit `import type` for type-only
      // imports — let lint catch the cases tsc doesn't auto-fix.
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // `any` defeats type-checking; warn and let reviewers decide.
      "@typescript-eslint/no-explicit-any": "warn",
      // Replace the base rule with the TS-aware variant so it understands
      // overloads and type-only declarations.
      "no-unused-vars": "off",

      // Type-aware async-correctness rules. These need the project service
      // (above) and catch the bugs typecheck misses: forgotten awaits, async
      // handlers passed to APIs that ignore the returned promise, etc.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      // `require-await` is too noisy in this codebase: Fastify plugins,
      // provider interface methods, and net.Socket handlers must be `async`
      // to satisfy their declared signatures even when they don't await.
    },
  },
  {
    // Tests routinely chain expect/await patterns where floating-promises
    // produces false positives. Keep the type-aware safety net off here.
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      // Keep the framework-free domain layer explicit and local. Cross-app
      // aliases make it too easy to pull UI/server concerns into core logic.
      "no-restricted-imports": [
        "error",
        {
          paths: ["@prisma/client", "fastify", "next", "react", "react-dom"],
          patterns: [
            {
              group: ["@/*"],
              message:
                "Domain modules should import other domain files relatively and must not reach into app/server/lib layers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/app/**", "src/domain/**"],
    rules: {
      // Outside Next route files and the deliberately local domain layer, use
      // the existing @/* alias instead of climbing directories.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "../../*", "../../../*"],
              message: "Use the @/* alias for cross-directory imports outside src/domain.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/**/*.ts", "src/arr/**/*.ts", "src/providers/**/*.ts"],
    rules: {
      // Server code should log via the pino logger, not console.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);
