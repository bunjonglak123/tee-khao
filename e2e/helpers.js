export async function createParty(page, { title, nick }) {
  await page.goto("/");
  await page.locator("#newBtn").click();
  await page.locator("#cTitle").fill(title);
  await page.locator("#cNick").fill(nick);
  await page.locator("#createForm button[type=submit]").click();
  await page.waitForURL(/#p-[A-Za-z0-9]+$/);
  await page.locator("#pTitle").filter({ hasText: title }).waitFor();
  return page.url().split("#p-")[1];
}
