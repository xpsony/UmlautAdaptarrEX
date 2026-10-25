import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

const CSRF_COOKIE = "ua-csrf";

// Reads the csrf cookie shipped with the auth storageState. State-changing
// requests through `page.request` need this header, otherwise Fastify's
// csrf-protection plugin rejects them with 403.
export async function getCsrfToken(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === CSRF_COOKIE);
  if (!cookie) throw new Error(`missing cookie ${CSRF_COOKIE}`);
  return cookie.value;
}

export async function authedRequest(
  request: APIRequestContext,
  context: BrowserContext,
  path: string,
  init?: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    data?: unknown;
  },
): Promise<unknown> {
  const method = init?.method ?? "GET";
  const fetchInit: {
    method: typeof method;
    headers?: { [key: string]: string };
    data?: unknown;
  } = { method };
  if (method !== "GET") {
    fetchInit.headers = { "x-csrf-token": await getCsrfToken(context) };
  }
  if (init?.data !== undefined) fetchInit.data = init.data;
  const res = await request.fetch(path, fetchInit);
  if (!res.ok() && res.status() !== 204) {
    throw new Error(`${method} ${path} -> ${res.status()}: ${await res.text()}`);
  }
  if (res.status() === 204) return undefined;
  return res.json();
}

interface ListedInstance {
  id: string;
}

export async function deleteAllInstances(page: Page): Promise<void> {
  const list = (await authedRequest(
    page.request,
    page.context(),
    "/api/admin/instances",
  )) as ListedInstance[];
  for (const item of list) {
    await authedRequest(page.request, page.context(), `/api/admin/instances/${item.id}`, {
      method: "DELETE",
    });
  }
}

interface ProwlarrConfig {
  configured: boolean;
}

export async function disconnectProwlarr(page: Page): Promise<void> {
  const cfg = (await authedRequest(
    page.request,
    page.context(),
    "/api/admin/instances/prowlarr/config",
  )) as ProwlarrConfig;
  if (cfg.configured) {
    await authedRequest(page.request, page.context(), "/api/admin/instances/prowlarr/config", {
      method: "DELETE",
    });
  }
}

export async function setOperationMode(
  page: Page,
  mode: "proxy" | "legacy" | "both",
): Promise<void> {
  await authedRequest(page.request, page.context(), "/api/admin/settings", {
    method: "PUT",
    data: { operationMode: mode },
  });
}

export interface CreateInstanceInput {
  type: "sonarr" | "radarr" | "lidarr" | "readarr";
  name: string;
  host: string;
  apiKey: string;
  enabled?: boolean;
}

interface CreatedInstance {
  id: string;
}

export async function createInstance(
  page: Page,
  data: CreateInstanceInput,
): Promise<CreatedInstance> {
  return (await authedRequest(page.request, page.context(), "/api/admin/instances", {
    method: "POST",
    data: {
      type: data.type,
      name: data.name,
      host: data.host,
      apiKey: data.apiKey,
      enabled: data.enabled ?? true,
      enableYearMatching: true,
      yearMatchingTolerance: 1,
      searchWithoutAuthor: false,
    },
  })) as CreatedInstance;
}
