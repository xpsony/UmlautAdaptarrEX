import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op */
  },
}));

const { mockSearchItem, mockTitleOverride } = vi.hoisted(() => ({
  mockSearchItem: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  mockTitleOverride: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { searchItem: mockSearchItem, titleOverride: mockTitleOverride },
}));

import { searchItemRoutes } from "@/server/routes/admin/search-items";

let app: ReturnType<typeof Fastify>;

function dbRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    arrId: 7,
    externalId: "42",
    title: "Dark",
    expectedTitle: "Dark",
    expectedAuthor: null,
    germanTitle: "Dunkel",
    mediaType: "tv",
    year: 2017,
    titleSearchVariations: JSON.stringify(["Dunkel"]),
    titleMatchVariations: JSON.stringify(["Dunkel", "Dark"]),
    authorMatchVariations: JSON.stringify([]),
    aliases: null,
    updatedAt: new Date(0),
    arrInstance: { id: "inst1", name: "Sonarr", type: "sonarr" },
    ...over,
  };
}

beforeEach(async () => {
  mockSearchItem.findMany.mockReset();
  mockSearchItem.count.mockReset();
  mockTitleOverride.findMany.mockReset();

  app = Fastify({ logger: false });
  await searchItemRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/admin/search-items", () => {
  it("uses default pagination and returns the envelope", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([]);
    mockSearchItem.count.mockResolvedValueOnce(0);

    const r = await app.inject({ method: "GET", url: "/api/admin/search-items" });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ items: [], total: 0, take: 50, skip: 0 });
    const args = mockSearchItem.findMany.mock.calls[0]?.[0] as {
      take: number;
      skip: number;
      orderBy: unknown;
    };
    expect(args.take).toBe(50);
    expect(args.skip).toBe(0);
    expect(args.orderBy).toEqual({ expectedTitle: "asc" });
  });

  it("builds an OR search over title, expectedTitle and germanTitle, capped at 256 chars", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([]);
    mockSearchItem.count.mockResolvedValueOnce(0);

    const longSearch = "a".repeat(300);
    await app.inject({
      method: "GET",
      url: `/api/admin/search-items?search=${longSearch}`,
    });

    const args = mockSearchItem.findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<{ title?: { contains: string } }> };
    };
    const truncated = "a".repeat(256);
    expect(args.where.OR).toEqual([
      { title: { contains: truncated } },
      { expectedTitle: { contains: truncated } },
      { germanTitle: { contains: truncated } },
    ]);
  });

  it("maps instanceId, mediaType and missingGerman=1 into the where clause", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([]);
    mockSearchItem.count.mockResolvedValueOnce(0);

    await app.inject({
      method: "GET",
      url: "/api/admin/search-items?instanceId=inst1&mediaType=tv&missingGerman=1",
    });

    const args = mockSearchItem.findMany.mock.calls[0]?.[0] as {
      where: { arrInstanceId: string; mediaType: string; germanTitle: unknown };
    };
    expect(args.where.arrInstanceId).toBe("inst1");
    expect(args.where.mediaType).toBe("tv");
    expect(args.where.germanTitle).toBeNull();
  });

  it("shapes items: parsed variations, instance without apiKey/host, and merged overrides", async () => {
    const row1 = dbRow();
    const row2 = dbRow({
      id: "s2",
      externalId: "99",
      expectedTitle: "Other",
      aliases: JSON.stringify(["Alias1"]),
      arrInstance: { id: "inst2", name: "Radarr", type: "radarr" },
    });
    mockSearchItem.findMany.mockResolvedValueOnce([row1, row2]);
    mockSearchItem.count.mockResolvedValueOnce(2);
    mockTitleOverride.findMany.mockResolvedValueOnce([
      { mediaType: "tv", externalId: "42", germanTitle: "Dunkel Override" },
    ]);

    const r = await app.inject({ method: "GET", url: "/api/admin/search-items" });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      items: Array<{
        id: string;
        titleSearchVariations: string[];
        titleMatchVariations: string[];
        authorMatchVariations: string[];
        aliases: string[] | null;
        instance: Record<string, unknown>;
        override: string | null;
      }>;
    };

    expect(body.items).toHaveLength(2);
    const [item1, item2] = body.items;

    expect(item1!.titleSearchVariations).toEqual(["Dunkel"]);
    expect(item1!.titleMatchVariations).toEqual(["Dunkel", "Dark"]);
    expect(item1!.authorMatchVariations).toEqual([]);
    expect(item1!.aliases).toBeNull();
    expect(item1!.instance).toEqual({ id: "inst1", name: "Sonarr", type: "sonarr" });
    expect(item1!.instance).not.toHaveProperty("apiKey");
    expect(item1!.instance).not.toHaveProperty("host");
    expect(item1!.override).toBe("Dunkel Override");

    expect(item2!.aliases).toEqual(["Alias1"]);
    expect(item2!.override).toBeNull();

    expect(mockTitleOverride.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { mediaType: "tv", externalId: "42" },
          { mediaType: "tv", externalId: "99" },
        ],
      },
    });
  });

  it("skips the override lookup and returns no items when the page is empty", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([]);
    mockSearchItem.count.mockResolvedValueOnce(0);

    const r = await app.inject({ method: "GET", url: "/api/admin/search-items" });

    expect(r.json()).toEqual({ items: [], total: 0, take: 50, skip: 0 });
    expect(mockTitleOverride.findMany).not.toHaveBeenCalled();
  });

  it("degrades corrupt JSON columns gracefully instead of 500ing the page", async () => {
    const corruptRow = dbRow({
      titleSearchVariations: "{not valid json",
      titleMatchVariations: "{not valid json",
      authorMatchVariations: "{not valid json",
      aliases: "{not valid json",
    });
    mockSearchItem.findMany.mockResolvedValueOnce([corruptRow]);
    mockSearchItem.count.mockResolvedValueOnce(1);
    mockTitleOverride.findMany.mockResolvedValueOnce([]);

    const r = await app.inject({ method: "GET", url: "/api/admin/search-items" });

    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      items: Array<{
        titleSearchVariations: string[];
        titleMatchVariations: string[];
        authorMatchVariations: string[];
        aliases: string[] | null;
      }>;
    };
    expect(body.items[0]!.titleSearchVariations).toEqual([]);
    expect(body.items[0]!.titleMatchVariations).toEqual([]);
    expect(body.items[0]!.authorMatchVariations).toEqual([]);
    expect(body.items[0]!.aliases).toBeNull();
  });

  it("does not cross-contaminate overrides across mediaTypes and dedupes shared keys", async () => {
    const tvRowInst1 = dbRow(); // tv:42, instance inst1
    const tvRowInst2 = dbRow({
      id: "s2",
      arrInstance: { id: "inst2", name: "Sonarr 2", type: "sonarr" },
    }); // tv:42 again, from a second instance — same key as row 1
    const movieRow = dbRow({
      id: "s3",
      externalId: "42",
      mediaType: "movie",
      arrInstance: { id: "inst3", name: "Radarr", type: "radarr" },
    }); // movie:42 — same externalId, different mediaType
    mockSearchItem.findMany.mockResolvedValueOnce([tvRowInst1, tvRowInst2, movieRow]);
    mockSearchItem.count.mockResolvedValueOnce(3);
    mockTitleOverride.findMany.mockResolvedValueOnce([
      { mediaType: "tv", externalId: "42", germanTitle: "Dunkel Override" },
    ]);

    const r = await app.inject({ method: "GET", url: "/api/admin/search-items" });
    const body = r.json() as { items: Array<{ id: string; override: string | null }> };

    const byId = new Map(body.items.map((i) => [i.id, i.override]));
    expect(byId.get("s1")).toBe("Dunkel Override");
    expect(byId.get("s2")).toBe("Dunkel Override");
    expect(byId.get("s3")).toBeNull();

    const args = mockTitleOverride.findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<{ mediaType: string; externalId: string }> };
    };
    expect(args.where.OR).toEqual([
      { mediaType: "tv", externalId: "42" },
      { mediaType: "movie", externalId: "42" },
    ]);
  });
});
