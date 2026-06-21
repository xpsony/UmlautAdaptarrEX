import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n.ts");



const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  typedRoutes: true,
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3", "argon2", "@prisma/client"],
  async headers() {
    // Default security headers for HTML responses served by Next.js.
    // Fastify routes set their own headers; this only applies to pages
    // and static assets served by the Next process.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            // Intentionally relaxed CSP. The Next.js App Router injects inline
            // bootstrap scripts/styles and (in dev) uses eval for HMR, so a
            // strict nonce-based policy would break it without a nonce
            // pipeline we don't run here. 'unsafe-inline'/'unsafe-eval' on
            // script/style are the cost of that. The real wins are
            // object-src 'none', base-uri 'self' and frame-ancestors 'none'
            // (clickjacking + base-tag injection). connect-src allows ws:/wss:
            // for the live /ws/logs stream (cross-origin to the Fastify port).
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "connect-src 'self' ws: wss:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
