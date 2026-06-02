import { type CompatLogger, type ProwlarrCallResult, prowlarrRequest } from "./_client";

export const PROWLARR_PROXY_NAME = "UmlautAdaptarrEX";
export const PROWLARR_PROXY_TAG_LABEL = "umlautadaptarrex";

interface ProwlarrTag {
  id: number;
  label: string;
}

interface ProwlarrIndexerProxyField {
  name?: string;
  label?: string;
  type?: string;
  value?: unknown;

  [k: string]: unknown;
}

interface ProwlarrIndexerProxy {
  id?: number;
  name?: string;
  implementation?: string;
  implementationName?: string;
  configContract?: string;
  fields?: ProwlarrIndexerProxyField[];
  tags?: number[];
  onHealthIssue?: string;
  includeHealthWarnings?: boolean;
}

export interface InstallProxyParams {
  prowlarrHost: string;
  prowlarrApiKey: string;
  host: string;
  port: number;
  username: string;
  password: string;
  userAgent?: string;
}

export type InstallProxyResult =
  | { ok: true; action: "created" | "updated"; id: number; tagId: number }
  | { ok: false; status?: number; error: string };

export interface StepContext {
  base: string;
  apiKey: string;
  ua: string;
  log: CompatLogger | undefined;
}

export async function ensureProxyTag(ctx: StepContext): Promise<ProwlarrCallResult<number>> {
  const tagsRes = await prowlarrRequest<ProwlarrTag[]>(
    `${ctx.base}/api/v1/tag`,
    ctx.apiKey,
    ctx.ua,
    "GET",
    undefined,
    ctx.log,
    "list-tags",
  );
  if (!tagsRes.ok) return tagsRes;
  if (Array.isArray(tagsRes.data)) {
    const existing = tagsRes.data.find(
      (t) => typeof t?.label === "string" && t.label.toLowerCase() === PROWLARR_PROXY_TAG_LABEL,
    );
    if (existing && typeof existing.id === "number") {
      return { ok: true, status: tagsRes.status, data: existing.id };
    }
  }
  const createRes = await prowlarrRequest<ProwlarrTag>(
    `${ctx.base}/api/v1/tag`,
    ctx.apiKey,
    ctx.ua,
    "POST",
    { label: PROWLARR_PROXY_TAG_LABEL },
    ctx.log,
    "create-tag",
  );
  if (!createRes.ok) return createRes;
  if (
    !createRes.data ||
    typeof createRes.data !== "object" ||
    typeof createRes.data.id !== "number"
  ) {
    return {
      ok: false,
      status: createRes.status,
      error: "tag_create_invalid_response",
    };
  }
  return { ok: true, status: createRes.status, data: createRes.data.id };
}

async function getHttpProxySchema(
  ctx: StepContext,
): Promise<ProwlarrCallResult<ProwlarrIndexerProxy>> {
  const schemaRes = await prowlarrRequest<ProwlarrIndexerProxy[]>(
    `${ctx.base}/api/v1/indexerproxy/schema`,
    ctx.apiKey,
    ctx.ua,
    "GET",
    undefined,
    ctx.log,
    "schema",
  );
  if (!schemaRes.ok) return schemaRes;
  if (!Array.isArray(schemaRes.data)) {
    return { ok: false, status: schemaRes.status, error: "schema_not_array" };
  }
  const httpSchema = schemaRes.data.find(
    (s) => typeof s?.implementation === "string" && s.implementation.toLowerCase() === "http",
  );
  if (!httpSchema) {
    return {
      ok: false,
      status: schemaRes.status,
      error: "http_schema_not_found",
    };
  }
  return { ok: true, status: schemaRes.status, data: httpSchema };
}

async function findProxyByName(
  ctx: StepContext,
  step: string,
): Promise<ProwlarrCallResult<ProwlarrIndexerProxy | null>> {
  const listRes = await prowlarrRequest<ProwlarrIndexerProxy[]>(
    `${ctx.base}/api/v1/indexerproxy`,
    ctx.apiKey,
    ctx.ua,
    "GET",
    undefined,
    ctx.log,
    step,
  );
  if (!listRes.ok) return listRes;
  if (!Array.isArray(listRes.data)) {
    return { ok: true, status: listRes.status, data: null };
  }
  const found = listRes.data.find(
    (p) =>
      typeof p?.name === "string" && p.name.toLowerCase() === PROWLARR_PROXY_NAME.toLowerCase(),
  );
  return { ok: true, status: listRes.status, data: found ?? null };
}

