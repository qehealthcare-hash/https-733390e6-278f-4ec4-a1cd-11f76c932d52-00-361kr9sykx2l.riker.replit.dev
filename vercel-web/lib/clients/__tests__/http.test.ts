import { describe, expect, it } from "vitest";
import { toQueryString, withQuery } from "@/lib/clients/http";

describe("clients/http", () => {
  it("toQueryString skips empty values and encodes", () => {
    expect(
      toQueryString({
        q: "a b",
        status: "Active",
        empty: "",
        skip: undefined,
        also: null
      })
    ).toBe("q=a%20b&status=Active");
  });

  it("withQuery appends query string when params exist", () => {
    expect(withQuery("/patients", { limit: 50, offset: 0 })).toBe("/patients?limit=50&offset=0");
    expect(withQuery("/patients", {})).toBe("/patients");
    expect(withQuery("/patients")).toBe("/patients");
  });
});
