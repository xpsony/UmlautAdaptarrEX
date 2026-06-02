import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/db";
import { isProwlarrConfigured, loadSetting } from "@/lib/setting-helpers";
import type { z } from "zod";
import {
  InstallProxySchema,
  PatchIndexersSchema,
  ProwlarrCredsSchema,
  ProwlarrImportSchema,
} from "@/schemas/prowlarr";
import {
  fetchProwlarrApplications,
  fetchProwlarrIndexers,
  findExistingUmlautProxy,
  installUmlautProxy,
  PROWLARR_PROXY_NAME,
  PROWLARR_PROXY_TAG_LABEL,
  reconcileIndexerPatches,
} from "@/arr/prowlarr";
import { requireAuth } from "@/server/auth/middleware";
import { getAppState } from "@/server/state";
import {
  loadStoredProwlarrCreds,
  persistProwlarrCreds,
  replyProwlarrUpstreamError,
} from "@/server/prowlarr-helpers";
import { isVaultToken, resolveVaultToken, storeApiKey } from "@/server/prowlarr-key-vault";
import { parseOrReply } from "./_helpers";
import { arrayToCsv } from "./instances-crud";
import { describeError } from "@/lib/error-format";

type ImportSelection = z.infer<typeof ProwlarrImportSchema>["selections"][number];
type ImportError = { name: string; type: string; message: string };

async function getProwlarrConfig(): Promise<{
  host: string | null;
  configured: boolean;
}> {
  const setting = await loadSetting();
  return {
    host: setting?.prowlarrHost ?? null,
    configured: isProwlarrConfigured(setting),
  };
}

async function postProwlarrTest(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  // Accept either an explicit { host, apiKey } body (used while the operator
  // is typing new credentials) or `{ useStored: true }` to test the
  // currently-persisted connection without re-entering the key. Mirrors the
  // preview route below so the stored-state Test button works without
  // shipping the key back to the browser.
  const body = (req.body as Record<string, unknown> | undefined) ?? {};
  const creds = await resolveProwlarrCreds(body, reply);
  if (!creds) return;
  const ua = getAppState().settings.userAgent;
  const result = await fetchProwlarrApplications(creds.host, creds.apiKey, ua, req.log);
  if (!result.ok) {
    return { ok: false, status: result.status ?? 0, error: result.error };
  }
  return {
    ok: true,
    appsCount: result.apps.length,
    skippedCount: result.skipped.length,
  };
}

// Always verify before persisting, broken creds would surface later as a
// confusing 401 during import.
async function putProwlarrConfig(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const data = parseOrReply(req.body, ProwlarrCredsSchema, reply);
  if (!data) return;
  const ua = getAppState().settings.userAgent;
  const result = await fetchProwlarrApplications(data.host, data.apiKey, ua, req.log);
  if (!result.ok) {
    return replyProwlarrUpstreamError(reply, result, "fetch_failed");
  }
  await persistProwlarrCreds(data.host, data.apiKey, getAppState().settings.appApiKey || "");
  return {
    ok: true,
    host: data.host,
    configured: true,
    appsCount: result.apps.length,
    skippedCount: result.skipped.length,
  };
}

async function deleteProwlarrConfig(): Promise<{ ok: true }> {
  await prisma.setting.update({
    where: { id: 1 },
    data: { prowlarrHost: null, prowlarrApiKey: null },
  });
  return { ok: true };
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
  const body = (req.body as Record<string, unknown> | undefined) ?? {};
  const creds = await resolveProwlarrCreds(body, reply);
  if (!creds) return;
  const ua = getAppState().settings.userAgent;
  const result = await fetchProwlarrApplications(creds.host, creds.apiKey, ua, req.log);
  if (!result.ok) {
    return replyProwlarrUpstreamError(reply, result, "fetch_failed");
  }
  await persistProwlarrCreds(creds.host, creds.apiKey, getAppState().settings.appApiKey || "");
  // Replace each downstream-app's real API key with an opaque vault token
  // before the response leaves the server, identical to the setup-wizard
  // preview path. The follow-up import resolves the token back without
  // ever shipping the cleartext key to the browser.
  const safeApps = result.apps.map((a) => (a.apiKey ? { ...a, apiKey: storeApiKey(a.apiKey) } : a));
  return { apps: safeApps, skipped: result.skipped };
}

// Upsert one selection. Returns "created" | "updated" so the caller can
// tally totals. The provider order is CSV-encoded here because letting the
// frontend's default land in the DB as the literal string "null" makes
// sync fail with "No title provider could be built".
//
// If the incoming apiKey is a vault token (the preview endpoint replaces
// real keys with opaque tokens), resolve it back. Stale tokens throw and
// the caller logs the per-item failure.
async function upsertImportSelection(sel: ImportSelection): Promise<"created" | "updated"> {
  let resolvedKey = sel.apiKey;
  if (isVaultToken(resolvedKey)) {
    const real = resolveVaultToken(resolvedKey);
    if (!real) {
      throw new Error("stale_preview_token");
    }
    resolvedKey = real;
  }
  const existing = await prisma.arrInstance.findUnique({
    where: { type_name: { type: sel.type, name: sel.name } },
    select: { id: true },
  });
  await prisma.arrInstance.upsert({
    where: { type_name: { type: sel.type, name: sel.name } },
    create: {
      type: sel.type,
      name: sel.name,
      host: sel.host,
      apiKey: resolvedKey,
      enabled: sel.enabled,
      providerOrder: arrayToCsv(sel.providerOrder),
    },
    update: { host: sel.host, apiKey: resolvedKey },
  });
  return existing ? "updated" : "created";
}

