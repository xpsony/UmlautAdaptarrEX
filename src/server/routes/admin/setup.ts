import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isProwlarrConfigured, loadSetting, type SettingRow } from "@/lib/setting-helpers";
import { storeApiKey } from "@/server/prowlarr-key-vault";
import { SetupSchema } from "@/schemas/auth";
import { probeTmdbKey } from "@/providers/tmdb";
import { probeTvdbKey } from "@/providers/tvdb";
import { ProwlarrCredsSchema } from "@/schemas/prowlarr";
import { TestConnectionSchema } from "@/schemas/instance";
import {
  fetchProwlarrApplications,
  findExistingUmlautProxy,
  PROWLARR_PROXY_NAME,
  PROWLARR_PROXY_TAG_LABEL,
} from "@/arr/prowlarr";
import { testConnection } from "@/arr/test-connection";
import { privateHostsAllowedForArrInstance, urlIsPrivate } from "@/server/security/ssrf";
import { isLoopbackRequest } from "@/server/routes/legacy/util";
import { getAppState } from "@/server/state";
import { BUILTIN_PLUGINS } from "@/domain/plugins";
import type { PluginListEntry } from "@/schemas/plugins";
import {
  loadStoredProwlarrCreds,
  persistProwlarrCreds,
  replyProwlarrUpstreamError,
} from "@/server/prowlarr-helpers";
import { parseOrReply } from "./_helpers";
import { handleSetupSubmit } from "./_setup-handler";
import { resolveProxyPortEnv } from "@/lib/ports";

const DEFAULT_PROXY_PORT = 5006;
const DEFAULT_PROXY_USERNAME = "UmlautAdaptarr";

// Setup-wizard endpoints are public until `setupComplete=true`. Rate-limit
// per-IP so an unauthenticated visitor can't brute-force the setup race or
// turn the host-probe endpoints into a free SSRF/log-flood tool. The window
// is intentionally tight; legitimate wizard usage hits each route a handful
// of times at most.
const SETUP_RATE_LIMIT = {
  max: 20,
  timeWindow: "5 minutes",
  keyGenerator: (req: FastifyRequest): string => req.ip,
  onExceeded: (req: FastifyRequest): void => {
    req.log.warn(
      {
        ip: req.ip,
        url: req.url,
        method: req.method,
        ua: req.headers["user-agent"] ?? null,
      },
      "setup rate-limit exceeded",
    );
  },
} as const;

// Most setup endpoints share the same gate: load the singleton Setting row
// and refuse the request if setup has already completed. The discriminated
// return distinguishes "gate triggered" (response already sent, caller must
// bail) from "setup still open" (caller continues, possibly with no row at
// all on a brand-new install). The earlier null-vs-row signature mixed both
// states into a single sentinel and let bare-fresh installs slip through as
// silent 200 + empty body responses.
type SetupGateOutcome = { gated: true } | { gated: false; setting: SettingRow };

async function gateSetupOpen(
  reply: FastifyReply,
  options: { code?: number } = {},
): Promise<SetupGateOutcome> {
  const setting = await loadSetting();
  if (setting?.setupComplete) {
    reply.code(options.code ?? 403).send({ error: "setup-already-complete" });
    return { gated: true };
  }
  return { gated: false, setting };
}

async function getSetupStatus(): Promise<{
  setupComplete: boolean;
  prowlarrConfig: { host: string | null; configured: boolean };
  proxyDefaults: { port: number; username: string; portEnvManaged: boolean };
}> {
  const setting = await loadSetting();
  const envProxyPort = resolveProxyPortEnv();
  return {
    setupComplete: setting?.setupComplete ?? false,
    // Wizard pre-fills the persisted Prowlarr host without leaking the API key.
    // The server resolves the key when the UI sends `useStored: true`.
    prowlarrConfig: {
      host: setting?.prowlarrHost ?? null,
      configured: isProwlarrConfigured(setting),
    },
    proxyDefaults: {
      port: envProxyPort ?? setting?.proxyPort ?? DEFAULT_PROXY_PORT,
      username: setting?.proxyUsername ?? DEFAULT_PROXY_USERNAME,
      portEnvManaged: envProxyPort !== null,
    },
  };
}

