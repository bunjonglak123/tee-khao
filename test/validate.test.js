import { describe, it, expect } from "vitest";
import { cleanPatch, cleanItem } from "../api/_validate.js";

describe("cleanPatch", () => {
  it("trims, clamps and drops unknown banks", () => {
    expect(cleanPatch({ title: "  x  ", bank: "evil", max: 999 })).toEqual({ title: "x", max: 50 });
  });
  it("returns {} for junk", () => {
    expect(cleanPatch(null)).toEqual({});
  });
});

describe("cleanItem", () => {
  it("rejects items without a name", () => {
    expect(cleanItem({ name: "" }, 0)).toBeNull();
  });
  it("rounds price, clamps qty, filters bad share ids", () => {
    const it = cleanItem({ name: "a", price: 1.234, qty: 0, shares: ["bad id!", "abcdef123456"] }, 0);
    expect(it).toMatchObject({ name: "a", price: 1.23, qty: 1, shares: ["abcdef123456"] });
  });
});
