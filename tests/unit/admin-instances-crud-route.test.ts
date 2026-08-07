import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op */
  },
}));

const { mockArr } = vi.hoisted(() => ({
  mockArr: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { arrInstance: mockArr },
}));

const { mockTestConnection } = vi.hoisted(() => ({
  mockTestConnection: vi.fn(),
}));

vi.mock("@/arr/test-connection", () => ({
  testConnection: mockTestConnection,
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    settings: { userAgent: "UmlautAdaptarr/2.0" },
    removeItemsForInstance: vi.fn(),
    setInstanceOptions: vi.fn(),
    removeInstanceOptions: vi.fn(),
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

import { instanceCrudRoutes } from "@/server/routes/admin/instances-crud";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  mockArr.findMany.mockReset();
  mockArr.findUnique.mockReset();
  mockArr.create.mockReset();
  mockArr.update.mockReset();
  mockArr.delete.mockReset();
  mockTestConnection.mockReset();
  mockState.removeItemsForInstance.mockReset();
  mockState.setInstanceOptions.mockReset();
  mockState.removeInstanceOptions.mockReset();

  app = Fastify({ logger: false });
  await instanceCrudRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/admin/instances", () => {
  it("returns the rows with providerOrder deserialized from CSV", async () => {
    mockArr.findMany.mockResolvedValueOnce([
      {
        id: "i1",
        type: "sonarr",
        name: "Living",
        host: "http://x",
        apiKey: "k",
        enabled: true,
        providerOrder: "pcjones,tvdb",
        lastSyncAt: null,
        lastSyncError: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);
    const r = await app.inject({ method: "GET", url: "/api/admin/instances" });
    expect(r.statusCode).toBe(200);
    const list = r.json() as Array<{ providerOrder: string[] | null }>;
    expect(list[0]?.providerOrder).toEqual(["pcjones", "tvdb"]);
  });

  it("filters out duplicate and unknown providers in the CSV", async () => {
    mockArr.findMany.mockResolvedValueOnce([
      {
        id: "i1",
        type: "sonarr",
        name: "Living",
        host: "http://x",
        apiKey: "k",
        enabled: true,
        providerOrder: "pcjones,pcjones,bogus,tvdb",
        lastSyncAt: null,
        lastSyncError: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);
    const r = await app.inject({ method: "GET", url: "/api/admin/instances" });
    const list = r.json() as Array<{ providerOrder: string[] | null }>;
    expect(list[0]?.providerOrder).toEqual(["pcjones", "tvdb"]);
  });
});

describe("POST /api/admin/instances", () => {
  const baseValid = {
    type: "sonarr",
    name: "Living",
    host: "http://sonarr.local",
    apiKey: "key-1234567",
    enabled: true,
    providerOrder: ["pcjones"],
  };

  it("creates a new row and serialises it back", async () => {
    mockArr.create.mockResolvedValueOnce({
      id: "i1",
      ...baseValid,
      providerOrder: "pcjones",
      lastSyncAt: null,
      lastSyncError: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances",
      payload: baseValid,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { id: string; providerOrder: string[] | null };
    expect(body.id).toBe("i1");
    expect(body.providerOrder).toEqual(["pcjones"]);
    const args = mockArr.create.mock.calls[0]?.[0] as {
      data: { providerOrder: string };
    };
    expect(args.data.providerOrder).toBe("pcjones");
  });

  it("rejects an invalid payload with 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances",
      payload: { ...baseValid, host: "ftp://nope" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("translates Prisma P2002 into a 409 duplicate error", async () => {
    const err = Object.assign(new Error("unique"), { code: "P2002" });
    mockArr.create.mockRejectedValueOnce(err);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances",
      payload: baseValid,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "duplicate" });
  });
});

describe("PATCH /api/admin/instances/:id", () => {
  it("only sends fields the caller actually supplied", async () => {
    mockArr.update.mockResolvedValueOnce({
      id: "i1",
      type: "sonarr",
      name: "renamed",
      host: "http://x",
      apiKey: "k",
      enabled: true,
      providerOrder: null,
      lastSyncAt: null,
      lastSyncError: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const r = await app.inject({
      method: "PATCH",
      url: "/api/admin/instances/i1",
      payload: { name: "renamed" },
    });
    expect(r.statusCode).toBe(200);
    const args = mockArr.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data).toEqual({ name: "renamed" });
  });

  it("converts an array providerOrder into CSV", async () => {
    mockArr.update.mockResolvedValueOnce({
      id: "i1",
      type: "sonarr",
      name: "x",
      host: "http://x",
      apiKey: "k",
      enabled: true,
      providerOrder: "tvdb,pcjones",
      lastSyncAt: null,
      lastSyncError: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    await app.inject({
      method: "PATCH",
      url: "/api/admin/instances/i1",
      payload: { providerOrder: ["tvdb", "pcjones"] },
    });
    const args = mockArr.update.mock.calls[0]?.[0] as {
      data: { providerOrder: string };
    };
    expect(args.data.providerOrder).toBe("tvdb,pcjones");
  });

  it("converts a null providerOrder to a stored null", async () => {
    mockArr.update.mockResolvedValueOnce({
      id: "i1",
      type: "lidarr",
      name: "x",
      host: "http://x",
      apiKey: "k",
      enabled: true,
      providerOrder: null,
      lastSyncAt: null,
      lastSyncError: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    await app.inject({
      method: "PATCH",
      url: "/api/admin/instances/i1",
      payload: { providerOrder: null },
    });
    const args = mockArr.update.mock.calls[0]?.[0] as {
      data: { providerOrder: string | null };
    };
    expect(args.data.providerOrder).toBeNull();
  });
});

describe("DELETE /api/admin/instances/:id", () => {
  it("deletes the row and clears related cached items", async () => {
    mockArr.delete.mockResolvedValueOnce({});
    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/instances/i1",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(mockArr.delete).toHaveBeenCalledWith({ where: { id: "i1" } });
    expect(mockState.removeItemsForInstance).toHaveBeenCalledWith("i1");
  });
});

describe("PATCH /api/admin/instances/:id — Prisma error mapping", () => {
  it("returns 404 when the instance does not exist (P2025)", async () => {
    mockArr.update.mockRejectedValueOnce({ code: "P2025" });
    const r = await app.inject({
      method: "PATCH",
      url: "/api/admin/instances/does-not-exist",
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: "not_found" });
  });

  it("returns 409 when renaming onto an existing type+name (P2002)", async () => {
    mockArr.update.mockRejectedValueOnce({ code: "P2002" });
    const r = await app.inject({
      method: "PATCH",
      url: "/api/admin/instances/i1",
      payload: { name: "Duplicate" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "duplicate" });
  });
});

describe("DELETE /api/admin/instances/:id — Prisma error mapping", () => {
  it("returns 404 when the instance does not exist (P2025)", async () => {
    mockArr.delete.mockRejectedValueOnce({ code: "P2025" });
    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/instances/does-not-exist",
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: "not_found" });
    // State cleanup must NOT run for a failed delete.
    expect(mockState.removeItemsForInstance).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/instances/test", () => {
  it("delegates to testConnection with the configured user agent", async () => {
    mockTestConnection.mockResolvedValueOnce({ ok: true, version: "1.2.3" });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/test",
      payload: { type: "sonarr", host: "http://x", apiKey: "k" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, version: "1.2.3" });
    expect(mockTestConnection).toHaveBeenCalledWith(
      "sonarr",
      "http://x",
      "k",
      "UmlautAdaptarr/2.0",
      expect.anything(),
    );
  });

  it("rejects an invalid test payload", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/test",
      payload: { type: "sonarr", host: "not-a-url", apiKey: "k" },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("POST /api/admin/instances/:id/test", () => {
  const stored = {
    id: "i1",
    type: "sonarr",
    name: "Living",
    host: "http://sonarr.local",
    apiKey: "real-key",
    enabled: true,
    providerOrder: "pcjones",
    enableYearMatching: true,
    yearMatchingTolerance: 1,
    lastSyncAt: null,
    lastSyncError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  it("loads the instance server-side and delegates to testConnection", async () => {
    mockArr.findUnique.mockResolvedValueOnce(stored);
    mockTestConnection.mockResolvedValueOnce({ ok: true, version: "4.5.6" });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/i1/test",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, version: "4.5.6" });
    expect(mockArr.findUnique).toHaveBeenCalledWith({ where: { id: "i1" } });
    expect(mockTestConnection).toHaveBeenCalledWith(
      "sonarr",
      "http://sonarr.local",
      "real-key",
      "UmlautAdaptarr/2.0",
      expect.anything(),
    );
  });

  it("returns 404 when the instance does not exist", async () => {
    mockArr.findUnique.mockResolvedValueOnce(null);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/does-not-exist/test",
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: "not_found" });
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  it("passes through a failed testConnection result verbatim", async () => {
    mockArr.findUnique.mockResolvedValueOnce(stored);
    mockTestConnection.mockResolvedValueOnce({
      ok: false,
      code: "upstream_unauthorized",
      error: "HTTP 401: sonarr rejected the API key.",
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/i1/test",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      ok: false,
      code: "upstream_unauthorized",
      error: "HTTP 401: sonarr rejected the API key.",
    });
  });
});
