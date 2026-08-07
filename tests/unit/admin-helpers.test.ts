import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { clampInt, parseOrReply, toCsv } from "@/server/routes/admin/_helpers";

interface FakeReply {
  code: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  _statusCode: number | null;
  _payload: unknown;
}

function makeReply(): FakeReply {
  const reply = {
    _statusCode: null as number | null,
    _payload: null as unknown,
  } as FakeReply;
  reply.code = vi.fn((c: number) => {
    reply._statusCode = c;
    return reply;
  });
  reply.send = vi.fn((p: unknown) => {
    reply._payload = p;
    return reply;
  });
  return reply;
}

describe("parseOrReply", () => {
  const Schema = z.object({ name: z.string().min(1) });

  it("returns the parsed payload on a valid body", () => {
    const reply = makeReply();
    const data = parseOrReply({ name: "ok" }, Schema, reply as never);
    expect(data).toEqual({ name: "ok" });
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("emits a 400 with { error: 'validation', issues } and returns null on failure", () => {
    const reply = makeReply();
    const data = parseOrReply({ name: "" }, Schema, reply as never);
    expect(data).toBeNull();
    expect(reply._statusCode).toBe(400);
    const payload = reply._payload as { error: string; issues: unknown[] };
    expect(payload.error).toBe("validation");
    expect(Array.isArray(payload.issues)).toBe(true);
    expect(payload.issues.length).toBeGreaterThan(0);
  });

  it("returns null when the body is undefined", () => {
    const reply = makeReply();
    const data = parseOrReply(undefined, Schema, reply as never);
    expect(data).toBeNull();
    expect(reply._statusCode).toBe(400);
  });
});

describe("clampInt", () => {
  it("returns the default when the input is undefined or NaN", () => {
    expect(clampInt(undefined, 20, 1, 100)).toBe(20);
    expect(clampInt("not-a-number", 20, 1, 100)).toBe(20);
  });

  it("clamps below the minimum", () => {
    expect(clampInt("0", 20, 1, 100)).toBe(1);
    expect(clampInt("-5", 20, 1, 100)).toBe(1);
  });

  it("clamps above the maximum", () => {
    expect(clampInt("999", 20, 1, 100)).toBe(100);
  });

  it("returns the input verbatim when it sits inside the range", () => {
    expect(clampInt("42", 20, 1, 100)).toBe(42);
  });

  it("treats an empty string as the default (parseInt → NaN)", () => {
    expect(clampInt("", 20, 1, 100)).toBe(20);
  });
});

describe("toCsv", () => {
  it("renders a header row followed by one row per item, in column order", () => {
    const csv = toCsv([{ id: "1", name: "Alice" }], ["id", "name"]);
    expect(csv).toBe("id,name\r\n1,Alice");
  });

  it("joins multiple rows with CRLF (RFC-4180 line endings)", () => {
    const csv = toCsv(
      [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ],
      ["id", "name"],
    );
    expect(csv).toBe("id,name\r\n1,Alice\r\n2,Bob");
  });

  it("renders just the header row when there are no items", () => {
    expect(toCsv([], ["id", "name"])).toBe("id,name");
  });

  it("quotes a cell containing a comma", () => {
    const csv = toCsv([{ note: "a, b" }], ["note"]);
    expect(csv).toBe('note\r\n"a, b"');
  });

  it("quotes a cell containing a double quote, doubling it", () => {
    const csv = toCsv([{ note: 'say "hi"' }], ["note"]);
    expect(csv).toBe('note\r\n"say ""hi"""');
  });

  it("quotes a cell containing a newline", () => {
    const csv = toCsv([{ note: "line1\nline2" }], ["note"]);
    expect(csv).toBe('note\r\n"line1\nline2"');
  });

  it("quotes a cell containing a carriage return", () => {
    const csv = toCsv([{ note: "line1\rline2" }], ["note"]);
    expect(csv).toBe('note\r\n"line1\rline2"');
  });

  it("renders null and undefined cells as empty (not the string 'null'/'undefined')", () => {
    const csv = toCsv([{ a: null, b: undefined }], ["a", "b"]);
    expect(csv).toBe("a,b\r\n,");
  });

  it("renders a Date cell as its ISO-8601 string", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const csv = toCsv([{ createdAt: date }], ["createdAt"]);
    expect(csv).toBe("createdAt\r\n2026-01-02T03:04:05.000Z");
  });

  it("stringifies numbers and booleans without quoting", () => {
    const csv = toCsv([{ n: 42, ok: true, off: false }], ["n", "ok", "off"]);
    expect(csv).toBe("n,ok,off\r\n42,true,false");
  });

  it("reads a column missing from the row as an empty cell", () => {
    const csv = toCsv([{ a: "x" }], ["a", "b"]);
    expect(csv).toBe("a,b\r\nx,");
  });

  // CSV/formula injection (CWE-1236): a string cell starting with =, +, -, or
  // @ is interpreted as a formula by Excel/Sheets/LibreOffice on open. These
  // columns carry free text that ultimately traces back to *arr search
  // queries / indexer release titles, which an attacker can influence — so a
  // crafted release name must not turn into an executing formula for the
  // admin who opens the export.
  it.each(["=1+1", "+1+1", "-1+1", "@SUM(A1:A2)", "=cmd|'/c calc'!A1", "\t=1+1"])(
    "neutralizes a string cell that looks like a formula (%s) with a leading apostrophe",
    (formula) => {
      const csv = toCsv([{ note: formula }], ["note"]);
      expect(csv).toBe(`note\r\n'${formula}`);
    },
  );

  it("still quotes a neutralized formula cell if it also contains a comma", () => {
    const csv = toCsv([{ note: "=1+1,2" }], ["note"]);
    expect(csv).toBe('note\r\n"\'=1+1,2"');
  });

  it("neutralizes AND RFC-4180-quotes a formula cell that also contains a double quote", () => {
    const csv = toCsv([{ note: '=HYPERLINK("http://evil")' }], ["note"]);
    expect(csv).toBe('note\r\n"\'=HYPERLINK(""http://evil"")"');
  });

  it("does not neutralize a legitimate negative number (not a string cell)", () => {
    const csv = toCsv([{ n: -5 }], ["n"]);
    expect(csv).toBe("n\r\n-5");
  });

  it("does not touch a plain string that merely contains (not starts with) a formula character", () => {
    const csv = toCsv([{ note: "total = 5" }], ["note"]);
    expect(csv).toBe("note\r\ntotal = 5");
  });
});
