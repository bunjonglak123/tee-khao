import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hasDb, resetDb } from "./helpers/db.js";
import { call } from "./helpers/http.js";
import { db, readState } from "../api/_lib.js";
import { seedDemo, DEMO_PARTIES } from "../lib/seed.js";
import reset from "../api/reset-demo.js";

const count = async () => Number((await db()`select count(*)::int as n from teekhao.parties`)[0].n);

describe.skipIf(!hasDb)("demo seed", () => {
  beforeEach(async () => { await resetDb(); });
  afterEach(() => { delete process.env.DEMO_MODE; delete process.env.CRON_SECRET; });

  it("is idempotent: seeding twice leaves exactly the demo parties", async () => {
    await seedDemo(db());
    await seedDemo(db());
    expect(await count()).toBe(DEMO_PARTIES.length);
    expect(DEMO_PARTIES.length).toBe(4);
  });

  it("stores members and items readable by the app", async () => {
    await seedDemo(db());
    const svc = DEMO_PARTIES.find((p) => p.data.service && p.data.vat);
    const st = await readState(db(), svc.id);
    expect(st.members.length).toBeGreaterThan(1);
    expect(st.items.length).toBeGreaterThan(1);
  });

  it("uses no real-looking PromptPay number", () => {
    for (const p of DEMO_PARTIES) expect(["", "0800000000"]).toContain(p.data.promptpay);
  });
});

describe.skipIf(!hasDb)("POST /api/reset-demo", () => {
  beforeEach(async () => {
    await resetDb();
    await db()`insert into teekhao.parties (id, data) values ('realparty0001', ${db().json({ title: "จริง" })})`;
  });
  afterEach(() => { delete process.env.DEMO_MODE; delete process.env.CRON_SECRET; });

  it("is a 404 outside demo mode and leaves data alone", async () => {
    process.env.CRON_SECRET = "s3cret";
    const r = await call(reset, { headers: { authorization: "Bearer s3cret" } });
    expect(r.statusCode).toBe(404);
    expect(await count()).toBe(1);
  });
  it("rejects a wrong or missing secret", async () => {
    process.env.DEMO_MODE = "1";
    process.env.CRON_SECRET = "s3cret";
    expect((await call(reset, { headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call(reset, { headers: { authorization: "Bearer " } })).statusCode).toBe(401);
    expect(await count()).toBe(1);
  });
  it("reseeds with the right secret", async () => {
    process.env.DEMO_MODE = "1";
    process.env.CRON_SECRET = "s3cret";
    const r = await call(reset, { headers: { authorization: "Bearer s3cret" } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, parties: 4 });
    expect(await count()).toBe(4);
  });
});