async function resolveProwlarrCreds(
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<{ host: string; apiKey: string } | null> {
  if (body.useStored === true) {
    return loadStoredProwlarrCreds(reply);
  }
  const data = parseOrReply(body, ProwlarrCredsSchema, reply);
  return data ? { host: data.host, apiKey: data.apiKey } : null;
}

async function postProwlarrPreview(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const gate = await gateSetupOpen(reply);
  if (gate.gated) return;
  const body = (req.body as Record<string, unknown> | undefined) ?? {};
  const creds = await resolveProwlarrCreds(body, reply);
  if (!creds) return;
  const ua = getAppState().settings.userAgent;
  const result = await fetchProwlarrApplications(creds.host, creds.apiKey, ua, req.log);
  if (!result.ok) {
    return replyProwlarrUpstreamError(reply, result, "fetch_failed");
  }
  // Persist creds for later reuse; setupComplete stays false until the
  // setup form is submitted. Re-check the gate here: between
  // gateSetupOpen() and now (long-running upstream HTTP call) another
  // request could have completed setup. Without this guard we would
  // overwrite the freshly-persisted prowlarr creds with whatever this
  // wizard call carries.
  const latest = await loadSetting();
  if (latest?.setupComplete) {
    return reply.code(409).send({ error: "setup-already-complete" });
  }
  await persistProwlarrCreds(creds.host, creds.apiKey, "");
  // Replace each downstream-app's real API key with an opaque token from
  // the in-memory vault. The wire response no longer carries the keys,
  // the setup endpoint resolves the tokens back at submission time. Apps
  // whose key was already empty/masked stay empty so the UI's
  // "needs-manual-entry" path keeps working.
  const safeApps = result.apps.map((a) => (a.apiKey ? { ...a, apiKey: storeApiKey(a.apiKey) } : a));
  return { apps: safeApps, skipped: result.skipped };
}

async function deleteProwlarr(_req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const gate = await gateSetupOpen(reply);
  if (gate.gated) return;
  // No Setting row yet: nothing to clear, the wizard hasn't persisted any
  // Prowlarr creds. Acknowledge with ok so the UI's skip-step path works
  // on a brand-new install.
  if (gate.setting) {
    await prisma.setting.update({
      where: { id: 1 },
      data: { prowlarrHost: null, prowlarrApiKey: null },
    });
  }
  return { ok: true };
}

// Public plugin list for the setup wizard. Returns the built-in plugins'
// metadata plus their current enabled-state, initially the defaults from
// the registry, since `seedPlugins()` runs on every boot.
async function getPlugins(): Promise<PluginListEntry[]> {
  const rows = await prisma.plugin.findMany();
  const enabledMap = new Map(rows.map((r) => [r.id, r.enabled]));
  return BUILTIN_PLUGINS.map((p) => ({
    id: p.id,
    nameKey: p.nameKey,
    descriptionKey: p.descriptionKey,
    language: p.language,
    enabled: enabledMap.get(p.id) ?? p.defaultEnabled,
    defaultEnabled: p.defaultEnabled,
  }));
}

async function postTestTmdbKey(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const gate = await gateSetupOpen(reply, { code: 409 });
  if (gate.gated) return;
  const data = parseOrReply(
    req.body ?? {},
    z.object({ apiKey: z.string().trim().max(256) }),
    reply,
  );
  if (!data) return;
  return probeTmdbKey(data.apiKey);
}

async function postTestTvdbKey(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const gate = await gateSetupOpen(reply, { code: 409 });
  if (gate.gated) return;
  const data = parseOrReply(
    req.body ?? {},
    z.object({
      apiKey: z.string().trim().max(256),
      pin: z.string().trim().max(64).optional(),
    }),
    reply,
  );
  if (!data) return;
  return probeTvdbKey(data.apiKey, data.pin ?? null);
}

async function postProwlarrTest(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const gate = await gateSetupOpen(reply);
  if (gate.gated) return;
  const data = parseOrReply(req.body, ProwlarrCredsSchema, reply);
  if (!data) return;
  const ua = getAppState().settings.userAgent;
  const result = await fetchProwlarrApplications(data.host, data.apiKey, ua, req.log);
  if (!result.ok) {
    return { ok: false, status: result.status ?? 0, error: result.error };
  }
  return {
    ok: true,
    appsCount: result.apps.length,
    skippedCount: result.skipped.length,
  };
}

// Picks a sensible default host for the Prowlarr-side proxy entry. If the
// Prowlarr host is itself called "prowlarr" (typical container name), we
// suggest "umlautadaptarrex" so users don't accidentally point it at
// Prowlarr; otherwise we mirror the Prowlarr host.
function defaultProxyHost(prowlarrHost: string): string {
  try {
    const u = new URL(prowlarrHost);
    return u.hostname.includes("prowlarr") ? "umlautadaptarrex" : u.hostname;
  } catch {
    return "localhost";
  }
}

async function getInstallProxyPreview(_req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const gate = await gateSetupOpen(reply);
  if (gate.gated) return;
  const setting = gate.setting;
  if (!setting?.prowlarrHost || !setting?.prowlarrApiKey) {
    return reply.code(409).send({
      error: "no_stored_creds",
      message: "No Prowlarr credentials stored.",
    });
  }
  const ua = getAppState().settings.userAgent;
  const probe = await findExistingUmlautProxy(setting.prowlarrHost, setting.prowlarrApiKey, ua);
  if (!probe.ok) {
    return replyProwlarrUpstreamError(reply, probe, "fetch_failed");
  }
  return {
    defaultHost: defaultProxyHost(setting.prowlarrHost),
    port: resolveProxyPortEnv() ?? setting.proxyPort,
    username: setting.proxyUsername || DEFAULT_PROXY_USERNAME,
    name: PROWLARR_PROXY_NAME,
    tagLabel: PROWLARR_PROXY_TAG_LABEL,
    existing: probe.existing,
  };
}

async function postInstancesTest(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const gate = await gateSetupOpen(reply);
  if (gate.gated) return;
  const data = parseOrReply(req.body, TestConnectionSchema, reply);
  if (!data) return;
  // Pre-setup SSRF hardening: while there's no admin user yet anyone on
  // the network can hit this endpoint and use it as an internal-host
  // probe. This guard is tied to the same SSRF-strict toggle as the
  // post-setup path (`blockPrivateInstanceHosts`, also honoring the
  // UA_BLOCK_PRIVATE_INSTANCE_HOSTS / UA_ALLOW_PRIVATE_INSTANCE_HOSTS env
  // overrides). It defaults to OFF because self-hosted installs reach
  // Sonarr/Radarr on the same LAN or Docker network — and behind Docker's
  // NAT the operator's own browser arrives as a non-loopback gateway IP,
  // so a loopback-only check would block the canonical setup flow. Cloud /
  // multi-tenant operators that enable strict mode get the pre-auth probe
  // protection back: loopback callers are still allowed, private/LAN
  // targets from anyone else are refused.
  const strict = !privateHostsAllowedForArrInstance();
  const fromLoopback = isLoopbackRequest(req);
  if (strict && !fromLoopback && urlIsPrivate(data.host)) {
    req.log.warn(
      { host: data.host, ip: req.ip },
      "setup: pre-setup test refused — non-loopback caller probing a private host",
    );
    return reply.code(403).send({
      ok: false,
      code: "private_host_blocked",
      error:
        "During setup, private/LAN targets are only allowed from a loopback caller. Run setup from the same host, or finish setup first and toggle the SSRF setting.",
    });
  }
  const ua = getAppState().settings.userAgent;
  return testConnection(data.type, data.host, data.apiKey, ua, req.log);
}

async function postSetup(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const gate = await gateSetupOpen(reply, { code: 409 });
  if (gate.gated) return;
  const data = parseOrReply(req.body, SetupSchema, reply);
  if (!data) return;
  await handleSetupSubmit(data, req, reply);
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  const rateLimited = { config: { rateLimit: SETUP_RATE_LIMIT } } as const;

  app.get("/api/auth/setup-status", getSetupStatus);
  app.post("/api/auth/prowlarr/preview", rateLimited, postProwlarrPreview);
  app.delete("/api/auth/prowlarr", rateLimited, deleteProwlarr);
  app.get("/api/auth/plugins", getPlugins);
  app.post("/api/auth/test-tmdb-key", rateLimited, postTestTmdbKey);
  app.post("/api/auth/test-tvdb-key", rateLimited, postTestTvdbKey);
  app.post("/api/auth/prowlarr/test", rateLimited, postProwlarrTest);
  app.get("/api/auth/prowlarr/install-proxy/preview", rateLimited, getInstallProxyPreview);
  app.post("/api/auth/instances/test", rateLimited, postInstancesTest);
  app.post("/api/auth/setup", rateLimited, postSetup);
}
