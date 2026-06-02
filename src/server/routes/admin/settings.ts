import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { stripUndefined } from "@/lib/utils";
import { SettingsUpdateSchema } from "@/schemas/settings";
import { requireAuth } from "@/server/auth/middleware";
import { getAppState } from "@/server/state";
import { probeTmdbKey } from "@/providers/tmdb";
import { probeTvdbKey } from "@/providers/tvdb";
import { requiredLanguages } from "@/providers";
import type { ProviderId } from "@/schemas/instance";
import { pickMissingCandidates } from "@/server/title-cache/recheck";
import { isMaskedSecret, maskSecret } from "@/lib/secrets";
import { resolveProxyPortEnv } from "@/lib/ports";
import { parseOrReply } from "./_helpers";

const TmdbTestSchema = z.object({
  /** Optional override: when set, this key is tested (form input before
   *  save). If empty/omitted, the server falls back to the currently stored
   *  key so "Test" works right after a save without retyping the key. */
  apiKey: z.string().trim().max(256).optional(),
});

const TvdbTestSchema = z.object({
  apiKey: z.string().trim().max(256).optional(),
  pin: z.string().trim().max(64).optional(),
});

const RECHECK_DEFAULTS: Record<"tv" | "movie", ProviderId[]> = {
  tv: ["pcjones", "tvdb", "tmdb"],
  movie: ["tmdb", "tvdb"],
};

async function getSettings(): Promise<unknown> {
  // `prowlarrApiKey` and `csrfSecret` are server-side only — never echo
  // them back. The dedicated /api/admin/instances/prowlarr/config route
  // exposes a `configured` boolean for the UI's status display.
  const setting = await prisma.setting.findUnique({
    where: { id: 1 },
    select: {
      id: true,
      appApiKey: true,
      proxyPort: true,
      proxyUsername: true,
      proxyPassword: true,
      cacheDurationMinutes: true,
      titleApiHost: true,
      tmdbApiKey: true,
      tvdbApiKey: true,
      tvdbPin: true,
      userAgent: true,
      setupComplete: true,
      prowlarrHost: true,
      prowlarrApiKey: true,
      logRetentionDays: true,
      indexerRateLimitMs: true,
      indexerTimeoutSeconds: true,
      operationMode: true,
      blockPrivateInstanceHosts: true,
      pausedUntil: true,
    },
  });
  if (!setting) return null;
  const { prowlarrApiKey, tmdbApiKey, tvdbApiKey, tvdbPin, ...rest } = setting;
  // Third-party API keys/PINs are stored secrets the operator already
  // entered — masking them stops a leaked admin session (or browser
  // devtools snapshot) from exfiltrating the cleartext value. The settings
  // schema treats `••••••••` as "leave alone" so a round-trip save keeps
  // the stored secret. `appApiKey` and `proxyPassword` stay in cleartext
  // because the operator must actively copy them into Sonarr/Prowlarr.
  const envProxyPort = resolveProxyPortEnv();
  return {
    ...rest,
    proxyPort: envProxyPort ?? rest.proxyPort,
    proxyPortEnvManaged: envProxyPort !== null,
    tmdbApiKey: maskSecret(tmdbApiKey),
    tvdbApiKey: maskSecret(tvdbApiKey),
    tvdbPin: maskSecret(tvdbPin),
    tmdbConfigured: !!tmdbApiKey,
    tvdbConfigured: !!tvdbApiKey,
    tvdbPinConfigured: !!tvdbPin,
    prowlarrConfigured: !!(setting.prowlarrHost && prowlarrApiKey),
  };
}

