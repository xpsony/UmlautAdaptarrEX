import { request } from "undici";
import type { ArrType } from "@/schemas/instance";
import type {
  ProwlarrParsedApp,
  ProwlarrPreviewResult,
  ProwlarrSkippedApp,
} from "@/schemas/prowlarr";
import { isMaskedSecret } from "@/lib/secrets";
import { privateHostsAllowedForArrInstance, urlIsPrivate } from "@/server/security/ssrf";
import type { CompatLogger } from "./_client";
import { describeError } from "@/lib/error-format";

interface ProwlarrField {
  name?: string | null;
  value?: unknown;
}

interface ProwlarrApplicationRaw {
  id?: number;
  name?: string;
  implementation?: string;
  syncLevel?: string;
  fields?: ProwlarrField[];
}

const IMPLEMENTATION_TO_TYPE: Record<string, ArrType> = {
  sonarr: "sonarr",
  radarr: "radarr",
  lidarr: "lidarr",
  readarr: "readarr",
};

interface ProwlarrFetchResult extends ProwlarrPreviewResult {
  ok: true;
}

interface ProwlarrFetchError {
  ok: false;
  status?: number;
  error: string;
}

export type ProwlarrFetchResponse = ProwlarrFetchResult | ProwlarrFetchError;

export async function fetchProwlarrApplications(
  host: string,
  apiKey: string,
  userAgent = "UmlautAdaptarr/2.0",
  logger?: CompatLogger,
): Promise<ProwlarrFetchResponse> {
  const log = logger?.child({ component: "prowlarr-fetch", host });
  // SSRF guard. Default-allow for the typical self-hosted shape; cloud-hosted
  // operators opt back into strict mode via UA_BLOCK_PRIVATE_INSTANCE_HOSTS.
  if (urlIsPrivate(host) && !privateHostsAllowedForArrInstance()) {
    log?.warn({ host }, "prowlarr fetch refused, host resolves to a private/loopback target");
    return {
      ok: false,
      error:
        "Refusing to connect to a private or loopback address. Strict mode is enabled (UA_BLOCK_PRIVATE_INSTANCE_HOSTS); unset it to allow same-host/LAN Prowlarr.",
    };
  }
  const url = `${host.replace(/\/$/, "")}/api/v1/applications`;
  const started = process.hrtime.bigint();
  try {
    const { statusCode, body } = await request(url, {
      method: "GET",
      headers: {
        "User-Agent": userAgent,
        Accept: "application/json",
        "X-Api-Key": apiKey,
      },
      bodyTimeout: 5000,
      headersTimeout: 5000,
    });
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    if (statusCode >= 400) {
      const preview = await body.text().catch(() => "");
      log?.warn(
        {
          status: statusCode,
          durationMs: Math.round(durationMs),
          bodyPreview: preview.slice(0, 200),
        },
        "prowlarr applications: HTTP error",
      );
      return { ok: false, status: statusCode, error: `HTTP ${statusCode}` };
    }
    const json = (await body.json().catch(() => null)) as ProwlarrApplicationRaw[] | null;
    if (!Array.isArray(json)) {
      log?.warn(
        { status: statusCode, durationMs: Math.round(durationMs) },
        "prowlarr applications: response is not an array",
      );
      return { ok: false, status: statusCode, error: "invalid_response" };
    }
    const parsed = parseProwlarrApplications(json);
    log?.info(
      {
        status: statusCode,
        durationMs: Math.round(durationMs),
        appsCount: parsed.apps.length,
        skippedCount: parsed.skipped.length,
        skipReasons: parsed.skipped.reduce<Record<string, number>>((acc, s) => {
          acc[s.reason] = (acc[s.reason] ?? 0) + 1;
          return acc;
        }, {}),
      },
      "prowlarr applications fetched",
    );
    return { ok: true, ...parsed };
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    log?.error(
      { durationMs: Math.round(durationMs), err },
      "prowlarr applications: network/timeout error",
    );
    return {
      ok: false,
      error: describeError(err),
    };
  }
}

export function parseProwlarrApplications(raw: ProwlarrApplicationRaw[]): ProwlarrPreviewResult {
  const apps: ProwlarrParsedApp[] = [];
  const skipped: ProwlarrSkippedApp[] = [];

  for (const entry of raw) {
    const prowlarrId = typeof entry.id === "number" ? entry.id : -1;
    const name = (entry.name ?? "").slice(0, 64).trim() || "Unnamed";
    const implementation = (entry.implementation ?? "").trim();
    const type = IMPLEMENTATION_TO_TYPE[implementation.toLowerCase()];

    if (!type) {
      skipped.push({
        prowlarrId,
        name,
        implementation: implementation || "Unknown",
        reason: "unsupported_type",
      });
      continue;
    }

    const fields = Array.isArray(entry.fields) ? entry.fields : [];
    const baseUrl = readField(fields, "baseUrl");
    const apiKey = readField(fields, "apiKey");

    if (!baseUrl) {
      skipped.push({
        prowlarrId,
        name,
        implementation,
        reason: "missing_host",
      });
      continue;
    }
    const normalizedHost = normalizeBaseUrl(baseUrl);
    if (!normalizedHost) {
      skipped.push({
        prowlarrId,
        name,
        implementation,
        reason: "missing_host",
      });
      continue;
    }
    // Prowlarr often masks API keys (e.g. "********"). Don't skip those apps,
    // surface them with an empty key so the user can fill it in during import.
    const usableKey = apiKey.length >= 8 && !isMaskedSecret(apiKey) ? apiKey : "";

    apps.push({
      prowlarrId,
      type,
      name,
      host: normalizedHost,
      apiKey: usableKey,
      syncLevel: entry.syncLevel ?? null,
    });
  }

  return { apps, skipped };
}

function readField(fields: ProwlarrField[], name: string): string {
  const match = fields.find(
    (f) => typeof f.name === "string" && f.name.toLowerCase() === name.toLowerCase(),
  );
  if (!match) return "";
  const value = match.value;
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    new URL(trimmed);
  } catch {
    return null;
  }
  return trimmed.replace(/\/$/, "");
}
