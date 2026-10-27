import { test, expect } from "@playwright/test";
import { DEFAULT_DASHBOARD_LAYOUT } from "../../app/lib/dashboard-layout";

const routes = [
  "/", "/bookings", "/bookings/10000000-0000-4000-8000-000000000021", "/new-booking", "/slots", "/inbox",
  "/refunds", "/invoices", "/pricing", "/reports", "/reports?tab=financials", "/reports?tab=marketing",
  "/reports?tab=attendance", "/reports?tab=waivers", "/reviews", "/billing", "/photos", "/customers",
  "/marketing", "/marketing/contacts", "/marketing/templates", "/marketing/automations", "/marketing/promotions",
  "/vouchers", "/broadcasts", "/notifications", "/partnerships", "/ai-usage", "/settings", "/settings/ota",
  "/settings/chat-faq", "/settings/agent-connections", "/privacy/data-requests", "/super-admin", "/ota-drift",
  "/simple", "/simple/bookings", "/simple/calendar", "/simple/check-ins", "/simple/photos", "/simple/help",
];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
    localStorage.setItem("ck_admin_settings_perms", "{}");
  });
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname === "/api/dashboard-layout") return route.fulfill({ json: { layout: DEFAULT_DASHBOARD_LAYOUT, revision: 0 } });
    if (url.pathname === "/api/billing/subscription") return route.fulfill({ json: {
      subscription: { id: "synthetic", status: "ACTIVE", seats_purchased: 3, billing_cycle_start: "2026-10-01", billing_cycle_end: "2026-11-01", plans: { name: "Operator", monthly_price_zar: 500, extra_seat_price_zar: 50, included_seats: 3 } },
      used_seats: 2, monthly_total_zar: 500,
    } });
    if (url.pathname === "/api/billing/history") return route.fulfill({ json: { line_items: [{ id: "synthetic", invoice_period_start: "2026-10-01", line_type: "SUBSCRIPTION", quantity: 1, total_amount_zar: 500, billing_status: "PAID" }] } });
    const table = url.pathname.split("/").pop()!;
    const rows: Record<string, object[]> = {
      customers: [{ id: "synthetic", name: "A very long customer name for a small phone display", email: "averylongcustomeremailaddress@example.invalid", phone: "+27825550123", total_bookings: 12, total_spent: 12000, last_booking_at: "2026-10-15T08:00:00Z", marketing_consent: true }],
      marketing_contacts: [{ id: "synthetic", email: "averylongcustomeremailaddress@example.invalid", first_name: "Long customer", last_name: "Example", phone: "+27825550123", date_of_birth: "1990-01-15", tags: ["Returning customer"], total_received: 12, total_opens: 7, total_clicks: 3, status: "active" }],
      marketing_campaigns: [{ id: "synthetic", name: "October returning guest campaign", status: "done", total_recipients: 120, total_sent: 120, total_failed: 0, total_opens: 80, total_clicks: 40, total_unsubscribes: 0, created_at: "2026-10-01T08:00:00Z" }],
      marketing_automations: [{ id: "synthetic", name: "Welcome returning guests", trigger_type: "tag_added", trigger_config: { tag: "Returning customer" }, status: "draft", revision: 1, enrolled_count: 120, completed_count: 80, created_at: "2026-10-01T08:00:00Z", description: "A long automation description for narrow screens" }],
      promotions: [{ id: "synthetic", code: "OCTOBER-RETURNING-GUESTS", description: "Returning guest discount", discount_type: "PERCENT", discount_value: 10, valid_from: "2026-10-01", valid_until: "2026-11-01", used_count: 12, max_uses: 100, active: true }],
      llm_usage: [{ fn: "web-chat", prompt_tokens: 1200, completion_tokens: 200, created_at: "2026-10-15T05:00:00Z" }],
    };
    if (url.pathname.startsWith("/rest/v1/") && rows[table]) return route.fulfill({ json: rows[table], headers: { "content-range": "0-0/1" } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Disabled in synthetic preview" } });
    return route.continue();
  });
});

