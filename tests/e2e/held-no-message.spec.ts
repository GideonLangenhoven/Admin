import { test, expect, type Page } from "@playwright/test";

// P2: editing a booking made with "Hold places, no immediate message" emailed
// the guest "Booking Updated", the first they heard of the booking.
const BOOKING = "10000000-0000-4000-8000-000000000021"; // admin booking, 2 guests
const FIXTURE = "http://127.0.0.1:3191";

test.use({ viewport: { width: 662, height: 555 } });

test.beforeEach(async ({ page, request }) => {
  await request.post(`${FIXTURE}/__fixture/reset`);
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
  await page.routeWebSocket(/realtime/, () => {});
});

// Serves the booking as held (with or without a payment link), renames the
// guest and returns the emails sent.
async function renameHeldBooking(page: Page, paymentUrl: string | null) {
  const emails: string[] = [];
  const seen: { title?: string; tone?: string }[] = [];
  page.on("console", async msg => {
    if (msg.type() === "warning" && msg.text().startsWith("App notification emitted")) seen.push(await msg.args()[1].jsonValue());
  });
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/functions/v1/send-email") { emails.push(req.postDataJSON().type); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname === "/rest/v1/bookings" && req.method() === "PATCH") return route.fulfill({ status: 204 });
    if (url.pathname === "/rest/v1/rpc/list_operator_bookings") {
      const res = await route.fetch();
      const rows = await res.json();
      const held = (b: { id: string }) => b.id === BOOKING ? { ...b, status: "HELD", payment_url: paymentUrl } : b;
      return route.fulfill({ response: res, json: Array.isArray(rows) ? rows.map(held) : rows && held(rows) });
    }
    return route.continue();
  });
  await page.goto("/bookings");
  await page.getByRole("button", { name: /view guests/i }).first().click();
  const row = page.locator(`[data-booking-id="${BOOKING}"]`).filter({ visible: true }).first();
  await row.getByRole("button", { name: "Guest actions", exact: true }).click();
  await page.locator("[data-mobile-action-sheet]").getByRole("button", { name: /^Edit booking/ }).click();
  const dialog = page.getByRole("heading", { name: "Edit Booking" }).locator("..");
  await dialog.getByLabel("Name").fill("Renamed guest");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => seen.find(n => n.title === "Booking updated")).toMatchObject({ tone: "success" });
  return emails;
}

test("editing a held booking the guest was never told about sends no email", async ({ page }) => {
  expect(await renameHeldBooking(page, null)).toEqual([]);
});

test("once the guest has a payment link, an edit tells them", async ({ page }) => {
  expect(await renameHeldBooking(page, "https://pay.example.invalid/held")).toEqual(["BOOKING_UPDATED"]);
});
