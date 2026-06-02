import { type CompatLogger, type ProwlarrCallResult, prowlarrRequest } from "./_client";
import { ensureProxyTag, PROWLARR_PROXY_TAG_LABEL, type StepContext } from "./install-proxy";
import type { PatchIndexerResult, ProwlarrIndexerView } from "@/schemas/prowlarr";

export interface ProwlarrIndexerField {
  name?: string;
  value?: unknown;

  [k: string]: unknown;
}

export interface RawProwlarrIndexer {
  id: number;
  name?: string;
  enable?: boolean;
  protocol?: string;
  fields?: ProwlarrIndexerField[];
  tags?: number[];

  [k: string]: unknown;
}

export type PatchAction = "patch" | "unpatch" | "unchanged" | "skip";

export interface PatchPlanItem {
  raw: RawProwlarrIndexer;
  action: PatchAction;
}

// Swap only the URL scheme; host/port/path/query stay intact. A value without
// an http(s) scheme is returned unchanged (the regex simply doesn't match).
export function flipScheme(url: string, target: "http" | "https"): string {
  return url.replace(/^https?:\/\//i, `${target}://`);
}

export function getBaseUrlValue(raw: RawProwlarrIndexer): string | null {
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  const field = fields.find((f) => f.name === "baseUrl");
  return typeof field?.value === "string" ? field.value : null;
}

export function isPatchableUrl(value: string | null): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export function toIndexerView(raw: RawProwlarrIndexer, tagId: number | null): ProwlarrIndexerView {
  const baseUrl = getBaseUrlValue(raw);
  const patchable = isPatchableUrl(baseUrl);
  const isPatched = tagId != null && Array.isArray(raw.tags) && raw.tags.includes(tagId);
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name ? raw.name : `#${raw.id}`,
    enable: raw.enable ?? false,
    protocol: typeof raw.protocol === "string" ? raw.protocol : "unknown",
    currentBaseUrl: baseUrl,
    isPatched,
    patchable,
    ...(patchable ? {} : { reason: "no_base_url" }),
  };
}

// Diff the desired selection against the live tag state. Pure: no network.
export function computePatchPlan(
  indexers: RawProwlarrIndexer[],
  tagId: number,
  selectedIds: Set<number>,
): PatchPlanItem[] {
  return indexers.map((raw) => {
    const patchable = isPatchableUrl(getBaseUrlValue(raw));
    const isPatched = Array.isArray(raw.tags) && raw.tags.includes(tagId);
    const shouldBePatched = selectedIds.has(raw.id);
    let action: PatchAction;
    if (shouldBePatched && !isPatched && !patchable) action = "skip";
    else if (shouldBePatched && !isPatched) action = "patch";
    else if (!shouldBePatched && isPatched) action = "unpatch";
    else action = "unchanged";
    return { raw, action };
  });
}

// Return a NEW raw indexer object with the tag toggled and the baseUrl scheme
// flipped. Used to build the PUT body Prowlarr expects (full object echoed).
export function applyPatchToRaw(
  raw: RawProwlarrIndexer,
  tagId: number,
  patch: boolean,
): RawProwlarrIndexer {
  const tags = new Set(Array.isArray(raw.tags) ? raw.tags : []);
  if (patch) tags.add(tagId);
  else tags.delete(tagId);
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).map((f) =>
    f.name === "baseUrl" && typeof f.value === "string"
      ? { ...f, value: flipScheme(f.value, patch ? "http" : "https") }
      : f,
  );
  return { ...raw, tags: Array.from(tags), fields };
}

export type FetchIndexersResult =
  | { ok: true; indexers: ProwlarrIndexerView[] }
  | { ok: false; status?: number; error: string };

export type ReconcileResult =
  | { ok: true; results: PatchIndexerResult[] }
  | { ok: false; status?: number; error: string };

function makeCtx(host: string, apiKey: string, ua: string, logger?: CompatLogger): StepContext {
  return {
    base: host.replace(/\/$/, ""),
    apiKey,
    ua,
    log: logger?.child({ component: "prowlarr-indexers", host }),
  };
}

