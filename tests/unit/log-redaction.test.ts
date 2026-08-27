import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";

// We can't easily reach into the production `createLogger` (it pulls in the DB
// queue + pino-pretty), but the redaction is a pure function we can replicate
// via pino's `formatters.log` hook. Importing the helper directly via the
// module's named export ensures we test the same regex/blocklist that
// production uses.
import { redactValueForTests } from "@/server/logging/logger";

function logAndCapture(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const lines: string[] = [];
  const dest = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString("utf8"));
      cb();
    },
  });
  const log = pino(
    {
      formatters: {
        log(obj) {
          return redactValueForTests(obj) as Record<string, unknown>;
        },
      },
    },
    dest,
  );
  log.info(payload, "test");
  const last = lines[lines.length - 1] ?? "{}";
  return JSON.parse(last) as Record<string, unknown>;
}

describe("log redaction - sensitive object keys", () => {
  it.each([
    ["password", "secret123"],
    ["passwordHash", "$argon2id$..."],
    ["proxyPassword", "shh"],
    ["apiKey", "k_live_abc"],
    ["api_key", "k_live_abc"],
    ["tmdbApiKey", "tmdb_xyz"],
    ["appApiKey", "app_xyz"],
    ["prowlarrApiKey", "p_xyz"],
    ["csrfSecret", "secret_b64"],
    ["authorization", "Bearer x"],
    ["cookie", "uaSession=abc"],
    ["x-api-key", "k"],
  ])("redacts key %s", (key, value) => {
    const out = logAndCapture({ [key]: value });
    expect(out[key]).toBe("[REDACTED]");
  });

  it("does not redact a non-sensitive key like `username`", () => {
    const out = logAndCapture({ username: "alice" });
    expect(out.username).toBe("alice");
  });

  it("does not redact `applicationKeyword` (false-positive guard)", () => {
    const out = logAndCapture({ applicationKeyword: "ok" });
    expect(out.applicationKeyword).toBe("ok");
  });
});

describe("log redaction - strings", () => {
  it("redacts apikey= in URLs", () => {
    const out = logAndCapture({ url: "https://x/api?apikey=ABCDEF" });
    expect(out.url).toContain("apikey=[REDACTED]");
    expect(out.url).not.toContain("ABCDEF");
  });

  it("redacts api_key= and apiKey= in URLs", () => {
    const out = logAndCapture({ url: "https://x?api_key=ABC&apiKey=DEF" });
    expect(out.url).toContain("api_key=[REDACTED]");
    expect(out.url).toContain("apiKey=[REDACTED]");
    expect(out.url).not.toContain("ABC");
    expect(out.url).not.toContain("DEF");
  });

  it("redacts authorization-like header lines in strings", () => {
    const out = logAndCapture({ header: "Authorization: Bearer abc.def" });
    expect(out.header).toContain("Authorization: [REDACTED]");
  });
});
