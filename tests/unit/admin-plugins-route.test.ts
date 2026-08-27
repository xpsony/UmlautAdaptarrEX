import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op for unit tests */
  },
}));

const { mockPlugin } = vi.hoisted(() => ({
  mockPlugin: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { plugin: mockPlugin },
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    tmdbAvailable: true,
    reloadPlugins: vi.fn(),
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

import { pluginRoutes } from "@/server/routes/admin/plugins";
import { BUILTIN_PLUGINS } from "@/domain/plugins";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  mockPlugin.findMany.mockReset();
  mockPlugin.findUnique.mockReset();
  mockPlugin.upsert.mockReset();
  mockState.tmdbAvailable = true;
  mockState.reloadPlugins.mockReset();

  app = Fastify({ logger: false });
  await pluginRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/admin/plugins", () => {
  it("returns one entry per built-in plugin with the persisted enabled state", async () => {
    mockPlugin.findMany.mockResolvedValueOnce([
      { id: BUILTIN_PLUGINS[0]!.id, enabled: false },
    ]);

    const r = await app.inject({ method: "GET", url: "/api/admin/plugins" });
    expect(r.statusCode).toBe(200);
    const list = r.json() as Array<{ id: string; enabled: boolean }>;
    expect(list).toHaveLength(BUILTIN_PLUGINS.length);
    expect(list.find((p) => p.id === BUILTIN_PLUGINS[0]!.id)?.enabled).toBe(
      false,
    );
  });

  it("falls back to defaultEnabled when no DB row exists", async () => {
    mockPlugin.findMany.mockResolvedValueOnce([]);
    const r = await app.inject({ method: "GET", url: "/api/admin/plugins" });
    const list = r.json() as Array<{ id: string; enabled: boolean }>;
    for (const entry of list) {
      const builtin = BUILTIN_PLUGINS.find((p) => p.id === entry.id);
      expect(entry.enabled).toBe(builtin?.defaultEnabled);
    }
  });
});

describe("PATCH /api/admin/plugins/:id", () => {
  it("returns 404 for an unknown plugin id", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: "/api/admin/plugins/this-plugin-does-not-exist",
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "unknown_plugin" });
  });

  it("returns 400 for an invalid body", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/api/admin/plugins/${BUILTIN_PLUGINS[0]!.id}`,
      payload: { enabled: "yes" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("blocks enabling a non-DE plugin when no TMDB key is available", async () => {
    const nonDe = BUILTIN_PLUGINS.find((p) => p.language !== "de");
    if (!nonDe) {
      // No non-DE plugin in the registry - skip without failing.
      return;
    }
    mockState.tmdbAvailable = false;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/admin/plugins/${nonDe.id}`,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ error: "tmdb_required" });
  });

  it("upserts and signals requiresResync when the toggle changed", async () => {
    const target = BUILTIN_PLUGINS[0]!;
    mockPlugin.findUnique.mockResolvedValueOnce({
      id: target.id,
      enabled: false,
    });
    mockPlugin.upsert.mockResolvedValueOnce({});

    const r = await app.inject({
      method: "PATCH",
      url: `/api/admin/plugins/${target.id}`,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      id: string;
      enabled: boolean;
      requiresResync: boolean;
    };
    expect(body).toEqual({
      id: target.id,
      enabled: true,
      requiresResync: true,
    });
    expect(mockPlugin.upsert).toHaveBeenCalledOnce();
    expect(mockState.reloadPlugins).toHaveBeenCalledOnce();
  });

  it("returns requiresResync=false and skips reloadPlugins when unchanged", async () => {
    const target = BUILTIN_PLUGINS[0]!;
    mockPlugin.findUnique.mockResolvedValueOnce({
      id: target.id,
      enabled: true,
    });
    mockPlugin.upsert.mockResolvedValueOnce({});

    const r = await app.inject({
      method: "PATCH",
      url: `/api/admin/plugins/${target.id}`,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { requiresResync: boolean }).requiresResync).toBe(
      false,
    );
    expect(mockState.reloadPlugins).not.toHaveBeenCalled();
  });
});