test("expanded settings and dashboard editing fit a narrow phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  for (const toggle of await page.locator('main .ui-card > button[aria-expanded="false"]').all()) await toggle.click();
  await page.waitForLoadState("networkidle");
  const clipped = await page.locator('main [id$="-content"]').evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ id: el.id, overflow: el.scrollWidth - el.clientWidth })));
  expect(clipped, "settings content must fit inside its panels").toEqual([]);
  expect(await page.locator("main").first().evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arrange dashboard" })).toBeVisible();
  expect(await page.locator("main").first().evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("editor-320.png"), animations: "disabled" });
});

test("week and month calendars stay within the phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/slots");
  await page.getByRole("button", { name: "Oct 15, 2026", exact: true }).click();
  const dateCalendar = page.locator(".rdp-root");
  await expect(dateCalendar).toBeVisible();
  const calendarBounds = await dateCalendar.boundingBox();
  expect(calendarBounds!.x).toBeGreaterThanOrEqual(0);
  expect(calendarBounds!.x + calendarBounds!.width).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  expect(await page.locator("main").first().evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Month", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Confirmed bookings month view", exact: true });
  await expect(dialog).toBeVisible();
  for (const panel of await dialog.locator(":scope > .ui-card").all()) expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "Full screen", exact: true }).click();
  const full = page.getByRole("dialog", { name: "Bookings month view", exact: true });
  await expect(full).toBeVisible();
  expect(await full.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await full.locator(".overflow-auto").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("calendar-320.png"), animations: "disabled" });
});

for (const route of routes) test(`${route} fits the screen`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.locator(".ui-skeleton").first()).not.toBeVisible();
  if (route === "/") await expect(page.locator('[data-dashboard-tile="manifest"]')).toBeVisible();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.locator("main").first().evaluate(el => el.scrollWidth - el.clientWidth), { message: `${route} layout must settle within ${width}px` }).toBeLessThanOrEqual(1);
    const overflow = await page.locator("main").first().evaluate(el => {
      const right = el.getBoundingClientRect().right;
      return { width: el.scrollWidth - el.clientWidth, elements: [...el.querySelectorAll<HTMLElement>("*")].filter(child => child.getBoundingClientRect().right > right + 1 && child.getBoundingClientRect().width > 0).slice(0, 8).map(child => ({ tag: child.tagName, class: child.className, text: child.textContent?.slice(0, 50) })) };
    });
    expect(overflow.width, `${route} main overflow at ${width}px: ${JSON.stringify(overflow.elements)}`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth), `${route} page overflow at ${width}px`).toBeLessThanOrEqual(1);
    for (const table of await page.locator(".ui-table-container").all()) expect(await table.evaluate(el => el.scrollWidth - el.clientWidth), `${route} table overflow at ${width}px`).toBeLessThanOrEqual(1);
    if (width < 768) {
      const smallButtons = await page.locator(".ui-responsive-table button:visible").evaluateAll(buttons => buttons.filter(button => { const rect = button.getBoundingClientRect(); return rect.width < 44 || rect.height < 44; }).map(button => button.getAttribute("title") || button.textContent));
      expect(smallButtons, `${route} table buttons must remain easy to tap`).toEqual([]);
    }
    if (width === 390 && ["/", "/marketing/contacts", "/pricing", "/privacy/data-requests"].includes(route)) {
      await page.screenshot({ path: testInfo.outputPath("mobile.png"), animations: "disabled" });
      if (route === "/") await page.locator('[data-dashboard-tile="manifest"]').screenshot({ path: testInfo.outputPath("manifest-mobile.png"), animations: "disabled" });
      if (route === "/marketing/contacts") await page.locator(".ui-responsive-table").screenshot({ path: testInfo.outputPath("contacts-mobile.png"), animations: "disabled" });
    }
  }
});
