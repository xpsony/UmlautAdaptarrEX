import { type NextRequest, NextResponse } from "next/server";

// Two jobs:
//
//  1. Reverse-proxy the API surface the browser calls (`/api/admin`,
//     `/api/auth`, `/api/health`) to the Fastify gateway at runtime. These
//     used to be `next.config.ts` rewrites, but `output: "standalone"` bakes
//     rewrite destinations into routes-manifest.json at *build* time — so a
//     runtime-configured API port (UMLAUTADAPTARREX_LEGACYAPI_PORT / PORT,
//     surfaced as API_UPSTREAM by start.mjs) was ignored and the proxy kept
//     hitting the build-time default :5005. Proxy runs in the Node.js runtime
//     and reads API_UPSTREAM per request, so the destination tracks the
//     configured port.
//
//  2. Single source of truth for "are we still in the setup wizard?". Runs
//     before every page render and short-circuits the user back to /setup
//     until the wizard finishes. A proxy covers /login, /, /dashboard, and the
//     static /setup page (each a different layout) uniformly without
//     sprinkling redirect calls into every entry point.
//
// The matcher (below) scopes job 2 to page routes and job 1 to the three API
// path groups; static assets and _next chunks bypass both so we don't pay a
// Fastify roundtrip per asset request.

const API_UPSTREAM = process.env.API_UPSTREAM ?? "http://127.0.0.1:5005";

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Job 1: runtime reverse-proxy for the API surface. Preserve the query
  // string; `NextResponse.rewrite` to an absolute upstream URL proxies the
  // request (method, headers, body) just like the old config rewrites did.
  if (pathname.startsWith("/api/")) {
    return NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, API_UPSTREAM));
  }

  let setupComplete = false;
  try {
    const res = await fetch(`${API_UPSTREAM}/api/auth/setup-status`, {
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as { setupComplete?: boolean };
      setupComplete = body.setupComplete === true;
    }
  } catch {
    // Fastify unreachable (e.g. boot race): let the request through so the
    // user sees Next's normal error path instead of a redirect loop.
    return NextResponse.next();
  }

  if (!setupComplete && pathname !== "/setup") {
    const url = req.nextUrl.clone();
    url.pathname = "/setup";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (setupComplete && pathname === "/setup") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Expose the pathname to downstream Server Components so a server-side
  // 401 (e.g. expired admin session) can redirect to /login with a working
  // `next` param.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Page routes (job 2): everything except API, Next internals, and static
    // assets. These respect the setup gate. `arr/` and `brand/` are the only
    // two public/ asset dirs — both must be excluded, otherwise the setup
    // gate redirects e.g. /arr/sonarr.svg to /setup and the *Arr icons render
    // as broken images during the wizard.
    "/((?!api/|_next/|arr/|brand/|favicon\\.ico).*)",
    // API reverse-proxy (job 1): the browser-facing surface that must reach
    // the Fastify gateway at the runtime-configured port.
    "/api/admin/:path*",
    "/api/auth/:path*",
    "/api/health",
  ],
};
