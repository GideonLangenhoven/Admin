import { test, expect } from "@playwright/test";

// P2 accessibility: every Settings input, select, text area and editor has a
// label a screen reader announces (most sat next to a <label> it wasn't tied to).
const FIXTURE = "http://127.0.0.1:3191";

test("every Settings field is named by its label", async ({ page, request }) => {
  await request.post(`${FIXTURE}/__fixture/reset`);
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    return route.continue();
  });
  await page.goto("/settings");
  const closed = page.locator('button[aria-expanded="false"][aria-controls$="-content"]');
  await expect(closed.first()).toBeVisible();
  while (await closed.count()) await closed.first().click();

  const report = await page.evaluate(() => {
    const controls = [...document.querySelectorAll<HTMLElement>('[id$="-content"] :is(input, select, textarea, [contenteditable="true"])')]
      .filter(el => el.getClientRects().length && (el as HTMLInputElement).type !== "hidden");
    const named = (el: HTMLElement) => (el as HTMLInputElement).labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.title;
    const ids = [...document.querySelectorAll("[id^='settings-']")].map(el => el.id);
    return {
      checked: controls.length,
      unnamed: controls.filter(el => !named(el)).map(el => el.outerHTML.slice(0, 90)),
      duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
    };
  });
  expect(report.checked).toBeGreaterThan(40);
  expect(report.unnamed).toEqual([]);
  expect(report.duplicateIds).toEqual([]);
});
