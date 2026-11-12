import { test, expect } from "@playwright/test";
import { createParty } from "./helpers.js";

test("create a party, add a friend and a dish, see the split, mark paid", async ({ page }) => {
  await createParty(page, { title: "ทดสอบหารบิล", nick: "เอ" });

  await page.locator("#addName").fill("บี");
  await page.locator("#addMemberForm button[type=submit]").click();
  await expect(page.locator("#memberList")).toContainText("บี");

  await page.locator("#iName").fill("หมู");
  await page.locator("#iPrice").fill("300");
  await page.locator("#itemForm button[type=submit]").click();
  await expect(page.locator("#itemList")).toContainText("หมู");

  const people = page.locator("#slip .person");
  const row = (name) => people.filter({ has: page.locator(".who", { hasText: new RegExp("^" + name) }) });
  await expect(people).toHaveCount(2);
  await expect(row("บี").locator(".due")).toHaveText("฿150");
  await expect(row("เอ").locator(".due")).toHaveText("฿150");

  await page.getByLabel("บี โอนแล้ว").check();
  await expect(row("บี")).toContainText("โอนแล้ว");

  await page.reload();
  await expect(page.getByLabel("บี โอนแล้ว")).toBeChecked();
});
