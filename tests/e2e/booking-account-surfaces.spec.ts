import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { businessId } from "../helpers/booking-guest-fixture.cjs";

const output = "docs/production-readiness/evidence/booking-account-surfaces-20261019";
const email = "guest@example.invalid";
const user = { id: "90000000-0000-4000-8000-000000000001", email, aud: "authenticated", role: "authenticated" };
const trips = [
  { id: "10000000-0000-4000-8000-000000000010", status: "CANCELLED", refund_status: "ACTION_REQUIRED", refund_amount: 600, cancellation_reason: "WEATHER", date: "2026-10-20T06:30:00Z" },
  { id: "10000000-0000-4000-8000-000000000011", status: "COMPLETED", date: "2026-10-01T07:00:00Z" },
  { id: "10000000-0000-4000-8000-000000000012", status: "CANCELLED", refund_status: "REFUNDED", date: "2026-09-30T07:00:00Z" },
].map(trip => ({ ...trip, business_id: businessId, tour_id: "20000000-0000-4000-8000-000000000001", slot_id: trip.id,
  customer_name: "Example Guest", email, phone: "27825550100", qty: 1, unit_price: 600, total_amount: 600,
  created_at: "2026-09-01T09:00:00Z", tours: { name: "Morning Kayak", duration_minutes: 90 },
  slots: { start_time: trip.date, capacity_total: 10, booked: 1, held: 0 } }));

for (const width of [390, 1440]) {
  test(`white booking account panels at ${width}px`, async ({ page, request }) => {
    mkdirSync(output, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await request.post("http://127.0.0.1:3117/__fixture/reset", { data: { theme: { business_name: "Kayak", color_bg: "#101a16", color_nav: "#101a16", color_main: "#125e40" } } });
    const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"), Buffer.from(JSON.stringify({ sub: user.id, exp: 2200000000, role: "authenticated" })).toString("base64url"), "fixture"].join(".");
    await page.addInitScript(session => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      localStorage.setItem("ck_cookie_consent", "all");
    }, { access_token: token, refresh_token: "fixture", expires_at: 2200000000, expires_in: 3600, token_type: "bearer", user });
    await page.route("**/functions/v1/my-bookings-lookup", route => route.fulfill({ json: { success: true, bookings: trips } }));
    await page.route("**/rest/v1/customers?**", route => route.fulfill({ json: { id: user.id, email, name: "Example Guest", phone: "27825550100", total_bookings: 3, total_spent: 1800, marketing_consent: false, created_at: "2026-09-01T00:00:00Z" } }));
    await page.goto("/my-bookings");
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Profile & settings" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Book a trip", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(page.getByText("Needs your attention", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Voucher balance" })).toBeVisible();
    for (const panel of await page.locator(".customer-bookings .glass").all()) {
      await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(panel).toHaveCSS("backdrop-filter", "none");
    }
    await expect(page.locator(".booking-credit-panel")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const cookieOk = page.getByRole("button", { name: "OK", exact: true });
    if (await cookieOk.isVisible()) await cookieOk.click();
    await page.screenshot({ path: `${output}/trips-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`white sign-in confirmation panel at ${width}px`, async ({ page, request }) => {
    mkdirSync(output, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await request.post("http://127.0.0.1:3117/__fixture/reset", { data: { theme: { business_name: "Kayak", color_bg: "#101a16", color_nav: "#101a16" } } });
    await page.route("**/auth/v1/otp", route => route.fulfill({ json: {} }));
    await page.goto("/my-bookings");
    await page.getByPlaceholder("your@email.com").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText("Check your email", { exact: true })).toBeVisible();
    await expect(page.locator(".customer-bookings .glass-sheet")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator(".customer-bookings .glass-sheet")).toHaveCSS("color", "rgb(11, 18, 32)");
    for (const chip of await page.locator(".customer-bookings .glass-chip").all()) await expect(chip).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const cookieOk = page.getByRole("button", { name: "OK", exact: true });
    if (await cookieOk.isVisible()) await cookieOk.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${output}/sign-in-${width}.png`, fullPage: true });
  });
}
