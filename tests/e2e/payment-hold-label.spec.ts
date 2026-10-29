import { test, expect, type Page } from "@playwright/test";

// M7: a payment hold counts down to its deadline, on the booking page and in
// the bookings list alike. The page said "Expires just now remaining" for a
// deadline two days away.
const BOOKING = "10000000-0000-4000-8000-000000000022"; // CONFIRMED, R100 of R200 received
const FIXTURE = "http://127.0.0.1:3191";
const HELD = { status: "HELD", payment_deadline: "2026-10-17T08:10:00Z" }; // now + 2d 3h 10m

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

async function setup(page: Page, held: Record<string, unknown> = HELD) {
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
      const edit = (row: { id?: string }) => row.id === BOOKING ? { ...row, ...held } : row;
      return route.fulfill({ response: res, json: Array.isArray(rows) ? rows.map(edit) : edit(rows) });
    }
    return route.continue();
  });
}

test("the booking page counts down to the payment deadline", async ({ page }) => {
  await setup(page);
  await page.goto(`/bookings/${BOOKING}`);
  await expect(page.getByText("Expires in 2d 3h", { exact: true })).toBeVisible();
  await expect(page.getByText(/just now/i)).toHaveCount(0);
});

test("the bookings list shows the same countdown", async ({ page }) => {
  await setup(page);
  await page.goto("/bookings");
  await page.getByRole("checkbox", { name: "Expand All" }).first().check();
  await expect(page.locator(`[data-booking-id="${BOOKING}"]`).filter({ visible: true }).first()).toContainText("Expires in 2d 3h");
});

// Round 2, 13d: a booking allowed without payment never expires (cron-tasks
// skips it), yet both screens counted down to its deadline.
test("a booking allowed without payment shows no countdown", async ({ page }) => {
  await setup(page, { ...HELD, allow_unpaid: true });
  await page.goto(`/bookings/${BOOKING}`);
  await expect(page.getByText("Allowed without payment", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Expires in/)).toHaveCount(0);
  await page.goto("/bookings");
  await page.getByRole("checkbox", { name: "Expand All" }).first().check();
  const row = page.locator(`[data-booking-id="${BOOKING}"]`).filter({ visible: true }).first();
  await expect(row).toContainText("Partial Example");
  await expect(row).not.toContainText("Expires in");
});
