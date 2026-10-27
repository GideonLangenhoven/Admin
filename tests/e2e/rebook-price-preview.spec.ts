import { test, expect } from "@playwright/test";

// M1: the Rebook dialog shows the server's own pricing of the move, including
// what is kept from the booking's agreed price, and lets the operator choose
// to reprice at the new departure's list price instead.
const BOOKING = "10000000-0000-4000-8000-000000000020"; // PAID, 3 guests
const NEW_SLOT = "10000000-0000-4000-8000-000000000007"; // Harbour paddle 16:00
const FIXTURE = "http://127.0.0.1:3191";
const kept = { ok: true, preview: true, list_unit_price: 120, new_qty: 3, extras_total: 0, carried: -60, carried_reason: "Loyal guest", new_total: 300, credit: 300, diff: 0 };
const repriced = { ...kept, carried: 0, carried_reason: null, new_total: 360, diff: 60 };

test.use({ viewport: { width: 662, height: 555 } });

test("the Rebook dialog previews the server's price and sends an explicit reprice", async ({ page, request }) => {
  await request.post(`${FIXTURE}/__fixture/reset`);
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
  await page.routeWebSocket(/realtime/, () => {});
  const calls: Record<string, unknown>[] = [];
  await page.route("**/*", route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/functions/v1/rebook-booking") {
      const body = req.postDataJSON();
      calls.push(body);
      return route.fulfill({ json: body.preview ? (body.reprice ? repriced : kept) : { ok: true, action: "RESCHEDULE", diff: 60, payment_url: "https://pay.invalid/x" } });
    }
    return route.continue();
  });

  await page.goto("/bookings");
  await page.getByRole("button", { name: /view guests/i }).first().click();
  await page.locator(`[data-booking-id="${BOOKING}"]`).filter({ visible: true }).first().getByRole("button", { name: "Guest actions", exact: true }).click();
  await page.locator("[data-mobile-action-sheet]").getByRole("button", { name: /^Rebook/ }).click();
  await page.getByLabel("Available slots").selectOption(NEW_SLOT);

  const preview = page.getByLabel("Price preview");
  await expect(preview).toContainText(/New departure \(3 × R120[.,]00\)\s*R360[.,]00/);
  await expect(preview).toContainText(/Kept from this booking: Loyal guest\s*-R60[.,]00/);
  await expect(preview).toContainText(/Difference\s*R0[.,]00/);

  await page.getByLabel(/Charge the new departure's list price/).check();
  await expect(preview).toContainText(/Customer pays\s*R60[.,]00/);
  await expect(page.getByText(/A payment link for R60[.,]00 will be sent/)).toBeVisible();
  await page.getByRole("button", { name: "Rebook", exact: true }).click();

  await expect.poll(() => calls.length).toBe(3);
  expect(calls).toEqual([
    { booking_id: BOOKING, action: "RESCHEDULE", new_slot_id: NEW_SLOT, preview: true, reprice: false },
    { booking_id: BOOKING, action: "RESCHEDULE", new_slot_id: NEW_SLOT, preview: true, reprice: true },
    { booking_id: BOOKING, action: "RESCHEDULE", new_slot_id: NEW_SLOT, reprice: true },
  ]);
});
