import { expect, test } from "@playwright/test";
import { fixtureNow, slots, tourId, tours } from "../helpers/booking-guest-fixture.cjs";

// P2 booking site (mobile) polish.
const fixtureUrl = "http://127.0.0.1:3117";
const book = `/book?tour=${tourId}&slot=${slots[0].id}&date=2026-10-03`;
const draft = (id: string, name: string) => JSON.stringify({
  tourId: id, tourName: name, date: "2026-10-03", slotId: slots[0].id, slotTime: "10:00", qty: 1,
  customerName: "", customerEmail: "", customerPhone: "", customerDialCode: "+27", marketingConsent: false,
  promoCode: "", voucherCode: "", addOns: [], step: 1, savedAt: Date.parse(fixtureNow), tenantSlug: "127",
});

test.beforeEach(async ({ page, request }) => {
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: {} });
  await page.clock.install({ time: new Date(fixtureNow) });
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.addInitScript(() => localStorage.setItem("cookie-consent-accepted", "true"));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

test("on phones the chat launcher stays off the booking flow's prices", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
  await page.goto(book);
  await expect(page.locator('[data-mobile-booking-bar="calendar"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Open chat" })).toBeHidden();
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
});

test("Pay names the missing field instead of sitting disabled", async ({ page }) => {
  await page.goto(book);
  await page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true }).click();
  await page.locator("#book-name").fill("Ana Guest");
  await page.locator("#book-email").fill("ana@example.invalid");
  await page.locator("#book-terms").check();
  const pay = page.locator('[data-shot="pay-button"]');
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(page.getByText("Please enter your phone number.")).toBeVisible();
  await expect(page.locator("#book-phone")).toBeFocused();
});

test("the resume banner skips a tour that is no longer on sale", async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem("bt-booking-draft-v1", value), draft("20000000-0000-4000-8000-000000000099", "Withdrawn tour"));
  await page.goto("/");
  await expect(page.locator('[data-shot="tour-card"]').first()).toBeVisible();
  await expect(page.getByText("Pick up where you left off?")).toBeHidden();
});

test("the resume banner still offers a tour on sale", async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem("bt-booking-draft-v1", value), draft(tourId, tours[0].name));
  await page.goto("/");
  await expect(page.getByText("Pick up where you left off?")).toBeVisible();
});

test("a tour card shows its last-minute price as a from price", async ({ page }) => {
  await page.route(/\/rest\/v1\/slots\?.*last_minute_at/, route => route.fulfill({ json: [{
    id: slots[0].id, tour_id: tourId, start_time: "2026-10-03T14:00:00Z", price_per_person_override: 450,
    capacity_total: 10, booked: 2, held: 1,
    tours: { name: tours[0].name, base_price_per_person: tours[0].base_price_per_person, hidden: false, active: true },
  }] }));
  await page.goto("/");
  const card = page.locator('[data-shot="tour-card"]').filter({ hasText: tours[0].name });
  await expect(card.getByText("from", { exact: true })).toBeVisible();
  await expect(card.locator(".line-through")).toHaveText(`R${tours[0].base_price_per_person}`);
  await expect(card).toContainText("R450");
  await expect(page.locator('[data-shot="tour-card"]').filter({ hasText: tours[1].name }).getByText("from", { exact: true })).toHaveCount(0);
});

test("cancelling a gift voucher payment offers to resume it in voucher words", async ({ page }) => {
  const yoco = "https://c.yoco.com/checkout/fixture-voucher";
  await page.route("**/rest/v1/vouchers*", route => route.request().method() === "POST"
    ? route.fulfill({ json: { id: "40000000-0000-4000-8000-000000000001" } })
    : route.fallback());
  await page.route("**/functions/v1/create-checkout", route => route.fulfill({ json: { redirectUrl: yoco } }));
  await page.goto("/voucher");
  await page.locator("#custom-amount").fill("500");
  await page.getByRole("button", { name: "Continue: R500" }).click();
  await page.locator("#voucher-recipient").fill("Sam Friend");
  await page.locator("#voucher-buyer-name").fill("Ana Guest");
  await page.locator("#voucher-buyer-email").fill("ana@example.invalid");
  await page.getByRole("button", { name: "Purchase Voucher: R500" }).click();
  await expect(page.locator(`a[href="${yoco}"]`)).toBeVisible();

  await page.goto("/cancelled"); // where Yoco sends a buyer who backs out
  await expect(page.getByRole("link", { name: "Resume payment" })).toHaveAttribute("href", yoco);
  await expect(page.getByRole("link", { name: "Back to gift vouchers" })).toHaveAttribute("href", "/voucher");
  await expect(page.getByText(/places are held/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Browse departures" })).toHaveCount(0);
});
