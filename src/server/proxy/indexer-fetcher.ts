import { Agent, request } from "undici";
import type { Logger } from "pino";
import type { AppState } from "@/server/state";
import { urlIsPrivate } from "@/server/security/ssrf";
import { outboundUserAgent } from "@/lib/user-agent";
import { HostRateLimiter, parseRetryAfterMs } from "./rate-limiter";

// Manual redirect handling so we can re-check every hop against the SSRF
// guard. Letting undici's `interceptors.redirect` follow blindly would let
// an upstream indexer 301-redirect to e.g. `http://10.0.0.5/...` and pivot
// us into the internal network. Three hops is the same budget as before.
const MAX_REDIRECTS = 3;

interface IndexerFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  cacheHit: boolean;
}

export class IndexerFetcher {
  private readonly limiter: HostRateLimiter;
  private readonly log: Logger | null;
  // Cached undici Agent. Rebuilt only when the configured timeout changes,
  // so admin edits to indexerTimeoutSeconds take effect without a restart
  // but normal traffic reuses the same connection pool.
  private dispatcher: { timeoutMs: number; agent: Agent } | null = null;

  constructor(
    private readonly state: AppState,
    logger?: Logger,
  ) {
    this.log = logger?.child({ component: "indexer-fetcher" }) ?? null;
    // Read the limit live from settings so admin changes apply without restart.
    this.limiter = new HostRateLimiter(() => this.state.settings.indexerRateLimitMs);
  }

  // Returns an Agent whose connect/headers/body timeouts all match the
  // currently configured indexerTimeoutSeconds. undici's default
  // connectTimeout is 10s, so without this dispatcher slow indexers like
  // scenenzbs.com can never finish their TLS handshake.
  private getDispatcher(timeoutMs: number): Agent {
    if (this.dispatcher && this.dispatcher.timeoutMs === timeoutMs) {
      return this.dispatcher.agent;
    }
    void this.dispatcher?.agent.close();
    const agent = new Agent({
      connect: { timeout: timeoutMs },
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });
    this.dispatcher = { timeoutMs, agent };
    return agent;
  }

  async fetch(targetUrl: string, headers: Record<string, string>): Promise<IndexerFetchResult> {
    const cached = this.state.indexerCache.get(targetUrl);
    if (cached) {
      this.log?.debug(
        { targetUrl, status: cached.status, bytes: cached.body.length },
        "indexer cache hit",
      );
      return { ...cached, cacheHit: true };
    }

    const host = new URL(targetUrl).host;
    const waitStart = process.hrtime.bigint();
    await this.limiter.wait(host);
    const waitMs = Number(process.hrtime.bigint() - waitStart) / 1_000_000;

    const reqHeaders: Record<string, string> = { ...headers };
    delete reqHeaders.host;
    delete reqHeaders.Host;
    delete reqHeaders["content-length"];
    delete reqHeaders["accept-encoding"];

    // Either our own token or the calling *Arr's header, per the
    // `forwardArrUserAgent` setting - never the concatenation of both, which
    // is what this used to send and which matched neither client.
    reqHeaders["user-agent"] = outboundUserAgent(
      reqHeaders["user-agent"],
      this.state.settings.userAgent,
      this.state.settings.forwardArrUserAgent,
    );

    const timeoutMs = this.state.settings.indexerTimeoutSeconds * 1000;
    const dispatcher = this.getDispatcher(timeoutMs);
    const fetchStart = process.hrtime.bigint();
    try {
      let currentUrl = targetUrl;
      let statusCode = 0;
      let respHeaders: Record<string, string | string[] | undefined> = {};
      let body!: Awaited<ReturnType<typeof request>>["body"];
      // Manual redirect chain - re-checks `urlIsPrivate` at every hop so an
      // upstream 301 → http://10.0.0.5/admin can't pivot the request into
      // an internal network. Indexer URLs themselves are guarded earlier
      // (legacy/util.ts, http-proxy.ts), but a malicious or compromised
      // indexer could still redirect through the dispatcher.
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (urlIsPrivate(currentUrl)) {
          this.log?.warn(
            { host, currentUrl, hop },
            "indexer redirect refused: target resolves to a private/loopback host",
          );
          throw new Error("Refusing to follow redirect to a private host");
        }
        const res = await request(currentUrl, {
          method: "GET",
          headers: reqHeaders,
          dispatcher,
          bodyTimeout: timeoutMs,
          headersTimeout: timeoutMs,
        });
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          typeof res.headers.location === "string" &&
          hop < MAX_REDIRECTS
        ) {
          // Drain the redirect body so the underlying socket is freed.
          for await (const _ of res.body) {
            void _;
          }
          const next = new URL(res.headers.location, currentUrl).toString();
          this.log?.debug(
            { from: currentUrl, to: next, status: res.statusCode },
            "indexer redirect",
          );
          currentUrl = next;
          continue;
        }
        statusCode = res.statusCode;
        respHeaders = res.headers as Record<string, string | string[] | undefined>;
        body = res.body;
        break;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(chunk as Buffer);
      }
      const buf = Buffer.concat(chunks);
      const contentType = String(respHeaders["content-type"] ?? "application/xml");
      const durationMs = Number(process.hrtime.bigint() - fetchStart) / 1_000_000;

      if (statusCode >= 200 && statusCode < 300) {
        this.state.indexerCache.set(
          targetUrl,
          { status: statusCode, contentType, body: buf },
          { ttl: this.state.settings.cacheDurationMinutes * 60 * 1000 },
        );
        this.log?.debug(
          {
            host,
            status: statusCode,
            durationMs: Math.round(durationMs),
            waitMs: Math.round(waitMs),
            bytes: buf.length,
          },
          "indexer fetch ok",
        );
      } else {
        // 429/503 with Retry-After → respect the indexer's wishes by extending
        // the per-host backoff window. Falls back to the configured baseline
        // spacing if the header is missing or unparseable.
        if (statusCode === 429 || statusCode === 503) {
          const retryAfterMs = parseRetryAfterMs(respHeaders["retry-after"]);
          if (retryAfterMs > 0) {
            this.limiter.backoff(host, Date.now() + retryAfterMs);
            this.log?.warn(
              { host, status: statusCode, retryAfterMs },
              "indexer requested backoff via Retry-After",
            );
          }
        }
        this.log?.warn(
          {
            host,
            targetUrl,
            status: statusCode,
            durationMs: Math.round(durationMs),
            waitMs: Math.round(waitMs),
            bytes: buf.length,
            bodyPreview: buf.slice(0, 200).toString("utf8"),
          },
          "indexer fetch returned HTTP error",
        );
      }

      return { status: statusCode, contentType, body: buf, cacheHit: false };
    } catch (err) {
      const durationMs = Number(process.hrtime.bigint() - fetchStart) / 1_000_000;
      this.log?.error(
        {
          host,
          targetUrl,
          durationMs: Math.round(durationMs),
          waitMs: Math.round(waitMs),
          err,
        },
        "indexer fetch failed (network/timeout)",
      );
      throw err;
    }
  }
}
