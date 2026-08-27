import { request } from "undici";
import type { Logger } from "pino";
import type { SearchItemDerived } from "@/domain/variations/index";

// How many parent→child fetches to run in parallel inside fetchNested.
// Small enough to stay friendly to a single Lidarr/Readarr instance; large
// enough to noticeably shorten a 200-artist sync.
const NESTED_CONCURRENCY = 8;

export interface ArrClientOptions {
  instanceId: string;
  instanceName: string;
  host: string;
  apiKey: string;
  userAgent: string;
  timeoutMs?: number;
  logger?: Logger;
}

export abstract class ArrClient {
  protected readonly host: string;
  protected readonly log: Logger | null;

  constructor(protected readonly opts: ArrClientOptions) {
    this.host = opts.host.replace(/\/$/, "");
    this.log =
      opts.logger?.child({
        component: "arr-client",
        instance: opts.instanceName,
        instanceId: opts.instanceId,
      }) ?? null;
  }

  abstract fetchAllItems(): Promise<SearchItemDerived[]>;

  /**
   * Generic parent→child fetch loop shared by Lidarr (artist→album) and
   * Readarr (author→book). The subclass supplies *what* to fetch and *how*
   * to map; this helper owns the *how* of iterating. Open/Closed: new arr
   * variants can reuse this without modifying the base.
   *
   * Children are fetched in parallel batches of NESTED_CONCURRENCY to cut
   * wall-time on large libraries (hundreds of artists) without bombarding
   * the *arr instance with one request per parent simultaneously. Parent
   * order is preserved in the output.
   */
  protected async fetchNested<Parent, Child>(args: {
    parentPath: string;
    childPath: string;
    childParams: (parent: Parent) => Record<string, string>;
    map: (parent: Parent, child: Child) => SearchItemDerived;
  }): Promise<SearchItemDerived[]> {
    const parents = await this.getJson<Parent[]>(args.parentPath);
    if (!parents) return [];
    const out: SearchItemDerived[] = [];
    for (let i = 0; i < parents.length; i += NESTED_CONCURRENCY) {
      const batch = parents.slice(i, i + NESTED_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (parent) => {
          const children = await this.getJson<Child[]>(
            args.childPath,
            args.childParams(parent),
          );
          if (!children) return [];
          return children.map((child) => args.map(parent, child));
        }),
      );
      for (const items of batchResults) {
        for (const item of items) out.push(item);
      }
    }
    return out;
  }

  protected async getJson<T = unknown>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T | null> {
    const search = new URLSearchParams({ ...params, apikey: this.opts.apiKey });
    const url = `${this.host}${path}?${search.toString()}`;
    const started = process.hrtime.bigint();
    let statusCode = 0;
    try {
      const res = await request(url, {
        method: "GET",
        headers: {
          "User-Agent": this.opts.userAgent,
          Accept: "application/json",
        },
        bodyTimeout: this.opts.timeoutMs ?? 30_000,
        headersTimeout: this.opts.timeoutMs ?? 30_000,
      });
      statusCode = res.statusCode;
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

      if (statusCode >= 400) {
        // Read a body preview before dumping so we can log *why* the upstream
        // is unhappy - almost always either 401 (bad apikey) or HTML from a
        // reverse proxy in front of the *arr instance.
        const preview = await res.body.text().catch(() => "");
        const isAuth = statusCode === 401 || statusCode === 403;
        this.log?.warn(
          {
            path,
            status: statusCode,
            durationMs: Math.round(durationMs),
            host: this.host,
            bodyPreview: preview.slice(0, 200),
            hint: isAuth
              ? "Upstream rejected the API key - verify the key configured for this instance."
              : undefined,
          },
          "arr request returned HTTP error",
        );
        return null;
      }

      const text = await res.body.text();
      try {
        const json = JSON.parse(text) as T;
        this.log?.debug(
          {
            path,
            status: statusCode,
            durationMs: Math.round(durationMs),
            bytes: text.length,
          },
          "arr request ok",
        );
        return json;
      } catch (parseErr) {
        this.log?.warn(
          {
            path,
            status: statusCode,
            durationMs: Math.round(durationMs),
            bytes: text.length,
            bodyPreview: text.slice(0, 200),
            err: parseErr,
          },
          "arr response is not valid JSON",
        );
        return null;
      }
    } catch (err) {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      this.log?.error(
        {
          path,
          host: this.host,
          durationMs: Math.round(durationMs),
          err,
        },
        "arr request failed (network/timeout)",
      );
      return null;
    }
  }
}
