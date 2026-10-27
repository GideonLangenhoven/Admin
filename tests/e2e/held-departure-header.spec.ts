import { test, expect, type Page } from "@playwright/test";

// M10: a departure whose only booking is on hold showed "0 guests · Due R0,00".
// Held guests and their amount now show separately on the departure header.
const BOOKING = "10000000-0000-4000-8000-000000000027"; // 3 guests, R300, alone on the 16 Oct departure
const FIXTURE = "http://127.0.0.1:3191";
const HELD = { status: "HELD", payment_deadline: "2026-10-16T06:00:00Z" };

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

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
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/rest/v1/rpc/list_operator_bookings" || (url.pathname === "/rest/v1/bookings" && req.method() === "GET")) {
      const res = await route.fetch();
      const rows = await res.json();
      const edit = (row: { id?: string }) => row.id === BOOKING ? { ...row, ...HELD } : row;
      return route.fulfill({ response: res, json: Array.isArray(rows) ? rows.map(edit) : edit(rows) });
    }
    return route.continue();
  });
}

for (const [layout, width] of [["desktop", 1280], ["phone", 390]] as const) {
  test(`the ${layout} departure header shows held guests and the amount pending`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page.goto("/bookings");
    await expect(page.getByText("3 held · R300,00 pending").filter({ visible: true })).toBeVisible();
  });
}
