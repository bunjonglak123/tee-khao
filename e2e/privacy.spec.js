import { test, expect } from "@playwright/test";
import { createParty } from "./helpers.js";

test("a stranger cannot see a party until they open its link", async ({ browser }) => {
  const owner = await browser.newContext();
  const id = await createParty(await owner.newPage(), { title: "ตี้ลับของเพื่อน", nick: "เจ้าของ" });

  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  await page.goto("/");
  await expect(page.locator("#listEmpty")).toContainText("ยังไม่มีตี้ในเครื่องนี้");
  await expect(page.locator("#partyList")).not.toContainText("ตี้ลับของเพื่อน");

  await page.goto("/#p-" + id);
  await expect(page.locator("#pTitle")).toHaveText("ตี้ลับของเพื่อน");

  await page.goto("/");
  await page.reload();
  await expect(page.locator("#partyList")).toContainText("ตี้ลับของเพื่อน");

  await owner.close();
  await stranger.close();
});

test("the owner's browser keeps its own parties on the home list", async ({ page }) => {
  await createParty(page, { title: "ตี้ของฉัน", nick: "ฉัน" });
  await page.goto("/");
  await page.reload();
  await expect(page.locator("#partyList")).toContainText("ตี้ของฉัน");
});