async function putSettings(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const data = parseOrReply(req.body, SettingsUpdateSchema, reply);
  if (!data) return;
  const envProxyPort = resolveProxyPortEnv();
  // The proxy port is pinned by UMLAUTADAPTARREX_PROXY_PORT, so a DB write would
  // never take effect (the env override wins at boot). Reject the edit with a
  // stable code instead of silently dropping it. Defense-in-depth: the UI also
  // disables the field.
  if (data.proxyPort !== undefined && envProxyPort !== null) {
    return reply.code(409).send({ error: "proxy-port-env-managed" });
  }
  const previousMode = getAppState().settings.operationMode;
  const cleaned = stripUndefined(data);
  const updated = await prisma.setting.update({
    where: { id: 1 },
    data: cleaned,
  });
  await getAppState().reloadSettings();
  // Audit-trail: redaction of sensitive values is handled by the logger's
  // SENSITIVE_KEY_LITERALS list — we log the *names* of changed keys, not
  // the values. operationMode is non-sensitive so it stays inline.
  req.log.info(
    {
      userId: req.session?.userId ?? null,
      ip: req.ip,
      changedFields: Object.keys(cleaned),
    },
    "settings updated",
  );
  // operationMode change: the 5005 gate switches immediately via the live
  // check, but the TCP listener on 5006 is fixed at boot. Log a hint so
  // the operator knows why the port doesn't flip right away.
  if (data.operationMode && data.operationMode !== previousMode) {
    req.log.warn(
      { previousMode, newMode: data.operationMode },
      "operationMode changed — restart required to switch port 5006 listener",
    );
  }
  // Strip server-side secrets before returning to the UI. Third-party keys
  // come back masked, identical to GET — see getSettings() for the
  // rationale and the schema preprocess that round-trips the mask.
  const {
    prowlarrApiKey,
    tmdbApiKey,
    tvdbApiKey,
    tvdbPin,
    csrfSecret: _csrf,
    ...rest
  } = updated as typeof updated & { csrfSecret?: string | null };
  return {
    ...rest,
    proxyPort: envProxyPort ?? rest.proxyPort,
    proxyPortEnvManaged: envProxyPort !== null,
    tmdbApiKey: maskSecret(tmdbApiKey),
    tvdbApiKey: maskSecret(tvdbApiKey),
    tvdbPin: maskSecret(tvdbPin),
    tmdbConfigured: !!tmdbApiKey,
    tvdbConfigured: !!tvdbApiKey,
    tvdbPinConfigured: !!tvdbPin,
    prowlarrConfigured: !!(updated.prowlarrHost && prowlarrApiKey),
  };
}

async function postTestTmdbKey(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const data = parseOrReply(req.body ?? {}, TmdbTestSchema, reply);
  if (!data) return;
  const raw = data.apiKey?.trim() ?? "";
  // Masked echo from the UI means "test the stored key". Treating it as
  // literal would send `••••••••` to TMDB.
  let key = raw && !isMaskedSecret(raw) ? raw : "";
  if (!key) {
    const stored = await prisma.setting.findUnique({
      where: { id: 1 },
      select: { tmdbApiKey: true },
    });
    key = stored?.tmdbApiKey?.trim() ?? "";
  }
  return probeTmdbKey(key);
}

async function postTestTvdbKey(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const data = parseOrReply(req.body ?? {}, TvdbTestSchema, reply);
  if (!data) return;
  const rawKey = data.apiKey?.trim() ?? "";
  const rawPin = data.pin?.trim() ?? "";
  let key = rawKey && !isMaskedSecret(rawKey) ? rawKey : "";
  let pin = rawPin && !isMaskedSecret(rawPin) ? rawPin : "";
  if (!key || !pin) {
    const stored = await prisma.setting.findUnique({
      where: { id: 1 },
      select: { tvdbApiKey: true, tvdbPin: true },
    });
    if (!key) key = stored?.tvdbApiKey?.trim() ?? "";
    if (!pin) pin = stored?.tvdbPin?.trim() ?? "";
  }
  return probeTvdbKey(key, pin || null);
}

async function postRegenerateApiKey(req: FastifyRequest): Promise<{ appApiKey: string }> {
  const apiKey = nanoid(32);
  const updated = await prisma.setting.update({
    where: { id: 1 },
    data: { appApiKey: apiKey },
  });
  await getAppState().reloadSettings();
  req.log.warn({ userId: req.session?.userId ?? null, ip: req.ip }, "app API key regenerated");
  return { appApiKey: updated.appApiKey };
}

async function postRegenerateProxyPassword(
  req: FastifyRequest,
): Promise<{ proxyPassword: string }> {
  const proxyPassword = nanoid(24);
  const updated = await prisma.setting.update({
    where: { id: 1 },
    data: { proxyPassword },
  });
  await getAppState().reloadSettings();
  req.log.warn({ userId: req.session?.userId ?? null, ip: req.ip }, "proxy password regenerated");
  return { proxyPassword: updated.proxyPassword };
}

// `expiresAt = null` marks a positive hit (≥1 translation present); a value
// in the future is a negative hit still inside its TTL.
async function getTitleCacheStats(): Promise<{
  total: number;
  positive: number;
  negative: number;
}> {
  const now = new Date();
  const [total, positive, negative] = await Promise.all([
    prisma.titleApiCache.count(),
    prisma.titleApiCache.count({ where: { expiresAt: null } }),
    prisma.titleApiCache.count({ where: { expiresAt: { gt: now } } }),
  ]);
  return { total, positive, negative };
}

