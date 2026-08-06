import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPlugin } = vi.hoisted(() => ({
  mockPlugin: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { plugin: mockPlugin },
}));

import { loadActivePlugins, resetSeedGuardForTests, seedPlugins } from "@/server/plugins/seed";
import { BUILTIN_PLUGINS } from "@/domain/plugins";

beforeEach(() => {
  mockPlugin.upsert.mockReset();
  mockPlugin.findMany.mockReset();
  resetSeedGuardForTests();
});

afterEach(() => {
  mockPlugin.upsert.mockReset();
  mockPlugin.findMany.mockReset();
  resetSeedGuardForTests();
});

describe("seedPlugins", () => {
  it("upserts every built-in plugin with its defaultEnabled value", async () => {
    mockPlugin.upsert.mockResolvedValue({});
    await seedPlugins();

    expect(mockPlugin.upsert).toHaveBeenCalledTimes(BUILTIN_PLUGINS.length);
    for (const plugin of BUILTIN_PLUGINS) {
      const matching = mockPlugin.upsert.mock.calls.find(
        (call) => (call[0] as { where: { id: string } }).where.id === plugin.id,
      );
      expect(matching).toBeDefined();
      const args = matching![0] as {
        create: { id: string; enabled: boolean };
        update: object;
      };
      expect(args.create).toEqual({
        id: plugin.id,
        enabled: plugin.defaultEnabled,
      });
      expect(args.update).toEqual({});
    }
  });

  it("only upserts once across repeated calls within the same process", async () => {
    mockPlugin.upsert.mockResolvedValue({});
    await seedPlugins();
    await seedPlugins();

    expect(mockPlugin.upsert).toHaveBeenCalledTimes(BUILTIN_PLUGINS.length);
  });

  it("seeds again after resetSeedGuardForTests()", async () => {
    mockPlugin.upsert.mockResolvedValue({});
    await seedPlugins();
    resetSeedGuardForTests();
    await seedPlugins();

    expect(mockPlugin.upsert).toHaveBeenCalledTimes(BUILTIN_PLUGINS.length * 2);
  });
});

describe("loadActivePlugins", () => {
  it("returns the ids of enabled plugins", async () => {
    mockPlugin.findMany.mockResolvedValueOnce([
      { id: "german-umlauts" },
      { id: "swedish-umlauts" },
    ]);
    expect(await loadActivePlugins()).toEqual(["german-umlauts", "swedish-umlauts"]);
    const args = mockPlugin.findMany.mock.calls[0]?.[0] as {
      where: { enabled: boolean };
    };
    expect(args.where).toEqual({ enabled: true });
  });

  it("returns an empty array when nothing is enabled", async () => {
    mockPlugin.findMany.mockResolvedValueOnce([]);
    expect(await loadActivePlugins()).toEqual([]);
  });
});