// Read-only tag lookup: unlike ensureProxyTag this NEVER creates the tag, so
// the list endpoint stays side-effect free. Returns null when the proxy tag
// does not exist yet (then no indexer is reported as patched).
async function findProxyTagId(ctx: StepContext): Promise<number | null> {
  const res = await prowlarrRequest<{ id: number; label: string }[]>(
    `${ctx.base}/api/v1/tag`,
    ctx.apiKey,
    ctx.ua,
    "GET",
    undefined,
    ctx.log,
    "list-tags",
  );
  if (!res.ok || !Array.isArray(res.data)) return null;
  const found = res.data.find(
    (t) => typeof t?.label === "string" && t.label.toLowerCase() === PROWLARR_PROXY_TAG_LABEL,
  );
  return found && typeof found.id === "number" ? found.id : null;
}

function fetchRawIndexers(ctx: StepContext): Promise<ProwlarrCallResult<RawProwlarrIndexer[]>> {
  return prowlarrRequest<RawProwlarrIndexer[]>(
    `${ctx.base}/api/v1/indexer`,
    ctx.apiKey,
    ctx.ua,
    "GET",
    undefined,
    ctx.log,
    "list-indexers",
  );
}

// List all indexers with their current patch state derived from the proxy tag.
export async function fetchProwlarrIndexers(
  host: string,
  apiKey: string,
  ua: string,
  logger?: CompatLogger,
): Promise<FetchIndexersResult> {
  const ctx = makeCtx(host, apiKey, ua, logger);
  const tagId = await findProxyTagId(ctx);
  const res = await fetchRawIndexers(ctx);
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) {
    return { ok: false, status: res.status, error: "indexers_not_array" };
  }
  const indexers = res.data
    .filter((r) => typeof r?.id === "number")
    .map((r) => toIndexerView(r, tagId));
  return { ok: true, indexers };
}

// Apply the desired selection: ensure the proxy tag exists, then PUT each
// indexer that needs a tag/scheme change. Failures are isolated per indexer
// (action: "failed") so a single bad indexer doesn't abort the batch.
export async function reconcileIndexerPatches(
  host: string,
  apiKey: string,
  ua: string,
  selectedIds: number[],
  logger?: CompatLogger,
): Promise<ReconcileResult> {
  const ctx = makeCtx(host, apiKey, ua, logger);
  const tagRes = await ensureProxyTag(ctx);
  if (!tagRes.ok) return tagRes;
  const tagId = tagRes.data;

  const res = await fetchRawIndexers(ctx);
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) {
    return { ok: false, status: res.status, error: "indexers_not_array" };
  }
  const raws = res.data.filter((r) => typeof r?.id === "number");
  const plan = computePatchPlan(raws, tagId, new Set(selectedIds));

  const results: PatchIndexerResult[] = [];
  for (const item of plan) {
    const name =
      typeof item.raw.name === "string" && item.raw.name ? item.raw.name : `#${item.raw.id}`;
    if (item.action === "unchanged") {
      results.push({ id: item.raw.id, name, action: "unchanged" });
      continue;
    }
    if (item.action === "skip") {
      results.push({ id: item.raw.id, name, action: "skipped" });
      continue;
    }
    const patch = item.action === "patch";
    const body = applyPatchToRaw(item.raw, tagId, patch);
    const putRes = await prowlarrRequest<RawProwlarrIndexer>(
      `${ctx.base}/api/v1/indexer/${item.raw.id}`,
      ctx.apiKey,
      ctx.ua,
      "PUT",
      body,
      ctx.log,
      patch ? "patch-indexer" : "unpatch-indexer",
    );
    if (!putRes.ok) {
      // Surface a stable code, not the raw upstream body preview: the full
      // Prowlarr error is already logged by prowlarrRequest. This keeps any
      // future Prowlarr error-format change from echoing unexpected upstream
      // content into the browser-facing result.
      results.push({ id: item.raw.id, name, action: "failed", error: "put_failed" });
      continue;
    }
    results.push({
      id: item.raw.id,
      name,
      action: patch ? "patched" : "unpatched",
    });
  }
  return { ok: true, results };
}
