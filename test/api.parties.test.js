import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hasDb, resetDb } from "./helpers/db.js";
import { call } from "./helpers/http.js";
import parties from "../api/parties.js";

describe.skipIf(!hasDb)("GET /api/parties", () => {
  let a, b;
  beforeEach(async () => {
    await resetDb();
    a = (await call(parties, { method: "POST", body: { title: "ตี้A", nick: "เอ" } })).body.id;
    b = (await call(parties, { method: "POST", body: { title: "ตี้B", nick: "บี" } })).body.id;
  });
  afterEach(() => { delete process.env.DEMO_MODE; });

  it("lists nothing without ids", async () => {
    const r = await call(parties, { query: {} });
    expect(r.statusCode).toBe(200);
    expect(r.body.parties).toEqual([]);
  });
  it("lists only the requested ids", async () => {
    const r = await call(parties, { query: { ids: a } });
    expect(r.body.parties.map((p) => p.id)).toEqual([a]);
    expect(r.body.parties[0].title).toBe("ตี้A");
  });
  it("ignores junk and oversized id lists", async () => {
    const junk = Array.from({ length: 60 }, (_, i) => "x" + i).join(",");
    const r = await call(parties, { query: { ids: `${a},../../x,,'; drop table x;--,${junk}` } });
    expect(r.statusCode).toBe(200);
    expect(r.body.parties.map((p) => p.id)).toEqual([a]);
  });
  it("lists everything in demo mode", async () => {
    process.env.DEMO_MODE = "1";
    const r = await call(parties, { query: {} });
    expect(r.body.parties.map((p) => p.id).sort()).toEqual([a, b].sort());
  });
});
