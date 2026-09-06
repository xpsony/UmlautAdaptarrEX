import { request } from "undici";
import { describeError } from "@/lib/error-format";

// Structural logger type, accepts pino Logger and Fastify's req.log alike.
export interface CompatLogger {
  info(obj: object | string, msg?: string): void;

  warn(obj: object | string, msg?: string): void;

  error(obj: object | string, msg?: string): void;

  debug(obj: object | string, msg?: string): void;

  child(bindings: Record<string, unknown>): CompatLogger;
}

interface ProwlarrCallSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

interface ProwlarrCallFailure {
  ok: false;
  status?: number;
  error: string;
}

export type ProwlarrCallResult<T> = ProwlarrCallSuccess<T> | ProwlarrCallFailure;

export async function prowlarrRequest<T>(
  url: string,
  apiKey: string,
  userAgent: string,
  method: "GET" | "POST" | "PUT",
  body: unknown,
  log?: CompatLogger,
  step?: string,
): Promise<ProwlarrCallResult<T>> {
  const started = process.hrtime.bigint();
  try {
    const headers: Record<string, string> = {
      "User-Agent": userAgent,
      Accept: "application/json",
      "X-Api-Key": apiKey,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const { statusCode, body: respBody } = await request(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      bodyTimeout: 5000,
      headersTimeout: 5000,
    });
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    if (statusCode >= 400) {
      const preview = await respBody.text().catch(() => "");
      log?.warn(
        {
          step,
          method,
          status: statusCode,
          durationMs: Math.round(durationMs),
          bodyPreview: preview.slice(0, 200),
        },
        "prowlarr install: HTTP error",
      );
      return {
        ok: false,
        status: statusCode,
        error: `HTTP ${statusCode}${preview ? `: ${preview.slice(0, 200)}` : ""}`,
      };
    }
    const text = await respBody.text().catch(() => "");
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        log?.warn(
          { step, status: statusCode, bodyPreview: text.slice(0, 200) },
          "prowlarr install: response not JSON",
        );
        return { ok: false, status: statusCode, error: "invalid_response" };
      }
    }
    log?.info(
      {
        step,
        method,
        status: statusCode,
        durationMs: Math.round(durationMs),
      },
      "prowlarr install: ok",
    );
    return { ok: true, status: statusCode, data: parsed as T };
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    log?.error(
      { step, durationMs: Math.round(durationMs), err },
      "prowlarr install: network/timeout error",
    );
    return {
      ok: false,
      error: describeError(err),
    };
  }
}
