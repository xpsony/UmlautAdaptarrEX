import { request } from "undici";
import type { ArrType } from "@/schemas/instance";
import { isMaskedSecret } from "@/lib/secrets";
import { privateHostsAllowedForArrInstance, urlIsPrivate } from "@/server/security/ssrf";
import { describeError } from "@/lib/error-format";

// Minimal structural type so we accept both pino loggers and Fastify's
// `req.log` (FastifyBaseLogger) without having to import either here.
interface CompatLogger {
  info(obj: object | string, msg?: string): void;

  warn(obj: object | string, msg?: string): void;

  error(obj: object | string, msg?: string): void;

  debug(obj: object | string, msg?: string): void;

  child(bindings: Record<string, unknown>): CompatLogger;
}

export interface TestConnectionResult {
  ok: boolean;
  status?: number | undefined;
  version?: string | undefined;
  error?: string | undefined;
  /** Machine-readable code for UI-specific error handling. */
  code?:
    | "masked_api_key"
    | "upstream_unauthorized"
    | "upstream_error"
    | "network"
    | "private_host_blocked"
    | undefined;
}

export async function testConnection(
  type: ArrType,
  host: string,
  apiKey: string,
  userAgent = "UmlautAdaptarr/2.0",
  logger?: CompatLogger,
): Promise<TestConnectionResult> {
  const log = logger?.child({ component: "test-connection", type, host });

  if (isMaskedSecret(apiKey)) {
    log?.warn("test-connection: api key is a Prowlarr mask");
    return {
      ok: false,
      code: "masked_api_key",
      error:
        "The stored API key is only a Prowlarr mask. Enter the real key from Sonarr/Radarr/Lidarr/Readarr.",
    };
  }
  // SSRF guard. Self-hosted is the default deployment shape, so private/LAN
  // targets are allowed unless the operator explicitly opts back into strict
  // mode via UA_BLOCK_PRIVATE_INSTANCE_HOSTS=true (cloud-hosted scenario).
  if (urlIsPrivate(host) && !privateHostsAllowedForArrInstance()) {
    log?.warn({ host }, "test-connection: refused - host resolves to a private/loopback target");
    return {
      ok: false,
      code: "private_host_blocked",
      error:
        "Refusing to connect to a private or loopback address. Strict mode is enabled (UA_BLOCK_PRIVATE_INSTANCE_HOSTS); unset it to allow same-host/LAN *Arr instances.",
    };
  }
  const apiVersion = type === "sonarr" || type === "radarr" ? "v3" : "v1";
  const url = `${host.replace(/\/$/, "")}/api/${apiVersion}/system/status?apikey=${encodeURIComponent(apiKey)}`;
  const started = process.hrtime.bigint();
  try {
    const { statusCode, body } = await request(url, {
      method: "GET",
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      bodyTimeout: 5000,
      headersTimeout: 5000,
    });
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    if (statusCode >= 400) {
      const preview = await body.text().catch(() => "");
      const isAuth = statusCode === 401 || statusCode === 403;
      log?.warn(
        {
          status: statusCode,
          durationMs: Math.round(durationMs),
          bodyPreview: preview.slice(0, 200),
        },
        isAuth
          ? "test-connection: upstream rejected api key"
          : "test-connection: upstream returned HTTP error",
      );
      return {
        ok: false,
        status: statusCode,
        code: isAuth ? "upstream_unauthorized" : "upstream_error",
        error: isAuth ? `HTTP ${statusCode}: ${type} rejected the API key.` : `HTTP ${statusCode}`,
      };
    }
    const json = (await body.json().catch(() => null)) as {
      version?: string;
    } | null;
    log?.info(
      {
        status: statusCode,
        version: json?.version ?? null,
        durationMs: Math.round(durationMs),
      },
      "test-connection ok",
    );
    return { ok: true, status: statusCode, version: json?.version };
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    log?.error(
      { durationMs: Math.round(durationMs), err },
      "test-connection: network/timeout error",
    );
    return {
      ok: false,
      code: "network",
      error: describeError(err),
    };
  }
}
