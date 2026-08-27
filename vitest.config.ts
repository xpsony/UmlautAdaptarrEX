import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "old_code/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/app/**",
        "src/components/**",
        // Bootstrap and edge-runtime glue: covered by Playwright E2E.
        "src/lib/db.ts",
        "src/middleware.ts",
        "src/server/index.ts",
        // Barrel re-export files: no logic of their own; the underlying
        // modules they re-export are tested directly.
        "src/arr/prowlarr/index.ts",
        "src/domain/plugins/index.ts",
        "src/domain/plugins/types.ts",
        "src/domain/xml/index.ts",
        // Next.js runtime-coupled helpers: depend on `next/headers`,
        // `next-intl/server`, etc. - exercised by Playwright via real
        // request lifecycles.
        "src/lib/api-upstream.ts",
        "src/lib/i18n.ts",
        // Pino logger config with transport streams that hook into the WS
        // broadcaster - the wiring is exercised live by the Playwright
        // server boot, not in isolation.
        "src/server/logging/logger.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
});
