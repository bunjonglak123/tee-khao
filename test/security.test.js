import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { hasDb, resetDb } from "./helpers/db.js";
import { createServer } from "../server.js";
import { db, ensure, hit, clientKey } from "../api/_lib.js";

const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

let srv, base;
beforeAll(async () => {
  srv = createServer();
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => new Promise((r) => srv.close(r)));

describe("security headers", () => {
  const site = vercel.headers.find((h) => h.source === "/(.*)");
  it("vercel.json sets them for every path", () => {
    expect(site).toBeTruthy();
    const keys = site.headers.map((h) => h.key.toLowerCase());
    for (const k of ["content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"]) {
      expect(keys).toContain(k);
    }
  });
  it("CSP blocks framing, plugins and outside scripts", () => {
    const csp = site.headers.find((h) => h.key.toLowerCase() === "content-security-policy").value;
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/script-src 'self'(;|$)/);
  });
  it("the local server sends the same headers", async () => {
    const r = await fetch(base + "/");
    for (const h of site.headers) expect(r.headers.get(h.key)).toBe(h.value);
  });
});

describe("page scripts", () => {
  it("loads no script from another site", () => {
    const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) expect(s.startsWith("/")).toBe(true);
  });
  it("serves the bundled QR library", async () => {
    const r = await fetch(base + "/vendor/qrcode.js");
    expect(r.status).toBe(200);
  });
});

describe("clientKey", () => {
  it("uses the first x-forwarded-for address and hashes it", () => {
    const k = clientKey({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(k).toBe(clientKey({ headers: { "x-forwarded-for": "1.2.3.4" } }));
    expect(k).not.toContain("1.2.3.4");
    expect(k).not.toBe(clientKey({ headers: { "x-forwarded-for": "5.6.7.8" } }));
  });
  it("falls back to a shared key when there is no address", () => {
    expect(clientKey({ headers: {} })).toBe(clientKey({}));
  });
});

describe.skipIf(!hasDb)("rate limit", () => {
  beforeAll(async () => { await resetDb(); await ensure(); await db()`truncate teekhao.hits`; });

  it("hit() allows up to the limit, then refuses", async () => {
    const s = db();
    for (let i = 0; i < 3; i++) await expect(hit(s, "t:a", 3, 3600)).resolves.toBe(true);
    await expect(hit(s, "t:a", 3, 3600)).resolves.toBe(false);
    await expect(hit(s, "t:b", 3, 3600)).resolves.toBe(true);
  });

  it("refuses party creation past the hourly limit for one address", async () => {
    const post = (ip) => fetch(base + "/api/parties", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ title: "ตี้", nick: "เอ" }),
    });
    let last;
    for (let i = 0; i < 21; i++) last = await post("9.9.9.9");
    expect(last.status).toBe(429);
    expect((await post("8.8.8.8")).status).toBe(200);
  });
});

describe.skipIf(!hasDb)("row level security", () => {
  it("is on for every app table, so Supabase's public API roles see nothing", async () => {
    await ensure();
    const rows = await db()`select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'teekhao' and c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) expect([r.relname, r.relrowsecurity]).toEqual([r.relname, true]);
  });
});
