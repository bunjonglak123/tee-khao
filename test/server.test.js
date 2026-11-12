import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hasDb, resetDb } from "./helpers/db.js";
import { createServer } from "../server.js";

let srv, base;
beforeAll(async () => {
  srv = createServer();
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => new Promise((r) => srv.close(r)));

describe("static files", () => {
  it("serves the app page", async () => {
    const r = await fetch(base + "/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
  });
  it("serves browser modules with a JS type", async () => {
    const r = await fetch(base + "/lib/bill.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/javascript/);
  });
  it.each(["/package.json", "/api/_lib.js", "/.git/config", "/server.js", "/lib/../package.json", "/test/setup.js"])("hides %s", async (p) => {
    expect((await fetch(base + p)).status).toBe(404);
  });
  it("does not route private api modules", async () => {
    expect((await fetch(base + "/api/_lib")).status).toBe(404);
  });
});

describe.skipIf(!hasDb)("api routes", () => {
  beforeAll(async () => { await resetDb(); });
  it("creates and reads a party", async () => {
    const c = await fetch(base + "/api/parties", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "ตี้", nick: "เอ" }) });
    expect(c.status).toBe(200);
    const { id } = await c.json();
    const g = await fetch(base + "/api/party?id=" + id);
    expect(g.status).toBe(200);
    expect((await g.json()).party.title).toBe("ตี้");
  });
  it("rejects bodies over 6 MB", async () => {
    const r = await fetch(base + "/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: "A".repeat(7_000_000) }) });
    expect(r.status).toBe(413);
  });
});
