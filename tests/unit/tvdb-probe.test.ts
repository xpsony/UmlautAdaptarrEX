import { afterEach, describe, expect, it, vi } from "vitest";
import { probeTvdbKey, TvdbProvider } from "@/providers/tvdb.js";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

afterEach(() => {
  requestMock.mockReset();
});

function jsonResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    body: {
      json: async () => data,
      text: async () => JSON.stringify(data),
    },
  };
}

describe("probeTvdbKey", () => {
  it("returns code='missing' for empty string", async () => {
    expect(await probeTvdbKey("")).toEqual({ ok: false, code: "missing" });
  });

  it("returns code='unauthorized' when login is rejected with 401", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse({ status: "failure", message: "bad key" }, 401),
    );
    const r = await probeTvdbKey("some-key");
    expect(r).toEqual({ ok: false, code: "unauthorized" });
  });

  it("returns ok with sample title on a happy login + lookup", async () => {
    requestMock
      .mockResolvedValueOnce(
        jsonResponse({ status: "success", data: { token: "JWT" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          data: { id: 121361, name: "Sample Series" },
        }),
      );
    const r = await probeTvdbKey("some-key");
    expect(r).toEqual({
      ok: true,
      sample: { id: 121361, title: "Sample Series" },
    });
  });
});

describe("TvdbProvider - token re-login on 401", () => {
  it("re-logs in once when an authed call returns 401", async () => {
    requestMock
      // initial login
      .mockResolvedValueOnce(
        jsonResponse({ status: "success", data: { token: "T1" } }),
      )
      // first authed call → 401 expired
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // re-login
      .mockResolvedValueOnce(
        jsonResponse({ status: "success", data: { token: "T2" } }),
      )
      // retry succeeds
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          data: { name: "Tatfall", aliases: ["Tatfall 2024"] },
        }),
      );
    const provider = new TvdbProvider({
      apiKey: "key",
      userAgent: "test",
    });
    const result = await provider.fetchByExternalId("tv", "78023", ["de"]);
    expect(result).not.toBeNull();
    expect(result?.titlesByLang.de).toBe("Tatfall");
    // login + 401 + login + retry = 4 calls total
    expect(requestMock).toHaveBeenCalledTimes(4);
  });
});
