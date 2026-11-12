// Seed the fake demo data, start the app in demo mode and save README screenshots.
// Usage: TEST_DATABASE_URL=postgres://... node scripts/screenshots.js
import { chromium } from "@playwright/test";

const DB = process.env.TEST_DATABASE_URL;
if (!DB) { console.error("Set TEST_DATABASE_URL"); process.exit(1); }
Object.assign(process.env, { POSTGRES_URL: DB, PGSSLMODE: "disable", DEMO_MODE: "1" });

const { db, ensure } = await import("../api/_lib.js");
const { seedDemo, DEMO_PARTIES } = await import("../lib/seed.js");
const { createServer } = await import("../server.js");
await ensure();
await seedDemo(db());

const srv = createServer();
await new Promise((r) => srv.listen(0, r));
const base = `http://localhost:${srv.address().port}`;
const browser = await chromium.launch();
const shot = async (viewport, hash, file, scrollTo) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "th-TH", timezoneId: "Asia/Bangkok", colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(base + "/" + hash);
  await page.locator("#partyList li").first().waitFor({ state: "attached" });
  if (hash) await page.locator("#slip .person").first().waitFor();
  if (scrollTo) await page.locator(scrollTo).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `docs/screenshots/${file}` });
  await ctx.close();
  console.log("saved", file);
};
const moo = "#p-" + DEMO_PARTIES[0].id;
await shot({ width: 1280, height: 800 }, "", "home.png");
await shot({ width: 1280, height: 800 }, moo, "party.png");
await shot({ width: 1280, height: 800 }, moo, "bill.png", "#slip");
await shot({ width: 390, height: 844 }, moo, "mobile.png");
await browser.close();
srv.close();
await db().end();
