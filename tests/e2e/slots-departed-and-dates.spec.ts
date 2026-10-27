import { test, expect, type Page } from "@playwright/test";

// P2: a slot whose departure had passed still said "Open: accepting
// bookings", and Add slot offered past dates and opened the end-date
// calendar on today's month instead of the start date's.
const FIXTURE = "http://127.0.0.1:3191";

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  // 11:00 in Cape Town on 15 Oct: the 10:00 departure has left.
  await page.clock.setFixedTime(new Date("2026-10-15T09:00:00Z"));
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    return route.continue();
  });
}

test("a departed slot says so and offers no close or reopen", async ({ page }) => {
  await setup(page);
  await page.goto("/slots");
  await page.getByText("8/20").click(); // the 10:00 Harbour paddle departure
  await expect(page.getByText("○ Departed: no longer taking bookings")).toBeVisible();
  await expect(page.locator('[data-demo-action="slot.close"]')).toHaveCount(0);
});

test("Add slot offers no past dates and opens the end date on the start's month", async ({ page }) => {
  await setup(page);
  await page.goto("/slots?panel=add");
  const dialog = page.getByRole("dialog", { name: "Add New Slots" });
  await dialog.getByRole("button", { name: "Start Date" }).click();
  await expect(page.locator('[data-day="2026-10-14"]')).toHaveAttribute("data-disabled", "true");
  await expect(page.locator('[data-day="2026-10-16"]')).not.toHaveAttribute("data-disabled", "true");
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.locator('[data-day="2026-12-10"] button').click();
  await dialog.getByRole("button", { name: "End Date" }).click();
  await expect(page.getByText("December 2026")).toBeVisible();
  await expect(page.locator('[data-day="2026-12-09"]')).toHaveAttribute("data-disabled", "true");
});
