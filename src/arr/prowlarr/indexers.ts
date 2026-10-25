import { type CompatLogger, type ProwlarrCallResult, prowlarrRequest } from "./_client";
import {
  ensureProxyTag,
  PROWLARR_PROXY_NAME,
  PROWLARR_PROXY_TAG_LABEL,
  type StepContext,
} from "./install-proxy";
import type {
  PatchIndexerResult,
  PatchIndexersInput,
  ProwlarrIndexerSkipReason,
  ProwlarrIndexerView,
  ProwlarrOtherProxy,
} from "@/schemas/prowlarr";

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
  /** "Newznab" | "Torznab" | "Cardigann" | a native tracker client's name. */
  implementation?: string;
  implementationName?: string;
  fields?: ProwlarrIndexerField[];
  tags?: number[];

  [k: string]: unknown;
}

export interface RawProwlarrTag {
  id: number;
  label?: string;
}

export interface RawProwlarrIndexerProxy {
  id?: number;
  name?: string;
  /** "Http" | "Socks4" | "Socks5" | "FlareSolverr" */
  implementation?: string;
  tags?: number[];

  [k: string]: unknown;
}

export type PatchAction = "patch" | "unpatch" | "unchanged" | "skip";

export interface PatchPlanItem {
  raw: RawProwlarrIndexer;
  action: PatchAction;
  /** Tags of other proxies to take off this indexer (opt-in per indexer). */
  detachTags: number[];
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

// The only two Prowlarr implementations whose wire protocol we can read. The
// rewriting works on Newznab/Torznab response XML and the search fan-out on
// Newznab query parameters; every other implementation talks the tracker's own
// API instead. Routing one of those through the proxy cannot correct anything
// and actively breaks the indexer, because the legacy route dispatches on the
// Newznab `t` parameter and has nothing to answer a request without it.
const CORRECTABLE_IMPLEMENTATIONS = new Set(["newznab", "torznab"]);

/** Prowlarr's implementation name for this indexer, or null if it sent none. */
export function getImplementation(raw: RawProwlarrIndexer): string | null {
  const impl = typeof raw.implementation === "string" ? raw.implementation.trim() : "";
  if (impl) return impl;
  const named = typeof raw.implementationName === "string" ? raw.implementationName.trim() : "";
  return named || null;
}

/**
 * Fails OPEN: an indexer whose implementation Prowlarr did not report counts
 * as correctable. A Prowlarr version that omits the field must not end up with
 * every one of its indexers greyed out.
 */
export function isCorrectableImplementation(raw: RawProwlarrIndexer): boolean {
  const impl = getImplementation(raw);
  if (!impl) return true;
  return CORRECTABLE_IMPLEMENTATIONS.has(impl.toLowerCase());
}

/** Why this indexer cannot be patched, or null when it can. */
export function patchSkipReason(raw: RawProwlarrIndexer): ProwlarrIndexerSkipReason | null {
  if (!isPatchableUrl(getBaseUrlValue(raw))) return "no_base_url";
  if (!isCorrectableImplementation(raw)) return "unsupported_api";
  return null;
}

/**
 * The other proxies Prowlarr would consider for this indexer: every proxy but
 * ours whose tags overlap the indexer's. Prowlarr routes an indexer through
 * only the FIRST matching proxy (FlareSolverr is grouped separately and stacks
 * on top), so a leftover tag from the old UmlautAdaptarr can silently win over
 * ours. FlareSolverr is therefore not a competitor and is left out.
 *
 * There is no fixed tag to look for: the old project only suggested
 * `umlautadaptarr` in its README, and users picked their own. Matching on the
 * proxies' tags catches every spelling.
 */
export function findOtherProxies(
  raw: RawProwlarrIndexer,
  proxies: RawProwlarrIndexerProxy[],
  tagLabels: Map<number, string>,
): ProwlarrOtherProxy[] {
  const indexerTags = new Set(Array.isArray(raw.tags) ? raw.tags : []);
  if (indexerTags.size === 0) return [];
  const out: ProwlarrOtherProxy[] = [];
  for (const proxy of proxies) {
    if (!isCompetingProxy(proxy)) continue;
    const shared = proxyTags(proxy).filter((t) => indexerTags.has(t));
    if (shared.length === 0) continue;
    out.push({
      name: proxyName(proxy) || `#${proxy.id ?? "?"}`,
      tags: shared.map((t) => tagLabels.get(t) ?? `#${t}`),
    });
  }
  return out;
}

function proxyName(proxy: RawProwlarrIndexerProxy): string {
  return typeof proxy.name === "string" ? proxy.name.trim() : "";
}

function proxyTags(proxy: RawProwlarrIndexerProxy): number[] {
  return Array.isArray(proxy.tags) ? proxy.tags : [];
}

function isFlareSolverr(proxy: RawProwlarrIndexerProxy): boolean {
  return (
    typeof proxy.implementation === "string" &&
    proxy.implementation.toLowerCase() === "flaresolverr"
  );
}

function isCompetingProxy(proxy: RawProwlarrIndexerProxy): boolean {
  if (proxyName(proxy).toLowerCase() === PROWLARR_PROXY_NAME.toLowerCase()) return false;
  return !isFlareSolverr(proxy);
}

/**
 * The tag ids to take off an indexer so it no longer competes with our proxy.
 * Never our own tag (that would un-patch it), and never a tag a FlareSolverr
 * proxy also uses (that would silently drop FlareSolverr from the indexer).
 * Only the tag is removed; the other proxy itself stays in Prowlarr.
 */
export function detachTagIds(
  raw: RawProwlarrIndexer,
  proxies: RawProwlarrIndexerProxy[],
  ownTagId: number,
): number[] {
  const indexerTags = new Set(Array.isArray(raw.tags) ? raw.tags : []);
  const keep = new Set<number>([ownTagId]);
  for (const proxy of proxies) {
    if (isFlareSolverr(proxy)) for (const t of proxyTags(proxy)) keep.add(t);
  }
  const out = new Set<number>();
  for (const proxy of proxies) {
    if (!isCompetingProxy(proxy)) continue;
    for (const t of proxyTags(proxy)) {
      if (indexerTags.has(t) && !keep.has(t)) out.add(t);
    }
  }
  return Array.from(out);
}

export function toIndexerView(
  raw: RawProwlarrIndexer,
  tagId: number | null,
  otherProxies: ProwlarrOtherProxy[] = [],
): ProwlarrIndexerView {
  const baseUrl = getBaseUrlValue(raw);
  const reason = patchSkipReason(raw);
  const isPatched = tagId != null && Array.isArray(raw.tags) && raw.tags.includes(tagId);
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name ? raw.name : `#${raw.id}`,
    enable: raw.enable ?? false,
    protocol: typeof raw.protocol === "string" ? raw.protocol : "unknown",
    implementation: getImplementation(raw),
    currentBaseUrl: baseUrl,
    isPatched,
    patchable: reason === null,
    otherProxies,
    ...(reason === null ? {} : { reason }),
  };
}

