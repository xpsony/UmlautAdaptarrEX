import { describe, expect, it } from "vitest";
import { parseNewznabError } from "@/domain/xml/error";

describe("parseNewznabError", () => {
  it("reads code and description of an error document", () => {
    expect(
      parseNewznabError(
        `<?xml version="1.0" encoding="UTF-8"?>\n<error code="500" description="Request limit reached"/>`,
      ),
    ).toEqual({ code: "500", description: "Request limit reached" });
  });
  it("tolerates a BOM, comments, single quotes and a non-self-closing element", () => {
    expect(
      parseNewznabError(`﻿<!-- api --><error code='100' description='Bad key'></error>`),
    ).toEqual({ code: "100", description: "Bad key" });
  });
  it("returns nulls for missing attributes", () => {
    expect(parseNewznabError(`<error/>`)).toEqual({ code: null, description: null });
  });
  it("does not mistake a regular feed for an error", () => {
    expect(parseNewznabError(`<?xml version="1.0"?><rss><channel></channel></rss>`)).toBeNull();
    expect(
      parseNewznabError(`<rss><channel><item><title>error</title></item></channel></rss>`),
    ).toBeNull();
    expect(parseNewznabError(`<errors/>`)).toBeNull();
    expect(parseNewznabError("")).toBeNull();
  });
});