async function postProwlarrImport(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const data = parseOrReply(req.body, ProwlarrImportSchema, reply);
  if (!data) return;
  let created = 0;
  let updated = 0;
  const errors: ImportError[] = [];
  for (const sel of data.selections) {
    try {
      const outcome = await upsertImportSelection(sel);
      if (outcome === "created") created += 1;
      else updated += 1;
    } catch (err) {
      req.log.warn(
        { err, type: sel.type, name: sel.name },
        "prowlarr import: instance upsert failed",
      );
      errors.push({
        name: sel.name,
        type: sel.type,
        message: describeError(err),
      });
    }
  }
  return { created, updated, errors };
}

async function getInstallProxyPreview(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const creds = await loadStoredProwlarrCreds(reply);
  if (!creds) return;
  const state = getAppState();
  const probe = await findExistingUmlautProxy(
    creds.host,
    creds.apiKey,
    state.settings.userAgent,
    req.log,
  );
  if (!probe.ok) {
    return replyProwlarrUpstreamError(reply, probe, "fetch_failed");
  }
  const defaultHost = (req.hostname && req.hostname.split(":")[0]) || "localhost";
  return {
    defaultHost,
    port: state.settings.proxyPort,
    username: state.settings.proxyUsername,
    name: PROWLARR_PROXY_NAME,
    tagLabel: PROWLARR_PROXY_TAG_LABEL,
    hasPassword: !!state.settings.proxyPassword,
    existing: probe.existing,
  };
}

async function postInstallProxy(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const data = parseOrReply(req.body, InstallProxySchema, reply);
  if (!data) return;
  const creds = await loadStoredProwlarrCreds(reply);
  if (!creds) return;
  const state = getAppState();
  if (!state.settings.proxyPassword) {
    return reply.code(409).send({
      error: "no_proxy_password",
      message:
        "Local proxy password is empty. Set a password in settings before installing the proxy in Prowlarr.",
    });
  }
  const result = await installUmlautProxy(
    {
      prowlarrHost: creds.host,
      prowlarrApiKey: creds.apiKey,
      host: data.host,
      port: state.settings.proxyPort,
      username: state.settings.proxyUsername,
      password: state.settings.proxyPassword,
      userAgent: state.settings.userAgent,
    },
    req.log,
  );
  if (!result.ok) {
    return replyProwlarrUpstreamError(reply, result, "install_failed");
  }
  return {
    ok: true,
    action: result.action,
    id: result.id,
    tagId: result.tagId,
  };
}

async function getProwlarrIndexers(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const creds = await loadStoredProwlarrCreds(reply);
  if (!creds) return;
  const ua = getAppState().settings.userAgent;
  const result = await fetchProwlarrIndexers(creds.host, creds.apiKey, ua, req.log);
  if (!result.ok) {
    return replyProwlarrUpstreamError(reply, result, "fetch_failed");
  }
  return { indexers: result.indexers, tagLabel: PROWLARR_PROXY_TAG_LABEL };
}

async function postPatchIndexers(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const data = parseOrReply(req.body, PatchIndexersSchema, reply);
  if (!data) return;
  const creds = await loadStoredProwlarrCreds(reply);
  if (!creds) return;
  const ua = getAppState().settings.userAgent;
  const result = await reconcileIndexerPatches(
    creds.host,
    creds.apiKey,
    ua,
    data.selectedIds,
    req.log,
  );
  if (!result.ok) {
    return replyProwlarrUpstreamError(reply, result, "patch_failed");
  }
  return { results: result.results };
}

export async function prowlarrAdminRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: requireAuth } as const;

  app.get("/api/admin/instances/prowlarr/config", auth, getProwlarrConfig);
  app.post("/api/admin/instances/prowlarr/test", auth, postProwlarrTest);
  app.put("/api/admin/instances/prowlarr/config", auth, putProwlarrConfig);
  app.delete("/api/admin/instances/prowlarr/config", auth, deleteProwlarrConfig);
  app.post("/api/admin/instances/prowlarr/preview", auth, postProwlarrPreview);
  app.post("/api/admin/instances/prowlarr/import", auth, postProwlarrImport);
  app.get("/api/admin/instances/prowlarr/install-proxy/preview", auth, getInstallProxyPreview);
  app.post("/api/admin/instances/prowlarr/install-proxy", auth, postInstallProxy);
  app.get("/api/admin/instances/prowlarr/indexers", auth, getProwlarrIndexers);
  app.post("/api/admin/instances/prowlarr/indexers/patch", auth, postPatchIndexers);
}