// Diff the desired selection against the live tag state. Pure: no network.
// `detachIds` only takes effect on an indexer that ends up patched: detaching
// one that stays unpatched would leave it on no umlaut proxy at all.
export function computePatchPlan(
  indexers: RawProwlarrIndexer[],
  tagId: number,
  selectedIds: Set<number>,
  detachIds: Set<number> = new Set(),
  proxies: RawProwlarrIndexerProxy[] = [],
): PatchPlanItem[] {
  return indexers.map((raw) => {
    const patchable = patchSkipReason(raw) === null;
    const isPatched = Array.isArray(raw.tags) && raw.tags.includes(tagId);
    const shouldBePatched = selectedIds.has(raw.id);
    let action: PatchAction;
    if (shouldBePatched && !isPatched && !patchable) action = "skip";
    else if (shouldBePatched && !isPatched) action = "patch";
    else if (!shouldBePatched && isPatched) action = "unpatch";
    else action = "unchanged";
    const endsPatched = action === "patch" || (action === "unchanged" && isPatched);
    const detachTags =
      endsPatched && detachIds.has(raw.id) ? detachTagIds(raw, proxies, tagId) : [];
    return { raw, action, detachTags };
  });
}

// Return a NEW raw indexer object with the tag toggled and the baseUrl scheme
// flipped. Used to build the PUT body Prowlarr expects (full object echoed).
export function applyPatchToRaw(
  raw: RawProwlarrIndexer,
  tagId: number,
  patch: boolean,
  removeTags: number[] = [],
): RawProwlarrIndexer {
  const tags = new Set(Array.isArray(raw.tags) ? raw.tags : []);
  if (patch) tags.add(tagId);
  else tags.delete(tagId);
  for (const t of removeTags) tags.delete(t);
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).map((f) =>
    f.name === "baseUrl" && typeof f.value === "string"
      ? { ...f, value: flipScheme(f.value, patch ? "http" : "https") }
      : f,
  );
  return { ...raw, tags: Array.from(tags), fields };
}

