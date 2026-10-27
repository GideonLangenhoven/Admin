import { test, expect } from "@playwright/test";

// P2 Activity Timeline: every email and WhatsApp message sent for a booking
// shows its type, recipient and provider id.
const BOOKING = "10000000-0000-4000-8000-000000000021";
const FIXTURE = "http://127.0.0.1:3191";
const SENT = [
  { id: "l1", event: "email_sent", payload: { type: "BOOKING_UPDATED", to: "guest21@example.invalid", provider_id: "re_123" }, created_at: "2026-10-15T06:00:00Z" },
  { id: "l2", event: "whatsapp_sent", payload: { type: "booking_reminder", to: "27821234567", provider_id: "wamid.TEMPLATE" }, created_at: "2026-10-15T07:00:00Z" },
  { id: "l3", event: "whatsapp_sent", payload: { type: "text", to: "27821234567", provider_id: "wamid.TEXT" }, created_at: "2026-10-15T08:00:00Z" },
];

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

test("sent emails and WhatsApp messages appear on the booking timeline", async ({ page }) => {
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
    if (url.pathname === "/rest/v1/logs") return route.fulfill({ json: SENT });
    return route.continue();
  });
  await page.goto(`/bookings/${BOOKING}`);
  const timeline = page.locator("main");
  await expect(timeline.getByText("Email sent: Booking updated", { exact: true })).toBeVisible();
  await expect(timeline.getByText("To: guest21@example.invalid | Provider ID: re_123", { exact: true })).toBeVisible();
  await expect(timeline.getByText("WhatsApp sent: Booking reminder", { exact: true })).toBeVisible();
  await expect(timeline.getByText("WhatsApp sent", { exact: true })).toBeVisible();
  await expect(timeline.getByText("To: 27821234567 | Provider ID: wamid.TEXT", { exact: true })).toBeVisible();
});
