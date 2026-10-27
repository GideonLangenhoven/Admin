import { test, expect, type Page } from "@playwright/test";

// M9: the Financials and Attendance tiles add up. Received (R154 660) showed
// more than Gross booked (R141 280) because Received keeps money taken on
// bookings later cancelled while Gross left those bookings out; tomorrow's
// guests counted as "not arrived" and dragged the attendance rate down.
const row = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
  id, customer_name: "Guest " + id, qty: 2, status: "PAID", total_amount: 400, total_captured: 400,
  created_at: "2026-10-10T08:00:00Z", arrived_count: 0, checked_in: false, tours: { name: "Harbour paddle" }, slots: { start_time: start }, ...extra,
});
const ROWS = [
  row("departed", "2026-10-14T08:00:00Z", { arrived_count: 1 }), // yesterday: 1 of 2 came
  row("tomorrow", "2026-10-16T08:00:00Z", { qty: 3, total_amount: 600, total_captured: 600 }),
  row("cancelled", "2026-10-20T08:00:00Z", { status: "CANCELLED", total_amount: 500, total_captured: 500 }), // paid, then cancelled
];

async function setup(page: Page) {
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
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/rest/v1/bookings" && url.searchParams.get("select")?.includes("ota_gross_amount")) return route.fulfill({ json: ROWS });
    return route.continue();
  });
}

const tile = (page: Page, label: string) => page.locator(".ui-card").filter({ has: page.getByText(label, { exact: true }) }).first();
const value = (page: Page, label: string) => tile(page, label).locator("p").last();

test("gross booked includes cancelled bookings, so it covers what was received", async ({ page }) => {
  await setup(page);
  await page.goto("/reports?tab=financials");
  await expect(value(page, "Gross Booked")).toHaveText(/^R1\s500,00$/);
  await expect(value(page, "Received")).toHaveText(/^R1\s500,00$/);
  await expect(tile(page, "Gross Booked")).toHaveAttribute("title", /booking date.*cancelled/i);
  await expect(page.getByText(/Gross includes R500,00 on cancelled bookings/)).toBeVisible();
});

test("tomorrow's guests are upcoming, not missing from the attendance rate", async ({ page }) => {
  await setup(page);
  await page.goto("/reports?tab=attendance");
  await expect(value(page, "Total Pax")).toHaveText("5");
  await expect(value(page, "Checked In")).toHaveText("1");
  await expect(value(page, "Not Arrived")).toHaveText("1");
  await expect(value(page, "Upcoming")).toHaveText("3");
  await expect(value(page, "Attendance Rate")).toHaveText("50%");
  await page.getByText("2 bookings · 1 of 5 arrived · 3 upcoming").click();
  await expect(page.getByRole("row", { name: /Guest tomorrow/ })).toContainText("Upcoming");
  await expect(page.getByRole("row", { name: /Guest departed/ })).toContainText("1/2 arrived");
});