export type FetchIndexersResult =
  { ok: true; indexers: ProwlarrIndexerView[] } | { ok: false; status?: number; error: string };

export type ReconcileResult =
  { ok: true; results: PatchIndexerResult[] } | { ok: false; status?: number; error: string };

function makeCtx(host: string, apiKey: string, ua: string, logger?: CompatLogger): StepContext {
  return {
    base: host.replace(/\/$/, ""),
    apiKey,
    ua,
    log: logger?.child({ component: "prowlarr-indexers", host }),
  };
}

// Read-only tag lookup: unlike ensureProxyTag this NEVER creates the tag, so
// the list endpoint stays side-effect free. `tagId` is null when the proxy tag
// does not exist yet (then no indexer is reported as patched).
async function fetchTags(
  ctx: StepContext,
): Promise<{ tagId: number | null; labels: Map<number, string> }> {
  const res = await prowlarrRequest<RawProwlarrTag[]>(
    `${ctx.base}/api/v1/tag`,
    ctx.apiKey,
    ctx.ua,
    "GET",
    undefined,
    ctx.log,
    "list-tags",
  );
  const labels = new Map<number, string>();
  if (!res.ok || !Array.isArray(res.data)) return { tagId: null, labels };
  let tagId: number | null = null;
  for (const t of res.data) {
    if (typeof t?.id !== "number" || typeof t.label !== "string") continue;
    labels.set(t.id, t.label);
    if (t.label.toLowerCase() === PROWLARR_PROXY_TAG_LABEL) tagId = t.id;
  }
  return { tagId, labels };
}

function fetchIndexerProxies(
  ctx: StepContext,
): Promise<ProwlarrCallResult<RawProwlarrIndexerProxy[]>> {
  return prowlarrRequest<RawProwlarrIndexerProxy[]>(
    `${ctx.base}/api/v1/indexerproxy`,
    ctx.apiKey,
    ctx.ua,
    "GET",
    undefined,
    ctx.log,
    "list-proxies",
  );
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
  const { tagId, labels } = await fetchTags(ctx);
  // Fails soft: the proxy list only feeds the "also routed through" hint, so
  // a failing call must not take the whole indexer list down with it.
  const proxiesRes = await fetchIndexerProxies(ctx);
  const proxies = proxiesRes.ok && Array.isArray(proxiesRes.data) ? proxiesRes.data : [];
  const res = await fetchRawIndexers(ctx);
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) {
    return { ok: false, status: res.status, error: "indexers_not_array" };
  }
  const indexers = res.data
    .filter((r) => typeof r?.id === "number")
    .map((r) => toIndexerView(r, tagId, findOtherProxies(r, proxies, labels)));
  return { ok: true, indexers };
}

