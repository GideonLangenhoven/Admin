import { test, expect, type Page } from "@playwright/test";

// M12: when the help assistant opened a page for the operator, or the
// operator followed one of its links, the panel closed itself on screens
// narrower than 1024px and the answer disappeared with it.
const FIXTURE = "http://127.0.0.1:3191";
const ANSWER = "Open the booking, then choose Guest actions, then Mark Paid.";

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

async function setup(page: Page) {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname === "/functions/v1/admin-help-chat") return route.fulfill({ json: { answer: ANSWER + " [[open:/bookings]]", sources: [{ route: "/slots", title: "Slots" }] } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    return route.continue();
  });
}

test("the help panel stays open after it opens a page and after its links", async ({ page }) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open AI help" }).click();
  await page.getByRole("textbox", { name: "Your question" }).fill("How do I record a cash payment?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page).toHaveURL(/\/bookings$/);
  const panel = page.getByRole("dialog", { name: "AI help" });
  await expect(panel.getByText(ANSWER)).toBeVisible();
  await panel.getByRole("link", { name: "Slots" }).click();
  await expect(page).toHaveURL(/\/slots$/);
  await expect(panel.getByText(ANSWER)).toBeVisible();
  await panel.getByRole("button", { name: "Close help" }).click();
  await expect(panel).toBeHidden();
});