function buildProxyPayload(
  schema: ProwlarrIndexerProxy,
  params: InstallProxyParams,
  tagId: number,
): ProwlarrIndexerProxy {
  const overrides: Record<string, unknown> = {
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password,
  };
  const schemaFields = Array.isArray(schema.fields) ? schema.fields : [];
  const fields: ProwlarrIndexerProxyField[] = schemaFields.map((f) => {
    const name = typeof f.name === "string" ? f.name : "";
    if (name in overrides) return { ...f, value: overrides[name] };
    return { ...f };
  });
  return {
    name: PROWLARR_PROXY_NAME,
    implementation: schema.implementation ?? "Http",
    implementationName: schema.implementationName ?? "Http",
    configContract: schema.configContract ?? "HttpProxySettings",
    fields,
    tags: [tagId],
    onHealthIssue: schema.onHealthIssue ?? "None",
    includeHealthWarnings:
      typeof schema.includeHealthWarnings === "boolean" ? schema.includeHealthWarnings : false,
  };
}

// Orchestrates the full install: ensure tag, fetch Http schema, find existing
// proxy entry, then POST or PUT the proxy. Idempotent, running twice with the
// same name overwrites the existing entry (action: "updated").
export async function installUmlautProxy(
  params: InstallProxyParams,
  logger?: CompatLogger,
): Promise<InstallProxyResult> {
  const log = logger?.child({
    component: "prowlarr-install",
    host: params.prowlarrHost,
  });
  const ctx: StepContext = {
    base: params.prowlarrHost.replace(/\/$/, ""),
    apiKey: params.prowlarrApiKey,
    ua: params.userAgent ?? "UmlautAdaptarr/2.0",
    log,
  };

  const tagRes = await ensureProxyTag(ctx);
  if (!tagRes.ok) return tagRes;
  const tagId = tagRes.data;

  const schemaRes = await getHttpProxySchema(ctx);
  if (!schemaRes.ok) return schemaRes;

  const existingRes = await findProxyByName(ctx, "list-proxies");
  if (!existingRes.ok) return existingRes;
  const existingProxy = existingRes.data;

  const payload = buildProxyPayload(schemaRes.data, params, tagId);

  if (existingProxy && typeof existingProxy.id === "number") {
    const id = existingProxy.id;
    const putRes = await prowlarrRequest<ProwlarrIndexerProxy>(
      `${ctx.base}/api/v1/indexerproxy/${id}`,
      ctx.apiKey,
      ctx.ua,
      "PUT",
      { ...payload, id },
      log,
      "update-proxy",
    );
    if (!putRes.ok) return putRes;
    const newId = typeof putRes.data?.id === "number" ? putRes.data.id : id;
    return { ok: true, action: "updated", id: newId, tagId };
  }
  const postRes = await prowlarrRequest<ProwlarrIndexerProxy>(
    `${ctx.base}/api/v1/indexerproxy`,
    ctx.apiKey,
    ctx.ua,
    "POST",
    payload,
    log,
    "create-proxy",
  );
  if (!postRes.ok) return postRes;
  if (!postRes.data || typeof postRes.data.id !== "number") {
    return {
      ok: false,
      status: postRes.status,
      error: "proxy_create_invalid_response",
    };
  }
  return { ok: true, action: "created", id: postRes.data.id, tagId };
}

// Lightweight check used by the UI preview endpoint to detect whether an
// "UmlautAdaptarrEX"-named entry already exists in Prowlarr (so the dialog can
// warn about overwriting). Re-uses the same auth/timeout shape as the install.
export async function findExistingUmlautProxy(
  prowlarrHost: string,
  prowlarrApiKey: string,
  userAgent = "UmlautAdaptarr/2.0",
  logger?: CompatLogger,
): Promise<
  { ok: true; existing: { id: number } | null } | { ok: false; status?: number; error: string }
> {
  const log = logger?.child({
    component: "prowlarr-install-preview",
    host: prowlarrHost,
  });
  const ctx: StepContext = {
    base: prowlarrHost.replace(/\/$/, ""),
    apiKey: prowlarrApiKey,
    ua: userAgent,
    log,
  };
  const res = await findProxyByName(ctx, "list-proxies-preview");
  if (!res.ok) return res;
  const found = res.data;
  return {
    ok: true,
    existing: found && typeof found.id === "number" ? { id: found.id } : null,
  };
}
