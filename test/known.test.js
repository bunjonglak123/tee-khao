import { describe, it, expect } from "vitest";
import { knownIds, addKnown, pruneKnown } from "../lib/known.js";

function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe("known parties store", () => {
  it("is empty for a fresh browser", () => {
    expect(knownIds(mem())).toEqual([]);
  });
  it("recovers parties from older tk-me-* keys", () => {
    expect(knownIds(mem({ "tk-me-abc123def456": "m1", "tk-nick": "a" }))).toEqual(["abc123def456"]);
  });
  it("adds each id once", () => {
    const s = mem();
    addKnown(s, "aaaaaa111111");
    addKnown(s, "aaaaaa111111");
    expect(knownIds(s)).toEqual(["aaaaaa111111"]);
  });
  it("prunes ids the server no longer has", () => {
    const s = mem();
    addKnown(s, "aaaaaa111111");
    addKnown(s, "bbbbbb222222");
    pruneKnown(s, ["aaaaaa111111"]);
    expect(knownIds(s)).toEqual(["aaaaaa111111"]);
  });
  it("ignores corrupt storage", () => {
    expect(knownIds(mem({ "tk-parties": "{not json" }))).toEqual([]);
  });
});