// Apply the desired selection: ensure the proxy tag exists, then PUT each
// indexer that needs a tag/scheme change. Failures are isolated per indexer
// (action: "failed") so a single bad indexer doesn't abort the batch.
export async function reconcileIndexerPatches(
  host: string,
  apiKey: string,
  ua: string,
  selection: PatchIndexersInput,
  logger?: CompatLogger,
): Promise<ReconcileResult> {
  const ctx = makeCtx(host, apiKey, ua, logger);
  const tagRes = await ensureProxyTag(ctx);
  if (!tagRes.ok) return tagRes;
  const tagId = tagRes.data;

  // Which tags belong to another proxy is re-read live rather than taken from
  // the browser, so a stale list can never make us remove an unrelated tag.
  let proxies: RawProwlarrIndexerProxy[] = [];
  if (selection.detachIds.length > 0) {
    const proxiesRes = await fetchIndexerProxies(ctx);
    if (!proxiesRes.ok) return proxiesRes;
    proxies = Array.isArray(proxiesRes.data) ? proxiesRes.data : [];
  }

  const res = await fetchRawIndexers(ctx);
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) {
    return { ok: false, status: res.status, error: "indexers_not_array" };
  }
  const raws = res.data.filter((r) => typeof r?.id === "number");
  const plan = computePatchPlan(
    raws,
    tagId,
    new Set(selection.selectedIds),
    new Set(selection.detachIds),
    proxies,
  );

  const results: PatchIndexerResult[] = [];
  for (const item of plan) {
    const name =
      typeof item.raw.name === "string" && item.raw.name ? item.raw.name : `#${item.raw.id}`;
    const detach = item.detachTags.length > 0;
    if (item.action === "unchanged" && !detach) {
      results.push({ id: item.raw.id, name, action: "unchanged" });
      continue;
    }
    if (item.action === "skip") {
      results.push({ id: item.raw.id, name, action: "skipped" });
      continue;
    }
    let body: RawProwlarrIndexer;
    let step: string;
    if (item.action === "unchanged") {
      // Already patched, only the other proxy's tag comes off: no scheme flip.
      const detachTags = new Set(item.detachTags);
      body = { ...item.raw, tags: (item.raw.tags ?? []).filter((t) => !detachTags.has(t)) };
      step = "detach-indexer";
    } else {
      body = applyPatchToRaw(item.raw, tagId, item.action === "patch", item.detachTags);
      step = item.action === "patch" ? "patch-indexer" : "unpatch-indexer";
    }
    // forceSave: without it Prowlarr runs a live connection test before saving
    // an enabled indexer, and rejects the PUT when that test fails. An indexer
    // that is merely at its daily query limit, or briefly unreachable, would
    // then refuse a change that only touches its tags and URL scheme.
    const putRes = await prowlarrRequest<RawProwlarrIndexer>(
      `${ctx.base}/api/v1/indexer/${item.raw.id}?forceSave=true`,
      ctx.apiKey,
      ctx.ua,
      "PUT",
      body,
      ctx.log,
      step,
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
      action:
        item.action === "patch" ? "patched" : item.action === "unpatch" ? "unpatched" : "unchanged",
      ...(detach ? { detached: true } : {}),
    });
  }
  return { ok: true, results };
}

/**
 * Name and base-URL host of every Prowlarr indexer that has a base URL, for
 * labelling hosts in the per-indexer settings. The host is lower-cased with a
 * non-default port kept, the form RequestHistory.domain uses. Fails soft: no
 * names is better than no list.
 */
export async function fetchProwlarrIndexerHosts(
  host: string,
  apiKey: string,
  ua: string,
  logger?: CompatLogger,
): Promise<{ host: string; name: string }[]> {
  const res = await fetchRawIndexers(makeCtx(host, apiKey, ua, logger));
  if (!res.ok || !Array.isArray(res.data)) return [];
  const out: { host: string; name: string }[] = [];
  for (const raw of res.data) {
    const baseUrl = getBaseUrlValue(raw);
    if (!baseUrl || !isPatchableUrl(baseUrl)) continue;
    let urlHost: string;
    try {
      urlHost = new URL(baseUrl).host.toLowerCase();
    } catch {
      continue;
    }
    const name = typeof raw.name === "string" && raw.name ? raw.name : `#${raw.id}`;
    out.push({ host: urlHost, name });
  }
  return out;
}