async function deleteTitleCache(): Promise<{ ok: true; deleted: number }> {
  const result = await prisma.titleApiCache.deleteMany({});
  return { ok: true, deleted: result.count };
}

// Group cache-recheck candidates by media type. Used so we can request
// each provider chain only once per type instead of per row.
function groupCandidatesByType(
  candidates: ReadonlyArray<{ id: string; type: string; externalId: string }>,
): Map<"tv" | "movie", string[]> {
  const byType = new Map<"tv" | "movie", string[]>();
  for (const c of candidates) {
    const key = c.type as "tv" | "movie";
    const bucket = byType.get(key) ?? [];
    bucket.push(c.externalId);
    byType.set(key, bucket);
  }
  return byType;
}

// Re-fetch one media-type bucket and tally how many rows recovered vs.
// stayed missing. Returns counters so the caller can sum across buckets.
async function recheckBucket(
  type: "tv" | "movie",
  externalIds: string[],
  wantedLangs: string[],
): Promise<{ recovered: number; stillMissing: number }> {
  const provider = getAppState().providerForOrder(RECHECK_DEFAULTS[type]);
  if (!provider) {
    return { recovered: 0, stillMissing: externalIds.length };
  }
  const result = await provider.fetchBulk(type, externalIds, wantedLangs);
  let recovered = 0;
  let stillMissing = 0;
  for (const eid of externalIds) {
    const p = result.get(eid);
    if (p && Object.keys(p.titlesByLang).length > 0) recovered += 1;
    else stillMissing += 1;
  }
  return { recovered, stillMissing };
}

// Re-check cached title rows where coverage is incomplete:
//   - whole-row negative hits (`expiresAt != null`, no provider returned
//     anything when the row was first written), or
//   - per-language gaps (`TitleTranslation.title = null`) for any language
//     currently active via the language plugins.
// For each candidate we delete the cache row (so DbCachedTitleProvider
// re-fetches naturally) and then ask the provider chain again with the
// current settings. Default order per mediaType: sonarr default for `tv`,
// radarr default for `movie`, so the TVDB and TMDB settings apply
// independently of any specific instance.
async function postRecheckMissing(
  req: FastifyRequest,
): Promise<{ checked: number; recovered: number; stillMissing: number }> {
  const state = getAppState();
  const wantedLangs = requiredLanguages(state.languagePack);
  const rows = await prisma.titleApiCache.findMany({
    include: { translations: { select: { lang: true, title: true } } },
  });

  const candidates = pickMissingCandidates(rows, wantedLangs);
  if (candidates.length === 0) {
    return { checked: 0, recovered: 0, stillMissing: 0 };
  }

  // Wipe the candidate rows in one batch so DbCachedTitleProvider sees a
  // fresh miss and routes through the configured provider chain.
  await prisma.titleApiCache.deleteMany({
    where: { id: { in: candidates.map((c) => c.id) } },
  });

  const byType = groupCandidatesByType(candidates);
  let recovered = 0;
  let stillMissing = 0;
  for (const [type, externalIds] of byType) {
    const counts = await recheckBucket(type, externalIds, wantedLangs);
    recovered += counts.recovered;
    stillMissing += counts.stillMissing;
  }

  req.log.info(
    { checked: candidates.length, recovered, stillMissing, wantedLangs },
    "title cache recheck complete",
  );
  return { checked: candidates.length, recovered, stillMissing };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: requireAuth } as const;

  app.get("/api/admin/settings", auth, getSettings);
  app.put("/api/admin/settings", auth, putSettings);
  app.post("/api/admin/settings/test-tmdb-key", auth, postTestTmdbKey);
  app.post("/api/admin/settings/test-tvdb-key", auth, postTestTvdbKey);
  app.post("/api/admin/settings/regenerate-apikey", auth, postRegenerateApiKey);
  app.post("/api/admin/settings/regenerate-proxy-password", auth, postRegenerateProxyPassword);
  app.get("/api/admin/title-cache", auth, getTitleCacheStats);
  app.delete("/api/admin/title-cache", auth, deleteTitleCache);
  app.post("/api/admin/title-cache/recheck-missing", auth, postRecheckMissing);
}
