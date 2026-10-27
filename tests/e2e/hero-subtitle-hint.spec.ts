import { test, expect } from "@playwright/test";

// M6: the booking site shows the hero only when it has a title (the
// all-operator hero rule), so a subtitle without a title says why it is hidden.
test("a hero subtitle without a title explains why it is hidden", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    return route.continue();
  });
  await page.goto("/settings#site");
  const field = (label: string) => page.getByText(label, { exact: true }).locator("xpath=following-sibling::input");
  const hint = page.getByText("Add a Hero Title to show the eyebrow and subtitle on your booking site.");

  await field("Hero Title").fill("");
  await expect(field("Hero Subtitle")).toBeVisible();
  await expect(hint).toBeHidden();
  await field("Hero Subtitle").fill("Paddle the Atlantic coastline.");
  await expect(hint).toBeVisible();
  await field("Hero Title").fill("Find your paddle");
  await expect(hint).toBeHidden();
});
