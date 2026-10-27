import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_DASHBOARD_LAYOUT } from "../../app/lib/dashboard-layout";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const SLOT_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_SLOT_ID = "55555555-5555-4555-8555-555555555555";
const TOUR_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_TOUR_ID = "77777777-7777-4777-8777-777777777777";

function base64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const user = {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "operator@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  return {
    access_token: `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({ aud: "authenticated", exp: expiresAt, sub: USER_ID, email: user.email, role: "authenticated" })}.mock-signature`,
    refresh_token: "mock-refresh-token",
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: "bearer",
    user,
  };
}

function rangeStart(url: URL, body?: Record<string, unknown>) {
  const filter = url.searchParams.get("start_time") || "";
  if (filter.startsWith("gte.")) return filter.slice(4);
  return typeof body?.p_range_start === "string" ? body.p_range_start : new Date().toISOString();
}

function dayFixtures(startIso: string) {
  const start = new Date(startIso).getTime();
  const firstStart = new Date(start + 10 * 60 * 60 * 1000).toISOString();
  const secondStart = new Date(start + 15 * 60 * 60 * 1000).toISOString();
  const slots = [
    {
      id: SLOT_ID,
      tour_id: TOUR_ID,
      start_time: firstStart,
      capacity_total: 12,
      booked: 8,
      held: 0,
      status: "OPEN",
      tours: { name: "Atlantic Ocean Kayak Adventure with a deliberately long tour name" },
    },
    {
      id: SECOND_SLOT_ID,
      tour_id: SECOND_TOUR_ID,
      start_time: secondStart,
      capacity_total: 8,
      booked: 0,
      held: 0,
      status: "CLOSED",
      tours: { name: "Sunset Paddle" },
    },
  ];
  const available = [{
    ...slots[0],
    tour_name: slots[0].tours.name,
    price_per_person_override: null,
    base_price_per_person: 650,
    available_capacity: 4,
    last_minute_at: null,
  }];
  const bookings = [
    {
      id: "88888888-8888-4888-8888-888888888888",
      slot_id: SLOT_ID,
      customer_name: "Alexandra van der Merwe-Smith with a very long customer name",
      email: "alexandra@example.test",
      phone: "+27 82 555 0101",
      qty: 6,
      status: "CONFIRMED",
      waiver_status: "SIGNED",
      checked_in: false,
      checked_in_at: null,
      arrived_count: 4,
      total_amount: 3900,
      original_total: 3900,
      total_captured: 3900,
      total_refunded: 0,
      refund_amount: 0,
      refund_processed_at: null,
      voucher_amount_paid: 0,
      voucher_code: null,
      payment_method: "Card (terminal)",
      yoco_payment_id: null,
      payfast_m_payment_id: null,
      ota_channel: null,
      allow_unpaid: false,
    },
    {
      id: "99999999-9999-4999-8999-999999999999",
      slot_id: SLOT_ID,
      customer_name: "Sam Ndlovu",
      email: "sam@example.test",
      phone: "+27 82 555 0102",
      qty: 2,
      status: "PENDING",
      waiver_status: "SIGNED",
      checked_in: false,
      checked_in_at: null,
      arrived_count: 0,
      total_amount: 1300,
      original_total: 1300,
      total_captured: 0,
      total_refunded: 0,
      refund_amount: 0,
      refund_processed_at: null,
      voucher_amount_paid: 0,
      voucher_code: null,
      payment_method: null,
      yoco_payment_id: null,
      payfast_m_payment_id: null,
      ota_channel: null,
      allow_unpaid: false,
    },
  ];
  return { slots, available, bookings };
}

async function fulfillJson(route: Route, body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": route.request().headers().origin || "http://127.0.0.1:3000",
      "access-control-allow-headers": "authorization, apikey, content-profile, x-client-info",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function installMockBackend(page: Page, state: "populated" | "empty" | "error" = "populated", staffName: string | null = "Taylor Operator", readOnly = false, role = "ADMIN", permissions: Record<string, boolean> = {}) {
  const session = fakeSession();
  const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fixture.supabase.co").hostname.split(".")[0];
  const baseURL = String(test.info().project.use.baseURL || "http://127.0.0.1:3000");

  await page.context().addCookies([
    { name: "ck_session_hint", value: "1", url: baseURL },
    { name: "ck_admin_role", value: role, url: baseURL },
  ]);
  await page.addInitScript(({ storageKey, storedSession }) => {
    localStorage.setItem(storageKey, JSON.stringify(storedSession));
    localStorage.setItem("ck_admin_auth", "true");
    localStorage.setItem("ck_admin_email", "operator@example.test");
    localStorage.setItem("ck_admin_role", "ADMIN");
    localStorage.setItem("ck_admin_business_id", "11111111-1111-4111-8111-111111111111");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_admin_time", String(Date.now()));
    localStorage.setItem("ck_admin_name", "Previous Staff");
    localStorage.setItem("ck_admin_settings_perms", "{}");
    localStorage.setItem("ck_welcome_done", "1");
  }, { storageKey: `sb-${projectRef}-auth-token`, storedSession: session });

  await page.routeWebSocket(/supabase|realtime/i, () => {});
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === new URL(baseURL).origin || url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      // A visual fixture must never reach a real server-side mutation.
      if (url.pathname === "/api/admin/login") {
        await fulfillJson(route, { auth_ready: true, admin: { id: ADMIN_ID, role, business_id: BUSINESS_ID, name: staffName, email: "operator@example.test", read_only: readOnly } });
        return;
      }
      if (url.pathname === "/api/dashboard-layout") {
        await fulfillJson(route, { layout: DEFAULT_DASHBOARD_LAYOUT, revision: 0 });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await fulfillJson(route, { error: "API calls are disabled in this visual fixture" }, 403);
        return;
      }
      await route.continue();
      return;
    }
    if (request.method() === "OPTIONS") {
      await fulfillJson(route, null, 204);
      return;
    }
    if (url.pathname.includes("/auth/v1/user")) {
      await fulfillJson(route, session.user);
      return;
    }
    if (url.pathname.includes("/auth/v1/token")) {
      await fulfillJson(route, session);
      return;
    }
    if (url.pathname.endsWith("/rest/v1/admin_users")) {
      await fulfillJson(route, { id: ADMIN_ID, role, business_id: BUSINESS_ID, name: staffName, settings_permissions: permissions, suspended: false, read_only: readOnly });
      return;
    }
    if (url.pathname.endsWith("/rest/v1/businesses")) {
      if (url.searchParams.get("select") === "currency") {
        await fulfillJson(route, { currency: "ZAR" });
      } else if (url.searchParams.get("select")?.includes("booking_custom_fields")) {
        await fulfillJson(route, { booking_custom_fields: [], meeting_point: "Harbour meeting point" });
      } else {
        await fulfillJson(route, [{ id: BUSINESS_ID, name: "Cape Kayak Co.", business_name: "Cape Kayak Co.", logo_url: null, timezone: "Africa/Johannesburg", subscription_status: "ACTIVE", yoco_test_mode: false, subdomain: "cape-kayak" }], 200, { "content-range": "0-0/1" });
      }
      return;
    }
    if (url.pathname.endsWith("/rest/v1/rpc/get_operator_dashboard")) {
      const body = request.postDataJSON();
      const today = dayFixtures(body.p_today_start);
      const tomorrow = dayFixtures(body.p_tomorrow_start);
      const manifest = (day: ReturnType<typeof dayFixtures>) => [...day.bookings.map((b) => ({ ...b,
        slots: { start_time: day.slots[0].start_time }, tours: day.slots[0].tours,
        custom_fields: { notes: "Please keep this customer note" }, add_ons: [{ name: "WaterproofBagWithAnUnbrokenLongProductName", qty: 2 }],
      })), { ...day.bookings[1], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slots: { start_time: day.slots[1].start_time }, tours: day.slots[1].tours, customer_name: "UnbrokenCustomerName".repeat(8) }];
      await fulfillJson(route, { business_id: BUSINESS_ID, today_manifest: state === "empty" ? [] : manifest(today), tomorrow_manifest: state === "empty" ? [] : manifest(tomorrow), refund_count: 2, refund_total: 12345, inbox_count: 3, photos_outstanding: 7, revenue: { today: 3900, week: 10400, month: 22400, series: [0,3900,1300] }, weather_widget_locations: [] });
      return;
    }
    if (url.pathname.endsWith("/rest/v1/slots")) {
      if (state === "error") {
        await fulfillJson(route, { message: "Fixture connection unavailable" }, 503);
        return;
      }
      if (state === "empty") {
        await fulfillJson(route, []);
        return;
      }
      await fulfillJson(route, dayFixtures(rangeStart(url)).slots, 200, { "content-range": "0-1/2" });
      return;
    }
    if (url.pathname.endsWith("/rest/v1/rpc/operator_departure_manifest")) {
      if (state === "error") {
        await fulfillJson(route, { message: "Fixture connection unavailable" }, 503);
        return;
      }
      await fulfillJson(route, state === "empty" ? [] : dayFixtures(rangeStart(url, request.postDataJSON())).bookings);
      return;
    }
    if (url.pathname.endsWith("/rest/v1/bookings")) {
      if (url.searchParams.has("payment_failed_at")) { await fulfillJson(route, []); return; }
      await fulfillJson(route, dayFixtures(new Date().toISOString()).bookings, 200, { "content-range": "0-1/2" });
      return;
    }
    if (url.pathname.endsWith("/rest/v1/rpc/list_available_slots")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, dayFixtures(rangeStart(url, body)).available);
      return;
    }
    if (url.pathname.endsWith("/rest/v1/tours")) {
      await fulfillJson(route, [{ id: TOUR_ID, business_id: BUSINESS_ID, name: "Atlantic Ocean Kayak Adventure", base_price_per_person: 650 }]);
      return;
    }
    await fulfillJson(route, []);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clipped: Array.from(document.querySelectorAll(".sv-main, .sv-content, .sv-filters, .sv-date-filter, .sv-date-filter > label, .sv-date-filter input, .sv-readiness > div, .sv-count-control"))
      .filter(element => element.scrollWidth > element.clientWidth + 1)
      .map(element => ({ element: element.className || element.tagName, width: element.clientWidth, scrollWidth: element.scrollWidth })),
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.clipped).toEqual([]);
}

async function resetScroll(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  });
}

test.describe("Simple view mocked responsive acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
  });

  test("simple roll call follows the dashboard's next departures and preserves the full calendar", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.clock.install({ time: new Date("2026-10-20T07:58:00Z") });
    await page.clock.pauseAt(new Date("2026-10-20T07:59:00Z"));
    await installMockBackend(page);
    const fixture = dayFixtures("2026-10-19T22:00:00Z");
    const slots = [
      { ...fixture.slots[0], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", start_time: "2026-10-20T05:00:00Z", tours: { name: "Earlier trip" } },
      fixture.slots[0],
      { ...fixture.slots[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tours: { name: "Simultaneous trip" } },
      fixture.slots[1],
    ];
    const bookings = slots.map((slot, index) => ({ ...fixture.bookings[0], id: `guest-${index}`, slot_id: slot.id, customer_name: `Guest ${index}` }));
    await page.route("**/rest/v1/slots?*", route => fulfillJson(route, slots, 200, { "content-range": "0-3/4" }));
    await page.route("**/rest/v1/rpc/operator_departure_manifest", route => fulfillJson(route, bookings));
    await page.goto("/simple", { waitUntil: "domcontentloaded" });
    const cards = page.locator(".sv-departure");
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveAttribute("data-slot-id", SLOT_ID);
    await expect(page.getByText("Departure 1 of 2", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous departure", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Next departure", exact: true }).click();
    await expect(cards).toHaveAttribute("data-slot-id", slots[2].id);
    await expect(page.getByRole("button", { name: "Next departure", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Previous departure", exact: true }).click();
    await expect(cards).toHaveAttribute("data-slot-id", SLOT_ID);
    for (const width of [320, 820, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`simple-next-departure-${width}.png`), fullPage: true });
    }
    await page.clock.fastForward(4 * 60_000);
    await expect(cards).toHaveAttribute("data-slot-id", SLOT_ID);
    await page.clock.fastForward(2 * 60_000);
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveAttribute("data-slot-id", SECOND_SLOT_ID);
    await expect(page.getByRole("navigation", { name: "Departures", exact: true })).toHaveCount(0);
    await page.clock.fastForward(5 * 60 * 60_000);
    await expect(cards).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No more booked departures today", exact: true })).toBeVisible();
    await page.goto("/simple/calendar");
    await expect(cards).toHaveCount(4);
  });

  test("simple payment recovery sits below the heading and uses the dashboard controls and actions", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await installMockBackend(page);
    const rows = ["today", "tomorrow"].map((day, index) => ({
      id: `recovery-${day}`, customer_name: `Recovery ${day}`, email: `${day}@example.test`, phone: "082 555 0101",
      status: "CONFIRMED", total_amount: 100, total_captured: 0, amount_due: 100, payment_url: "https://checkout.yoco.com/fixture",
      payment_status: null, created_at: "2026-10-19T08:00:00Z", payment_failed_at: null, payment_failure_reason: null,
      payment_recovery_emailed_at: null as string | null, slot_id: SLOT_ID, departure_at: `2026-10-${20 + index}T08:00:00Z`,
      tour_name: "Recovery paddle", departure_passed: false,
    }));
    const sends: unknown[] = [];
    await page.route("**/rest/v1/payment_recovery_bookings?*", async route => {
      const url = new URL(route.request().url());
      const start = url.searchParams.getAll("departure_at").find(value => value.startsWith("gte."))?.slice(4);
      const end = url.searchParams.getAll("departure_at").find(value => value.startsWith("lt."))?.slice(3);
      const result = rows.filter(row => !start || !end || (row.departure_at >= start && row.departure_at < end));
      await fulfillJson(route, route.request().method() === "HEAD" ? null : result, 200, { "content-range": `0-${result.length - 1}/${result.length}`, "access-control-expose-headers": "content-range" });
    });
    await page.route("**/functions/v1/auto-messages", async route => {
      const body = route.request().postDataJSON();
      sends.push(body);
      rows.find(row => row.id === body.booking_id)!.payment_recovery_emailed_at = "2026-10-20T04:00:00Z";
      await fulfillJson(route, { ok: true });
    });
    for (const path of ["/simple", "/"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const panel = page.getByRole("region", { name: "Payment recovery", exact: true });
      await expect(panel.getByRole("button", { name: "Today 1 booking", exact: true })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Tomorrow 1 booking", exact: true })).toBeVisible();
      await expect(panel.getByRole("listitem")).toHaveCount(0);
      await panel.getByRole("button", { name: "Tomorrow 1 booking", exact: true }).click();
      await expect(panel.getByText("tomorrow@example.test", { exact: true })).toBeVisible();
      await expect(panel.getByText("today@example.test", { exact: true })).toHaveCount(0);
      await expect(panel.getByRole("link", { name: "Phone Recovery tomorrow", exact: true })).toHaveAttribute("href", "tel:+27825550101");
      await panel.getByRole("button", { name: /^(Email payment link|Resend payment email)$/, exact: true }).click();
      await expect(panel.getByRole("button", { name: "Resend payment email", exact: true })).toBeEnabled();
      await panel.getByRole("button", { name: "All departure days", exact: true }).click();
      await expect(panel.getByRole("listitem")).toHaveCount(2);
      await panel.getByRole("button", { name: "Close list", exact: true }).click();
      await expect(panel.getByRole("listitem")).toHaveCount(0);
      if (path === "/simple") {
        expect(await panel.evaluate(element => element.previousElementSibling?.matches("header.sv-intro"))).toBe(true);
        expect(await panel.evaluate(element => element.nextElementSibling?.getAttribute("aria-label"))).toBe("Choose day");
        for (const width of [320, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          await expectNoHorizontalOverflow(page);
          await page.screenshot({ path: testInfo.outputPath(`simple-recovery-${width}.png`), fullPage: true });
        }
      }
    }
    expect(sends).toEqual([1, 2].map(() => ({ action: "payment_recovery_email", business_id: BUSINESS_ID, booking_id: "recovery-tomorrow" })));
  });

  test("keeps arrival counts beside each name and an edit pencil beside the guest count", async ({ page }, testInfo) => {
    await installMockBackend(page);
    const booking = dayFixtures(new Date().toISOString()).bookings[0];
    const name = booking.customer_name;
    for (const path of ["/simple", "/simple/calendar"]) {
      await page.goto(`${path}?date=2026-10-20`);
      const row = page.locator(".sv-booking-row").filter({ hasText: name });
      const edit = row.getByRole("link", { name: `Edit arrivals for ${name}: 4 of 6 arrived`, exact: true });
      await expect(edit.locator("svg")).toBeVisible();
      await expect(row.locator(".sv-arrival-pill")).toHaveText("4/6");
      await expect(edit).toHaveAttribute("href", `/simple/check-ins?date=2026-10-20&slot=${SLOT_ID}#arrived-${booking.id}`);
      await expect(page.getByText("Edit arrival counts", { exact: true })).toHaveCount(0);
      for (const width of [320, 390, 820, 1180]) {
        await page.setViewportSize({ width, height: 1000 });
        await expectNoHorizontalOverflow(page);
        const guest = await edit.locator("..").locator("span").first().boundingBox();
        const link = await edit.boundingBox();
        expect(link!.x).toBeGreaterThan(guest!.x + guest!.width);
        expect(Math.abs((link!.y + link!.height / 2) - (guest!.y + guest!.height / 2))).toBeLessThanOrEqual(1);
        expect(link!.height).toBeGreaterThanOrEqual(44);
        await expect(row.locator(".sv-contact-detail, .sv-booking-summary")).toHaveCount(0);
        await expect(row.getByRole("link", { name: `Call ${name}`, exact: true })).toHaveCSS("font-size", "14px");
        if (path === "/simple") await row.screenshot({ path: testInfo.outputPath(`compact-arrivals-${width}.png`) });
      }
      await edit.click();
      await expect(page).toHaveURL(`/simple/check-ins?date=2026-10-20&slot=${SLOT_ID}`);
      const arrivals = page.locator(".sv-check-in").filter({ hasText: name });
      await expect(arrivals.getByLabel("Guests arrived", { exact: true })).toHaveValue("4");
    }
  });

  test("closes Add walk-in with X and preserves the return date and draft", async ({ page }, testInfo) => {
    await installMockBackend(page);
    const writes: string[] = [];
    page.on("request", request => {
      if (/create_operator_booking|\/api\/check-ins|\/functions\//.test(request.url())) writes.push(request.url());
    });
    for (const path of ["/simple?date=2026-10-20", "/simple/calendar?date=2026-10-21"]) {
      await page.goto(path);
      await page.locator(".sv-header").getByRole("link", { name: "Add walk-in", exact: true }).click();
      const close = page.getByRole("button", { name: "Close Add walk-in", exact: true });
      const name = page.getByLabel("Full Name", { exact: false });
      await expect(close).toBeVisible();
      await name.fill("Walk-in draft example");
      for (const width of [320, 390, 820, 1180]) {
        await page.setViewportSize({ width, height: 1000 });
        await expectNoHorizontalOverflow(page);
        const box = await close.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        if (width === 320) {
          await close.scrollIntoViewIfNeeded();
          await expect(close).toBeInViewport();
          await page.screenshot({ path: testInfo.outputPath("walk-in-close-320.png") });
        }
      }
      await close.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(path);
      await page.locator(".sv-header").getByRole("link", { name: "Add walk-in", exact: true }).click();
      await expect(name).toHaveValue("Walk-in draft example");
      await close.click();
      await expect(page).toHaveURL(path);
    }
    expect(writes).toEqual([]);
  });

  test.describe("touch layouts", () => {
    test.use({ hasTouch: true, locale: "en-ZA", viewport: { width: 320, height: 844 } });

    test.beforeEach(async ({ page, browserName }) => {
      // Desktop WebKit keeps maxTouchPoints at zero under touch emulation.
      // Supply the tablet capability used by the app's responsive routing.
      if (browserName === "webkit") {
        await page.addInitScript(() => Object.defineProperty(navigator, "maxTouchPoints", { value: 1 }));
      }
    });

    test("keeps walk-in fields and button labels inside the form", async ({ page }, testInfo) => {
      await installMockBackend(page);
      await page.goto("/simple/new-booking?date=2026-10-01&returnTo=%2Fsimple", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Add walk-in", exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Activity", exact: true })).toHaveAttribute("data-value", TOUR_ID);
      for (const width of [320, 640, 768, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        const clippedLabels = await page.locator(".sv-booking-form button > span").evaluateAll(labels => labels.flatMap(label => {
          const text = label.getBoundingClientRect();
          const button = label.parentElement!.getBoundingClientRect();
          return text.top < button.top - 1 || text.bottom > button.bottom + 1 || text.right > button.right + 1
            ? [label.textContent]
            : [];
        }));
        expect(clippedLabels, `Walk-in button labels at ${width}px`).toEqual([]);
        if (width === 320 || width === 768) {
          await page.getByRole("button", { name: "Review booking", exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath(`walk-in-${width}.png`), animations: "disabled" });
        }
      }
    });

    test("keeps date fields and action groups separated across phone and tablet widths", async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await page.clock.setFixedTime(new Date("2026-09-30T04:00:00Z"));
      await installMockBackend(page);
      await page.setViewportSize({ width: 320, height: 844 });
      for (const [path, heading] of [["/simple", "Roll call"], ["/simple/calendar", "Calendar"], ["/simple/check-ins", "Check-ins"]]) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        for (const width of [320, 390, 640, 768, 820, 1024, 1180, 1366]) {
          await page.setViewportSize({ width, height: width < 640 ? 844 : 900 });
          await test.step(`${path} at ${width}px`, async () => {
            await resetScroll(page);
            await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
            await expect(page.locator(".sv-departure, .sv-check-in").first()).toBeVisible();
            await expectNoHorizontalOverflow(page);

            const date = await page.getByLabel("Selected date").boundingBox();
            const previous = await page.getByRole("button", { name: "Previous day" }).boundingBox();
            const next = await page.getByRole("button", { name: "Next day" }).boundingBox();
            expect(date!.x - (previous!.x + previous!.width), `${path} at ${width}px: previous-day gap`).toBeGreaterThanOrEqual(8);
            expect(next!.x - (date!.x + date!.width), `${path} at ${width}px: next-day gap`).toBeGreaterThanOrEqual(8);
            expect(Math.abs(date!.height - next!.height), `${path} at ${width}px: date height`).toBeLessThanOrEqual(1);

            const overlaps = await page.evaluate(() => {
              const selectors = ".sv-header-inner, .sv-filters, .sv-departure-main, .sv-arrival-editor, .sv-payment-fields";
              return Array.from(document.querySelectorAll(selectors)).flatMap(group => {
                const controls = Array.from(group.querySelectorAll("a, button, input, select"))
                  .filter(element => element.getBoundingClientRect().width > 0);
                return controls.flatMap((control, index) => controls.slice(index + 1).flatMap(other => {
                  const a = control.getBoundingClientRect();
                  const b = other.getBoundingClientRect();
                  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
                    ? [{ group: group.className, first: control.getAttribute("aria-label") || control.textContent?.trim(), second: other.getAttribute("aria-label") || other.textContent?.trim() }]
                    : [];
                }));
              });
            });
            expect(overlaps, `${path} at ${width}px`).toEqual([]);
            if ((width === 320 || width === 820 || width === 1180) && path === "/simple/check-ins") {
              await page.screenshot({ path: testInfo.outputPath(`check-ins-${width}.png`), animations: "disabled" });
              await page.getByRole("button", { name: /Confirm R.*received/ }).scrollIntoViewIfNeeded();
              await page.screenshot({ path: testInfo.outputPath(`payment-${width}.png`), animations: "disabled" });
            }
          });
        }
      }
    });
  });

  test("keeps the selected day and check-in date controls usable on a phone", async ({ page }) => {
    test.setTimeout(180_000);
    await installMockBackend(page);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/simple", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Roll call", level: 1 })).toBeVisible();
    const initialDate = await page.getByLabel("Selected date").inputValue();
    const nextDate = new Date(initialDate + "T12:00:00Z");
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const selectedDate = nextDate.toISOString().slice(0, 10);
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page).toHaveURL(`/simple?date=${selectedDate}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Selected date")).toHaveValue(selectedDate);
    const bookUrl = new URL(await page.locator(".sv-header").getByRole("link", { name: "Add walk-in", exact: true }).getAttribute("href") || "", page.url());
    expect(bookUrl.searchParams.get("returnTo")).toBe(`/simple?date=${selectedDate}`);

    await page.goto(`/simple/check-ins?date=${selectedDate}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Check-ins" })).toBeVisible();
    const dateBox = await page.getByLabel("Selected date").boundingBox();
    const arrowBox = await page.getByRole("button", { name: "Next day" }).boundingBox();
    expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(arrowBox!.x);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/simple/calendar?date=${selectedDate}`, { waitUntil: "domcontentloaded" });
    const calendarDateBox = await page.getByLabel("Selected date").boundingBox();
    const calendarArrowBox = await page.getByRole("button", { name: "Next day" }).boundingBox();
    expect(calendarArrowBox!.x - (calendarDateBox!.x + calendarDateBox!.width)).toBeLessThanOrEqual(16);
  });

  test("renders Today, Calendar, and Check-ins safely across target devices", async ({ page }) => {
    test.setTimeout(180_000);
    await installMockBackend(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/simple");
    await expect(page.getByRole("heading", { name: "Roll call", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cape Kayak Co., Simple view" })).toBeVisible();
    await page.screenshot({ path: "/tmp/simple-view-phone-overview.png", fullPage: true });
    await expect(page.getByText("Next departure:", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Other departures available" })).toHaveCount(0);
    await expect(page.locator(".sv-departure").getByRole("link", { name: "Add walk-in", exact: true })).toHaveCount(0);
    await expect(page.getByText("2 bookings", { exact: true })).toBeVisible();
    await expect(page.getByText("4/6", { exact: true })).toBeVisible();
    await expect(page.getByText("Alexandra van der Merwe-Smith", { exact: false })).toBeVisible();
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const navigation = page.getByRole("navigation", { name: "Simple view" }).filter({ visible: true });
      if (width < 768) await expect(navigation).toHaveCount(0);
      else await expect(navigation.getByRole("link")).toHaveText(["Today"]);
      await expect(page.locator(".sv-mobile-nav")).toHaveCount(0);
      await expect(page.locator(".simple-view").getByRole("link", { name: "Bookings", exact: true })).toHaveCount(0);
      await expect(page.locator(".sv-header").getByRole("button", { name: /Switch to (light|dark) mode/ })).toHaveCount(0);
      await expect(page.locator(".sv-header").getByRole("link", { name: "Add walk-in", exact: true })).toBeVisible();
      await expect(page.locator(".sv-header").getByRole("link", { name: "Full dashboard", exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await resetScroll(page);
    await page.screenshot({ path: "/tmp/simple-view-phone.png", fullPage: true });

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".simple-view")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const tomorrow = await page.evaluate(() => {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + 86_400_000));
      const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${value.year}-${value.month}-${value.day}`;
    });
    await page.getByLabel("Selected date").fill(tomorrow);
    await expect(page).toHaveURL(`/simple?date=${tomorrow}`);
    await expect(page.getByText("Selected day ·", { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Selected date")).toHaveValue(tomorrow);
    const dayBookUrl = new URL(await page.locator(".sv-header").getByRole("link", { name: "Add walk-in", exact: true }).getAttribute("href") || "", page.url());
    expect(dayBookUrl.searchParams.get("returnTo")).toBe(`/simple?date=${tomorrow}`);

    await page.goto(`/simple/check-ins?date=${tomorrow}&slot=${SLOT_ID}`);
    await expect(page.getByRole("heading", { name: "Check-ins" })).toBeVisible();
    await expect(page.getByText("4 of 6 arrived")).toBeVisible();
    await expect(page.getByText("Confirm payment received")).toBeVisible();
    await expect(page.getByRole("button", { name: /Confirm R.*received/ })).toBeVisible();
    const selectedDateBox = await page.getByLabel("Selected date").boundingBox();
    const nextDayBox = await page.getByRole("button", { name: "Next day" }).boundingBox();
    expect(selectedDateBox!.x + selectedDateBox!.width).toBeLessThanOrEqual(nextDayBox!.x);
    await expectNoHorizontalOverflow(page);
    await resetScroll(page);
    await page.screenshot({ path: "/tmp/simple-view-phone-check-ins.png", fullPage: true });
    const firstCount = page.getByRole("spinbutton", { name: "Guests arrived" }).first();
    await firstCount.fill("5");
    await expect(page.getByRole("button", { name: "Save arrivals" }).first()).toBeEnabled();
    await page.getByRole("button", { name: /Confirm R.*received/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/simple-view-phone-payment.png", fullPage: true });

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/simple/calendar?date=${tomorrow}`);
    await expect(page.locator(".simple-view")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add walk-in" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "/tmp/simple-view-tablet.png", fullPage: true });

    await page.setViewportSize({ width: 1024, height: 768 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "/tmp/simple-view-tablet-landscape.png", fullPage: true });
    const walkIn = page.getByRole("link", { name: "Add walk-in" });
    const walkInBox = await walkIn.boundingBox();
    expect(walkInBox?.height).toBeGreaterThanOrEqual(44);
    const walkInUrl = new URL(await walkIn.getAttribute("href") || "", page.url());
    expect(walkInUrl.searchParams.get("date")).toBe(tomorrow);
    expect(walkInUrl.searchParams.get("returnTo")).toBe(`/simple/calendar?date=${tomorrow}`);
    await page.goto(walkInUrl.toString());
    await expect(page.getByRole("heading", { name: "Add walk-in" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "/tmp/simple-view-walk-in.png", fullPage: true });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(`/simple/calendar?date=${tomorrow}`);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page).toHaveURL(`/simple/calendar?date=${tomorrow}`);
    await expect(page.locator(".simple-view")).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/simple");
    await expect(page.getByRole("link", { name: "Full dashboard" })).toBeVisible();
    await page.getByRole("link", { name: "Full dashboard", exact: true }).click();
    await page.getByRole("button", { name: "Switch to dark mode" }).filter({ visible: true }).click();
    await page.getByRole("link", { name: "Simple View", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: "/tmp/simple-view-dark.png", fullPage: true, animations: "disabled" });
    await page.getByRole("link", { name: "Today", exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole("heading", { name: "Roll call", level: 1 })).toBeVisible();
    await page.screenshot({ path: "/tmp/simple-view-dark-today.png", fullPage: true, animations: "disabled" });
  });

  test("keeps the roll-call title when the signed-in staff member has no name", async ({ page }) => {
    await installMockBackend(page, "empty", null);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/simple");
    await expect(page.getByRole("heading", { name: "Roll call", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText("Previous Staff", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Cape Kayak Co., Simple view" })).toBeVisible();
  });

  for (const state of ["empty", "error"] as const) {
    test(`keeps the ${state} state readable on a narrow phone`, async ({ page }) => {
      await installMockBackend(page, state);
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto("/simple");
      await expect(page.getByRole("heading", { name: state === "empty" ? "No bookings today" : "Today is unavailable" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `/tmp/simple-view-${state}.png`, fullPage: true });
    });
  }

  test("shows only valid WhatsApp, Call and Email actions throughout Simple View", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await installMockBackend(page);
    const fixtures = dayFixtures(new Date().toISOString()).bookings;
    const longEmail = `alexandra.${"longcontact".repeat(8)}@example.test`;
    const bookings = [
      { ...fixtures[0], phone: "082 555 0101", email: longEmail },
      { ...fixtures[1], phone: "00 44 7700 900123", email: "not-an-email" },
      { ...fixtures[1], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", customer_name: "No contact details", phone: null, email: null },
      { ...fixtures[1], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", customer_name: "Email only", phone: null, email: "emailonly@example.test" },
      { ...fixtures[1], id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", customer_name: "Invalid contacts", phone: "Call 082 555 0101", email: "invalid@example" },
    ];
    await page.route("**/rest/v1/bookings*", async route => {
      if (new URL(route.request().url()).searchParams.has("payment_failed_at")) { await route.fallback(); return; }
      await fulfillJson(route, bookings, 200, { "content-range": "0-4/5" });
    });
    await page.route("**/rest/v1/rpc/operator_departure_manifest", route => fulfillJson(route, bookings));

    await page.route("**/rest/v1/payment_recovery_bookings*", route => fulfillJson(route, [{
      ...bookings[0], id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", customer_name: "Recovery guest",
      email: "recovery@example.test", amount_due: 100, payment_url: null,
      created_at: new Date().toISOString(), departure_at: dayFixtures(new Date().toISOString()).slots[0].start_time,
      tour_name: "Contact recovery trip", departure_passed: false,
    }]));

    for (const path of ["/simple", "/simple/calendar", "/simple/check-ins"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".sv-departure, .sv-check-in").first()).toBeVisible();
      await expect(page.getByText("Sunset Paddle", { exact: false })).toHaveCount(0);
      await expect(page.locator(".sv-booking-details")).toHaveCount(0);
      await expect(page.getByText(/Africa\/Johannesburg/)).toHaveCount(0);
      await expect(page.getByText(/^Updated /)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Refresh day", exact: true })).toHaveCount(0);
      await expect(page.locator(".sv-booking-summary")).toHaveCount(0);
      const local = page.locator("li").filter({ hasText: fixtures[0].customer_name });
      const international = page.locator("li").filter({ hasText: fixtures[1].customer_name });
      const missing = page.locator("li").filter({ hasText: "No contact details" });
      const emailOnly = page.locator("li").filter({ hasText: "Email only" });
      const invalid = page.locator("li").filter({ hasText: "Invalid contacts" });
      await expect(local.getByText("082 555 0101", { exact: true })).toHaveCount(0);
      await expect(local.getByText(longEmail, { exact: true })).toHaveCount(0);
      await expect(local.getByRole("link", { name: `Email ${fixtures[0].customer_name}`, exact: true })).toHaveAttribute("href", `mailto:${longEmail}`);
      await expect(local.getByRole("link", { name: `WhatsApp ${fixtures[0].customer_name}`, exact: true })).toHaveAttribute("href", "https://wa.me/27825550101");
      await expect(local.getByRole("link", { name: `Call ${fixtures[0].customer_name}`, exact: true })).toHaveAttribute("href", "tel:+27825550101");
      await expect(international.getByRole("link", { name: `WhatsApp ${fixtures[1].customer_name}`, exact: true })).toHaveAttribute("href", "https://wa.me/447700900123");
      await expect(international.getByRole("link", { name: `Call ${fixtures[1].customer_name}`, exact: true })).toHaveAttribute("href", "tel:+447700900123");
      await expect(international.getByRole("link", { name: `Email ${fixtures[1].customer_name}`, exact: true })).toHaveCount(0);
      await expect(missing.getByText("Phone not provided", { exact: true })).toHaveCount(0);
      await expect(missing.getByText("Email not provided", { exact: true })).toHaveCount(0);
      await expect(missing.locator(".sv-booking-contact").getByRole("link")).toHaveCount(0);
      await expect(emailOnly.locator(".sv-booking-contact").getByRole("link")).toHaveCount(1);
      await expect(emailOnly.getByRole("link", { name: "Email Email only", exact: true })).toHaveAttribute("href", "mailto:emailonly@example.test");
      await expect(invalid.locator(".sv-booking-contact")).toHaveCount(0);
      if (path === "/simple") {
        const recovery = page.getByRole("region", { name: "Payment recovery", exact: true });
        await recovery.getByRole("button", { name: /^Today / }).click();
        await expect(recovery.getByText("recovery@example.test", { exact: true })).toBeVisible();
        await expect(recovery.getByRole("link", { name: "Email Recovery guest", exact: true })).toHaveAttribute("href", "mailto:recovery@example.test");
        await expect(recovery.getByRole("link", { name: "Phone Recovery guest", exact: true })).toHaveAttribute("href", "tel:+27825550101");
        await expect(recovery.getByRole("link", { name: "WhatsApp Recovery guest", exact: true })).toHaveAttribute("href", "https://wa.me/27825550101");
      }

      for (const width of [320, 820, 1180]) {
        await page.setViewportSize({ width, height: 1000 });
        await expectNoHorizontalOverflow(page);
        const contact = local.locator(".sv-booking-contact");
        expect(await contact.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        for (const link of await contact.getByRole("link").all()) {
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        if (path === "/simple/check-ins") await local.screenshot({ path: testInfo.outputPath(`client-contact-${width}.png`) });
      }
    }
  });

  test("requires full payment for Simple View arrivals even with account approval", async ({ page }) => {
    await installMockBackend(page);
    const fixtures = dayFixtures(new Date().toISOString()).bookings;
    const bookings = [
      fixtures[0], fixtures[1],
      { ...fixtures[1], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", customer_name: "Approved unpaid", status: "CONFIRMED", total_captured: 100, unpaid_arrival_approved: true },
      { ...fixtures[1], id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", customer_name: "Unsigned paid", status: "PAID", total_captured: fixtures[1].total_amount, waiver_status: "PENDING" },
    ];
    await page.route("**/rest/v1/rpc/operator_departure_manifest", route => fulfillJson(route, bookings));
    for (const path of ["/simple", "/simple/calendar"]) {
      await page.goto(path);
      const paid = page.getByRole("checkbox", { name: `Mark all of ${fixtures[0].customer_name}'s group as present`, exact: true });
      await expect(paid).toBeEnabled();
      for (const name of [fixtures[1].customer_name, "Approved unpaid", "Unsigned paid"])
        await expect(page.getByRole("checkbox", { name: `Mark all of ${name}'s group as present`, exact: true })).toBeDisabled();
    }
    await page.goto("/simple/check-ins");
    for (const [name, enabled] of [[fixtures[0].customer_name, true], [fixtures[1].customer_name, false], ["Approved unpaid", false], ["Unsigned paid", false]] as const) {
      const row = page.locator("li.sv-check-in").filter({ hasText: name });
      await row.getByLabel("Guests arrived", { exact: true }).fill(enabled ? "5" : "1");
      await expect(row.getByRole("button", { name: "Save arrivals", exact: true })).toBeEnabled({ enabled });
    }
  });

  test("admins collapse booked sessions to only their headings", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await installMockBackend(page);
    for (const path of ["/simple", "/simple/calendar"]) {
      await page.goto(path);
      const card = page.locator(".sv-departure").first();
      for (const width of [320, 820, 1180]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(card.getByRole("listitem").first()).toBeVisible();
        const header = card.locator("summary.sv-departure-main");
        await expect(card.getByRole("button", { name: /^(Collapse|Expand) / })).toHaveCount(0);
        await header.click();
        await expect(card.locator("details")).not.toHaveAttribute("open");
        await expect(card.getByRole("heading")).toHaveCount(1);
        await expect(card.locator("time")).toBeVisible();
        await expect(card.locator(".sv-departure-meta")).toBeHidden();
        await expect(card.getByRole("link")).toHaveCount(0);
        await expect(card.getByRole("listitem")).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await card.screenshot({ path: testInfo.outputPath(`collapsed-${path === "/simple" ? "home" : "calendar"}-${width}.png`) });
        await header.focus();
        await page.keyboard.press("Enter");
        await expect(card.getByRole("listitem").first()).toBeVisible();
        await expect(card.getByRole("link", { name: /^Edit arrivals for / }).first()).toBeVisible();
        await header.focus();
        await page.keyboard.press("Space");
        await expect(card.getByRole("listitem")).toHaveCount(0);
        await header.click();
        await expect(card.getByRole("listitem").first()).toBeVisible();
      }
    }
  });

  test("shows expanded roll calls for booked sessions and saves arrival ticks safely", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.clock.setFixedTime(new Date("2026-10-04T04:00:00Z"));
    await installMockBackend(page);
    const bookings = dayFixtures(new Date().toISOString()).bookings;
    const writes: Record<string, unknown>[] = [];
    let rejectNext = false;
    await page.route("**/rest/v1/bookings*", async route => {
      if (new URL(route.request().url()).searchParams.has("payment_failed_at")) { await route.fallback(); return; }
      await fulfillJson(route, bookings, 200, { "content-range": "0-1/2" });
    });
    await page.route("**/rest/v1/rpc/operator_departure_manifest", route => fulfillJson(route, bookings));
    await page.route("**/api/check-ins?source=simple-view", async route => {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (rejectNext) {
        rejectNext = false;
        await fulfillJson(route, { ok: false, error: "Arrival count changed. Refresh and try again." }, 409);
        return;
      }
      bookings[0].arrived_count = body.arrived_count;
      bookings[0].checked_in = body.arrived_count === bookings[0].qty;
      await fulfillJson(route, { ok: true });
    });

    for (const path of ["/simple", "/simple/calendar"]) {
      bookings[0].arrived_count = 4;
      bookings[0].checked_in = false;
      bookings[1].status = "CONFIRMED";
      bookings[1].total_captured = 0;
      bookings[1].waiver_status = "SIGNED";
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const session = page.locator(".sv-departure");
      await expect(session).toHaveCount(1);
      await expect(session.getByRole("listitem")).toHaveCount(2);
      await expect(page.getByText("Sunset Paddle", { exact: false })).toHaveCount(0);
      await expect(session.locator("details")).toHaveAttribute("open");
      const client = session.getByRole("listitem").filter({ hasText: bookings[0].customer_name });
      const unpaid = session.getByRole("listitem").filter({ hasText: bookings[1].customer_name });
      await expect(client.getByText(bookings[0].phone, { exact: true })).toBeVisible();
      await expect(client.getByRole("link", { name: bookings[0].email, exact: true })).toBeVisible();
      await expect(unpaid.getByRole("checkbox")).toBeDisabled();
      await expect(unpaid.locator(".sv-arrival-guidance")).toContainText("Record the balance received, or ask an admin to approve account/reseller arrival.");
      await expect(unpaid.getByRole("link", { name: "Review payment", exact: true })).toBeVisible();
      const arrival = client.getByRole("checkbox");
      await expect(arrival).toHaveAttribute("aria-checked", "mixed");
      const firstWrite = writes.length;
      await arrival.click();
      await expect(arrival).toHaveAttribute("aria-checked", "true");
      await expect(client.getByText("6/6", { exact: true })).toBeVisible();
      await arrival.click();
      await expect(arrival).toHaveAttribute("aria-checked", "false");
      await expect(client.getByText("0/6", { exact: true })).toBeVisible();
      rejectNext = true;
      await arrival.click();
      await expect(client.getByRole("status")).toHaveText("Arrival count changed. Refresh and try again.");
      await expect(arrival).toHaveAttribute("aria-checked", "false");
      expect(writes.slice(firstWrite)).toMatchObject([
        { booking_id: bookings[0].id, slot_id: SLOT_ID, arrived_count: 6, expected_arrived_count: 4 },
        { booking_id: bookings[0].id, slot_id: SLOT_ID, arrived_count: 0, expected_arrived_count: 6 },
        { booking_id: bookings[0].id, slot_id: SLOT_ID, arrived_count: 6, expected_arrived_count: 0 },
      ]);
      bookings[1].status = "CONFIRMED";
      bookings[1].total_captured = 1300;
      bookings[1].waiver_status = "PENDING";
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(unpaid.getByRole("checkbox")).toBeDisabled();
      await expect(unpaid.locator(".sv-arrival-guidance")).toContainText("waiver needed");
      for (const width of [320, 820, 1180]) {
        await page.setViewportSize({ width, height: 1000 });
        await expectNoHorizontalOverflow(page);
        await session.screenshot({ path: testInfo.outputPath(`roll-call-${path === "/simple" ? "home" : "calendar"}-${width}.png`) });
      }
    }
  });

  test("hides every unbooked session and shows booking empty states", async ({ page }) => {
    test.setTimeout(180_000);
    await installMockBackend(page);
    await page.route("**/rest/v1/bookings*", async route => {
      await fulfillJson(route, [], 200, { "content-range": "*/0" });
    });
    for (const [path, heading] of [["/simple", "No bookings today"], ["/simple/calendar", "No booked sessions on this day"], ["/simple/check-ins", "No bookings to check in"]]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".simple-view")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.locator(".sv-departure, .sv-check-in")).toHaveCount(0);
      await expect(page.getByText("Sunset Paddle", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Add walk-in", exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("combobox").getByRole("option")).toHaveCount(1);
  });

  test("keeps Simple View in the dashboard header and out of the sidebar and More menu", async ({ page }) => {
    test.setTimeout(180_000);
    await installMockBackend(page);
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const more = page.getByRole("button", { name: "More navigation" });
    const help = page.getByRole("button", { name: "Open AI help" });
    await expect(more).toBeVisible();
    await expect(help).toBeVisible();
    const moreBox = await more.boundingBox();
    const helpBox = await help.boundingBox();
    expect(helpBox!.y + helpBox!.height).toBeLessThan(moreBox!.y);
    expect(await help.evaluate(e => getComputedStyle(e).position)).not.toBe("fixed");
    await expect(page.getByRole("link", { name: "Simple View", exact: true })).toBeVisible();
    await more.click();
    const drawer = page.getByRole("dialog", { name: "More navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('a[href="/simple"]')).toHaveCount(0);
    await drawer.getByRole("button", { name: "Close menu" }).click();

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator('aside a[href="/simple"]')).toHaveCount(0);
    const simpleView = page.getByRole("link", { name: "Simple View", exact: true });
    await expect(simpleView).toBeVisible();
    await expect(simpleView).toHaveCount(1);
    await simpleView.click();
    await expect(page).toHaveURL("/simple");
    await expect(page.locator(".simple-view")).toBeVisible();
  });

  test("opens toolbar AI help downward and keeps the whole panel on screen", async ({ page }, testInfo) => {
    await installMockBackend(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const launcher = page.getByRole("button", { name: "Open AI help" });
    await launcher.click();
    const panel = page.getByRole("dialog", { name: "AI help", exact: true });
    await expect(panel).toBeVisible();

    for (const [width, height] of [[1440, 900], [1024, 768], [820, 1180], [390, 844], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(async () => {
        const bounds = await panel.boundingBox();
        const button = await launcher.boundingBox();
        return !!bounds && !!button
          && bounds.y >= button.y + button.height
          && bounds.x >= 0 && bounds.x + bounds.width <= width
          && bounds.y + bounds.height <= height;
      }, { message: `AI help stays below its launcher and inside ${width}x${height}` }).toBe(true);

      for (const control of [panel.getByRole("button", { name: "Close help" }), panel.getByRole("textbox", { name: "Your question" })]) {
        await expect(control).toBeVisible();
        expect(await control.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`ai-help-${width}x${height}.png`) });
    }

    await panel.getByRole("button", { name: "Close help" }).click();
    await expect(panel).toHaveCount(0);
    await launcher.click();
    await expect(panel.getByRole("textbox", { name: "Your question" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("uses the dedicated tablet style for a read-only demo", async ({ page }) => {
    await installMockBackend(page, "populated", "Demo Operator", true);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/simple");
    await expect(page.locator(".simple-view")).toBeVisible();
    await expect(page.getByRole("link", { name: "Cape Kayak Co., Simple view" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add walk-in" })).toHaveCount(0);
    await page.screenshot({ path: "/tmp/simple-view-readonly-tablet.png", fullPage: true });
    const arrivalRequests: string[] = [];
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/check-ins") arrivalRequests.push(request.url()); });
    const arrival = page.getByRole("checkbox").first();
    await arrival.click();
    await expect(arrival).toHaveAttribute("aria-checked", "mixed");
    expect(arrivalRequests).toEqual([]);
  });

  test("keeps dashboard data and actions inside the cards across tablet and content breakpoints", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await installMockBackend(page);
    await page.goto("/");
    const manifest = page.getByRole("region", { name: "Manifest", exact: true });
    const rollCall = page.getByRole("region", { name: "Roll Call", exact: true });
    await expect(manifest).toBeVisible();
    for (const [width, height] of [[768,1024],[1024,768],[820,1180],[1180,820],[767,1000],[769,1000],[1023,800],[1025,800],[1279,1000],[1280,1000],[1335,1000],[1336,1000],[1440,1000],[1920,1080],[320,844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.fonts.ready);
      const dimensions = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        const cards = Array.from(document.querySelectorAll('section[aria-label="Manifest"],section[aria-label="Roll Call"]'));
        return { root: document.documentElement.scrollWidth, main: main.scrollWidth, mainWidth: main.clientWidth,
          clipped: cards.flatMap(card => Array.from(card.querySelectorAll("th,td,button,a,.ui-status")).filter(e => {
            const rect = e.getBoundingClientRect(), bounds = card.getBoundingClientRect();
            return rect.width > 0 && (rect.right > bounds.right + 1 || rect.left < bounds.left - 1 || e.scrollWidth > e.clientWidth + 1);
          }).map(e => ({ text: e.textContent, width: e.clientWidth, scrollWidth: e.scrollWidth }))) };
      });
      expect(dimensions.root, `${width}px page width`).toBeLessThanOrEqual(width);
      expect(dimensions.main, `${width}px main width`).toBeLessThanOrEqual(dimensions.mainWidth + 1);
      expect(dimensions.clipped, `${width}px card content`).toEqual([]);
      await expect(page.getByRole("link", { name: "Simple View", exact: true })).toBeVisible();
      await expect(manifest.getByRole("link", { name: "Add Booking", exact: true })).toBeVisible();
      await expect(manifest.getByText("Totals", { exact: true }).or(manifest.getByText("Totals: 10 guests", { exact: true })).filter({ visible: true })).toBeVisible();
      if ([768,1024,820,1180,1440].includes(width)) {
        await manifest.screenshot({ path: testInfo.outputPath(`manifest-${width}x${height}.png`) });
        await rollCall.screenshot({ path: testInfo.outputPath(`roll-call-${width}x${height}.png`) });
      }
    }
    await page.setViewportSize({ width: 820, height: 1180 });
    await manifest.getByRole("button", { name: /^Select / }).first().click();
    await expect(rollCall.getByText("Departure 1 of 2", { exact: true })).toBeVisible();
    await expect(rollCall.getByText("4 of 8 pax checked in", { exact: true })).toBeVisible();
    const writes: unknown[] = [];
    await page.route("**/api/check-ins?source=dashboard", async route => {
      writes.push(route.request().postDataJSON());
      await fulfillJson(route, { ok: true });
    });
    await rollCall.getByRole("checkbox").filter({ visible: true }).first().click();
    await expect(rollCall.getByText("6 of 8 pax checked in", { exact: true })).toBeVisible();
    expect(writes).toMatchObject([{ arrived_count: 6, expected_arrived_count: 4, slot_id: SLOT_ID }]);
    await rollCall.getByRole("checkbox").filter({ visible: true }).first().click();
    await expect(rollCall.getByText("0 of 8 pax checked in", { exact: true })).toBeVisible();
    expect(writes).toMatchObject([{ arrived_count: 6 }, { arrived_count: 0, expected_arrived_count: 6 }]);
    await rollCall.getByRole("button", { name: "Next departure", exact: true }).click();
    await expect(rollCall.getByText("Departure 2 of 2", { exact: true })).toBeVisible();
    await manifest.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await expect(rollCall.getByText("Departure 1 of 2", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(manifest.getByRole("button", { name: "Tomorrow", exact: true })).toHaveAttribute("data-active", "true");
    await expect(page.getByText("Photo upload backlog", { exact: true })).toBeVisible();
    await expect(page.getByText("Without photos · last 7 days", { exact: true })).toBeVisible();
    await manifest.getByRole("link", { name: "Add Booking", exact: true }).click();
    await expect(page).toHaveURL(/\/new-booking/);
  });

  test("keeps Simple View and selected date through rotation without touch detection", async ({ page }) => {
    await installMockBackend(page);
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/");
    await page.getByRole("link", { name: "Simple View", exact: true }).click();
    await expect(page.locator(".simple-view")).toBeVisible();
    await page.getByLabel("Selected date").fill("2026-10-02");
    for (const [width,height] of [[768,1024],[1024,768],[1180,820],[820,1180],[1367,1000],[1440,1000]]) {
      await page.setViewportSize({ width,height });
      await expect(page).toHaveURL("/simple?date=2026-10-02");
      await expect(page.getByLabel("Selected date")).toHaveValue("2026-10-02");
      await expectNoHorizontalOverflow(page);
    }
  });

  test("keeps empty and loading dashboards within tablet width", async ({ page }) => {
    await installMockBackend(page, "empty");
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/rest/v1/rpc/get_operator_dashboard", async route => { await pending; await route.fallback(); });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main .ui-skeleton").first()).toBeVisible();
    expect(await page.locator("main").evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    release();
    await expect(page.getByRole("region", { name: "Manifest" }).getByText("No bookings today", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Roll Call" }).getByText("No bookings today", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Simple View", exact: true })).toBeVisible();
  });

  for (const role of ["ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"]) {
    test(`preserves ${role} navigation and section permissions on a landscape tablet`, async ({ page }) => {
      await installMockBackend(page, "populated", "Taylor Operator", false, role, { "hide:dashboard_reports": true, "hide:/reports": true, "hide:/simple": true });
      await page.setViewportSize({ width: 1180, height: 820 });
      await page.goto("/");
      await expect(page.getByRole("region", { name: "Manifest" })).toBeVisible();
      if (role === "ADMIN") {
        await expect(page.getByRole("link", { name: "Simple View", exact: true })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Reports", exact: true })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Booking value", exact: true })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByRole("link", { name: "Simple View", exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Reports", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Booking value", exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
      }
      await expect(page.getByRole("link", { name: "Super Admin", exact: true })).toHaveCount(role === "SUPER_ADMIN" ? 1 : 0);
    });
  }
});

for (const viewport of [{ width: 390, height: 844, path: "/simple" }, { width: 1280, height: 900, path: "/" }]) {
  test(`payment recovery emails and automatically removes paid bookings at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMockBackend(page);
    await page.clock.install();
    let paid = false;
    let sent = false;
    let rejectEmail = true;
    let missingPaymentLink = true;
    await page.route("**/rest/v1/payment_recovery_bookings?*", async route => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("business_id")).toBe(`eq.${BUSINESS_ID}`);
      expect(url.searchParams.has("payment_failed_at")).toBe(false);
      expect(url.searchParams.get("amount_due")).toBe("gt.0");
      expect(url.searchParams.get("order")).toBe("departure_passed.asc.nullslast,departure_at.asc.nullslast,slot_id.asc,id.asc");
      expect(url.searchParams.get("status")).toBe("not.in.(PAID,COMPLETED,CANCELLED,EXPIRED)");
      expect(url.searchParams.get("or")).toBe("(payment_status.is.null,payment_status.neq.CAPTURED)");
      // Legacy totals can lag a successful payment; terminal status must still remove it.
      const filtered = paid && (viewport.width === 390
        ? url.searchParams.get("status") === "not.in.(PAID,COMPLETED,CANCELLED,EXPIRED)"
        : url.searchParams.get("or") === "(payment_status.is.null,payment_status.neq.CAPTURED)");
      await fulfillJson(route, filtered ? [] : [{
        id: "88888888-8888-4888-8888-888888888888", customer_name: "Recovery Guest",
        email: "recovery@example.test", phone: "082 555 0101", status: paid ? (viewport.width === 390 ? "PAID" : "CONFIRMED") : "PENDING PAYMENT",
        total_amount: 650, total_captured: paid ? 100 : 0, amount_due: paid ? 550 : 650, payment_status: paid && viewport.width === 1280 ? "CAPTURED" : null,
        created_at: "2026-10-15T07:00:00Z", slot_id: SLOT_ID, departure_at: "2099-10-16T08:00:00Z", tour_name: "Harbour paddle", departure_passed: false,
        payment_url: missingPaymentLink ? null : "https://checkout.yoco.com/fixture", payment_failed_at: "2026-10-15T08:00:00Z",
        payment_failure_reason: "Payment was not completed", payment_recovery_emailed_at: sent ? "2026-10-15T09:00:00Z" : null,
      }]);
    });
    await page.route("**/functions/v1/auto-messages", async route => {
      expect(route.request().postDataJSON()).toMatchObject({ action: "payment_recovery_email", business_id: BUSINESS_ID, booking_id: "88888888-8888-4888-8888-888888888888" });
      if (rejectEmail) { await fulfillJson(route, { ok: false, error: "The email could not be sent. Please try again." }, 400); return; }
      sent = true;
      await fulfillJson(route, { ok: true });
    });
    await page.goto(viewport.path);
    const panel = page.getByRole("region", { name: "Payment recovery", exact: true });
    await panel.getByRole("button", { name: "All departure days", exact: true }).click();
    await expect(panel.getByText("Recovery Guest", { exact: false })).toBeVisible();
    await expect(panel).not.toContainText("Payment needed");
    await expect(panel).not.toContainText("Create a payment link in the booking first.");
    await expect(panel.getByRole("button", { name: "Email payment link", exact: true })).toHaveText("");
    await expect(panel.getByRole("button", { name: "Email payment link", exact: true })).toBeDisabled();
    missingPaymentLink = false;
    await panel.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Email payment link", exact: true })).toBeEnabled();
    const whatsapp = panel.getByRole("link", { name: "WhatsApp Recovery Guest", exact: true });
    await expect(whatsapp).toHaveAttribute("href", "https://wa.me/27825550101");
    await expect(whatsapp).toHaveAttribute("target", "_blank");
    await expect(whatsapp).toBeVisible();
    await page.context().route("https://wa.me/**", route => route.fulfill({ contentType: "text/plain", body: "Synthetic WhatsApp destination" }));
    const popupPromise = page.waitForEvent("popup");
    await whatsapp.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL("https://wa.me/27825550101");
    await popup.close();
    await panel.getByRole("button", { name: "Email payment link", exact: true }).click();
    await expect(page.getByText("The email could not be sent. Please try again.", { exact: true })).toBeVisible();
    await expect(panel.getByText("Recovery email sent", { exact: false })).toHaveCount(0);
    rejectEmail = false;
    await panel.getByRole("button", { name: "Email payment link", exact: true }).click();
    await expect(panel.getByText("Recovery email sent", { exact: false })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Resend payment email" })).toBeVisible();
    paid = true;
    await page.clock.fastForward(30_000);
    await expect(panel.getByText("No payments need follow-up.", { exact: false })).toBeVisible();
    await expect(panel.getByRole("button", { name: "All outcomes" })).toHaveCount(0);
    await expect(panel.getByText("Recovery Guest", { exact: false })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /payment email|Email payment link/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByText("The Yoco payment link was emailed to recovery@example.test.", { exact: true })).not.toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: `/private/tmp/payment-recovery-${viewport.width}.png` });
  });
}

test("operators configure automatic loyalty, return-time and group offers", async ({ page }) => {
  await installMockBackend(page, "populated", "Taylor Operator", false, "MAIN_ADMIN");
  let saved: Record<string, any> | null = null;
  await page.route("**/rest/v1/policies*", async route => {
    const request = route.request();
    if (request.method() === "POST") { saved = request.postDataJSON(); await fulfillJson(route, []); return; }
    await fulfillJson(route, { business_id: BUSINESS_ID, loyalty_bookings_threshold: 2, loyalty_period_days: 30, loyalty_discount_percent: 10, group_discount_min_qty: 6, group_discount_percent: 5, booking_discount_rules: saved?.booking_discount_rules ?? null });
  });
  await page.goto("/marketing/promotions");
  const panel = page.getByRole("region", { name: "Automatic booking discounts", exact: true });
  await expect(panel.getByLabel("Within the last (days)", { exact: true })).toHaveValue("30");
  await panel.getByLabel("Within the last (days)", { exact: true }).fill("60");
  await panel.getByLabel("Previous bookings required", { exact: true }).fill("3");
  await panel.getByLabel("Minimum guests", { exact: true }).nth(1).fill("8");
  await panel.getByRole("button", { name: "Add discount rule", exact: true }).click();
  await panel.getByRole("checkbox", { name: "Rule 3 enabled", exact: true }).check();
  await panel.getByLabel("At least (days since last booking)", { exact: true }).fill("90");
  await panel.getByLabel("At most (days, optional)", { exact: true }).fill("180");
  await panel.getByLabel("Discount (%)", { exact: true }).nth(2).fill("12");
  await panel.getByRole("button", { name: "Save automatic discounts", exact: true }).click();
  await expect(page.getByText("Automatic discounts saved", { exact: true })).toBeVisible();
  expect(saved).toMatchObject({ business_id: BUSINESS_ID, booking_discount_rules: [
    { kind: "frequency", min_bookings: 3, window_days: 60 },
    { kind: "group", min_guests: 8 },
    { kind: "recency", min_days: 90, max_days: 180, percent: 12, enabled: true },
  ] });
  for (const width of [390, 1180]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByText("Automatic discounts saved", { exact: true })).not.toBeVisible();
    await panel.getByRole("heading", { name: "Automatic chat discounts", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/private/tmp/booking-discounts-${width}.png` });
    await panel.getByRole("button", { name: "Save automatic discounts", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/private/tmp/booking-discounts-bottom-${width}.png` });
  }
  await page.reload();
  await expect(panel.getByLabel("Within the last (days)", { exact: true })).toHaveValue("60");
  await expect(panel.getByLabel("At most (days, optional)", { exact: true })).toHaveValue("180");
});

test("operators choose booking-based welcome-back email timing", async ({ page }) => {
  await installMockBackend(page, "populated", "Taylor Operator", false, "MAIN_ADMIN");
  const automationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let saved: Record<string, any> | null = null;
  await page.route("**/rest/v1/marketing_automations*", async route => {
    if (route.request().method() === "PATCH") { saved = route.request().postDataJSON(); await fulfillJson(route, []); return; }
    await fulfillJson(route, { id: automationId, business_id: BUSINESS_ID, name: "Welcome-back email", description: "Synthetic draft", trigger_type: "manual", trigger_config: {}, status: "draft" }, 200, { "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS" });
  });
  await page.goto(`/marketing/automations/${automationId}`);
  await expect(page.getByText("Automation not found.", { exact: true })).toHaveCount(0);
  await page.locator("select").filter({ has: page.locator('option[value="booking_inactive"]') }).selectOption("booking_inactive");
  await page.getByLabel("Days since last paid booking", { exact: false }).fill("45");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => saved?.trigger_type).toBe("booking_inactive");
  expect(saved?.trigger_config).toEqual({ days_since_last_booking: 45 });
  await expect(page.getByText("Email only.", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test("dashboard puts departures below summaries and payment recovery before weather", async ({ page }) => {
  await installMockBackend(page);
  await page.goto("/");
  for (const width of [390, 1024, 1536]) {
    await page.setViewportSize({ width, height: 1000 });
    const pax = page.getByRole("link").filter({ hasText: "Today's guests" });
    const revenue = page.getByRole("link").filter({ has: page.getByRole("heading", { name: "Booking value", exact: true }) });
    const manifest = page.getByRole("region", { name: "Manifest", exact: true });
    const rollCall = page.getByRole("region", { name: "Roll Call", exact: true });
    const recovery = page.getByRole("region", { name: "Payment recovery", exact: true });
    await expect(manifest).toBeVisible();
    const summaries = [await pax.boundingBox(), await revenue.boundingBox()];
    const lastSummary = Math.max(...summaries.map(rect => rect!.y + rect!.height));
    expect((await manifest.boundingBox())!.y).toBeGreaterThanOrEqual(lastSummary);
    expect((await rollCall.boundingBox())!.y).toBeGreaterThanOrEqual(lastSummary);
    const weather = page.getByRole("heading", { name: "Weather", exact: true });
    const recoveryBox = (await recovery.boundingBox())!;
    expect((await weather.boundingBox())!.y).toBeGreaterThan(recoveryBox.y + recoveryBox.height);
    expect(await recovery.evaluate(element => element.closest("[data-dashboard-tile]")?.nextElementSibling?.getAttribute("data-dashboard-tile"))).toBe("weather");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `/private/tmp/dashboard-order-${width}.png`, fullPage: true });
  }
});

test("payment recovery groups departure dates and keeps simultaneous trips separate", async ({ page }) => {
  await installMockBackend(page);
  const rows = [
    { id: "one", slot_id: SLOT_ID, departure_at: "2099-10-16T08:00:00Z", tour_name: "Harbour paddle", customer_name: "First guest" },
    { id: "two", slot_id: SLOT_ID, departure_at: "2099-10-16T08:00:00Z", tour_name: "Harbour paddle", customer_name: "Second guest" },
    { id: "three", slot_id: SECOND_SLOT_ID, departure_at: "2099-10-16T08:00:00Z", tour_name: "Rock pool", customer_name: "Other trip guest" },
    { id: "four", slot_id: "next-day", departure_at: "2099-10-16T22:30:00Z", tour_name: "Night paddle", customer_name: "Next day guest" },
    { id: "past", slot_id: "past-trip", departure_at: "2020-10-16T08:00:00Z", tour_name: "Past paddle", customer_name: "Past guest", departure_passed: true },
    { id: "missing", slot_id: null, departure_at: null, tour_name: null, customer_name: "Unscheduled guest" },
  ].map(row => ({ status: "CONFIRMED", email: null, phone: null, total_amount: 100, total_captured: 0, amount_due: 100, created_at: "2026-10-16T08:00:00Z", departure_passed: false, ...row }));
  await page.route("**/rest/v1/payment_recovery_bookings?*", async route => {
    expect(new URL(route.request().url()).searchParams.get("order")).toBe("departure_passed.asc.nullslast,departure_at.asc.nullslast,slot_id.asc,id.asc");
    await fulfillJson(route, rows);
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Payment recovery", exact: true });
  const trip = panel.locator("summary").filter({ hasText: "10:00 · Harbour paddle" });
  await expect(trip).toBeVisible();
  await expect(panel.getByRole("link", { name: /First guest/ })).toBeVisible();
  await expect(panel.getByRole("link", { name: /Second guest/ })).toBeVisible();
  await expect(panel.getByRole("link", { name: /Other trip guest/ })).toBeHidden();
  await trip.click();
  await expect(panel.getByRole("link", { name: /First guest/ })).toBeHidden();
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(panel.getByRole("link", { name: /First guest/ })).toBeHidden();
  await panel.locator("summary").filter({ hasText: "10:00 · Rock pool" }).click();
  await expect(panel.getByRole("link", { name: /Other trip guest/ })).toBeVisible();
  const nextDay = panel.locator("summary").filter({ hasText: /17 Oct 2099/ });
  await nextDay.click();
  await expect(panel.locator("summary").filter({ hasText: "00:30 · Night paddle" })).toBeVisible();
  await expect(panel.getByRole("link", { name: /Next day guest/ })).toBeVisible();
  const labels = await panel.locator("summary").allTextContents();
  expect(labels.findIndex(label => label.includes("Past trips"))).toBeGreaterThan(labels.findIndex(label => label.includes("17 Oct 2099")));
  await expect(panel.locator("summary").filter({ hasText: "Departure not set" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await panel.screenshot({ path: "/private/tmp/payment-recovery-grouped.png" });
});

for (const path of ["/bookings", "/simple/bookings"]) {
  test(`${path} copies the guest number and opens device WhatsApp`, async ({ page }) => {
    await installMockBackend(page);
    const fixtures = dayFixtures(new Date().toISOString());
    const rows = fixtures.bookings.map(booking => ({ ...booking, created_at: new Date().toISOString(), source: "WHATSAPP", tours: { id: TOUR_ID, name: "Harbour paddle" }, slots: fixtures.slots[0] }));
    await page.route("**/rest/v1/rpc/list_operator_bookings*", route => fulfillJson(route, rows));
    await page.goto(path);
    await page.getByRole("checkbox", { name: "Expand All", exact: true }).check();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const blocked of [false, true]) {
        await page.evaluate(blocked => {
          const state = { copied: [] as string[], opened: [] as unknown[][] };
          (window as any).__deviceContact = state;
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (value: string) => {
            if (blocked) return Promise.reject(new Error("Clipboard denied"));
            state.copied.push(value); return Promise.resolve();
          } } });
          window.open = (...args) => { state.opened.push(args); return null; };
        }, blocked);
        await page.getByRole("button", { name: width < 1024 ? "Guest actions" : "Actions ▾", exact: true }).first().click();
        await page.getByRole("button", { name: /^WhatsApp on device/ }).filter({ visible: true }).click();
        await expect(page.getByText(blocked ? "Could not copy phone number" : "Phone number copied", { exact: true })).toBeVisible();
        const result = await page.evaluate(() => (window as any).__deviceContact);
        expect(result.opened).toEqual([["https://wa.me/27825550101", "_blank", "noopener,noreferrer"]]);
        expect(result.copied).toEqual(blocked ? [] : ["+27825550101"]);
        await expect(page.locator("[data-mobile-action-sheet]")).toHaveCount(0);
      }
    }
  });
}

for (const path of ["/bookings", "/simple/bookings"]) {
  test(`${path} uses the booking table on desktop and cards below desktop`, async ({ page }) => {
    await installMockBackend(page);
    const fixtures = dayFixtures(new Date().toISOString());
    const rows = fixtures.bookings.map(booking => ({ ...booking, created_at: new Date().toISOString(), source: "WHATSAPP", tours: { id: TOUR_ID, name: "Atlantic Ocean Kayak Adventure" }, slots: fixtures.slots[0] }));
    await page.route("**/rest/v1/rpc/list_operator_bookings*", route => fulfillJson(route, rows));
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const table = page.getByRole("table").first();
    await expect(table).toBeVisible();
    for (const width of [1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const heading of ["Time", "Pax", "Details", "Service", "Price", "Paid", "Due", "Actions"]) {
        await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "View guests", exact: true })).toHaveCount(0);
      await expect(table.getByText("Totals", { exact: true })).toBeVisible();
      await page.getByRole("checkbox", { name: "Expand All", exact: true }).check();
      await expect(table.getByText(rows[0].email, { exact: true })).toBeVisible();
      const actions = table.getByRole("button", { name: "Actions ▾", exact: true }).first();
      await actions.click();
      await expect(table.getByRole("button", { name: "View", exact: true })).toBeVisible();
      await expect(table.getByRole("button", { name: "WhatsApp on device", exact: true })).toBeEnabled();
      await page.getByRole("heading", { name: "Bookings", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await table.screenshot({ path: `/private/tmp/bookings-${path.startsWith("/simple") ? "simple" : "full"}-${width}.png` });
    }
    for (const { width, height } of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1023, height: 900 }]) {
      await page.setViewportSize({ width, height });
      await expect(table.getByRole("columnheader", { name: "Time", exact: true })).toHaveCount(0);
      await expect(table.getByRole("button", { name: "Hide guests", exact: true })).toBeVisible();
      const guestActions = table.getByRole("button", { name: "Guest actions", exact: true }).first();
      // Safari does not focus pointer-clicked buttons; give the return-focus check a keyboard origin.
      await guestActions.focus();
      await guestActions.press("Enter");
      await expect(page.locator("[data-mobile-action-sheet]")).toBeVisible();
      await expect(page.locator("[data-mobile-action-sheet]").getByRole("button", { name: /^View booking/ })).toBeVisible();
      const sheet = page.locator("[data-mobile-action-sheet]");
      await expect(sheet.getByRole("button", { name: /^WhatsApp on device/ })).toBeEnabled();
      await page.screenshot({ path: `/private/tmp/guest-actions-${path.startsWith("/simple") ? "simple" : "full"}-${width}.png` });
      const sheetBox = (await sheet.boundingBox())!;
      expect(sheetBox.y).toBeGreaterThanOrEqual(0);
      expect(sheetBox.y + sheetBox.height).toBeCloseTo(height, 0);
      await expect(sheet.getByRole("button", { name: /^View booking/ })).toBeInViewport();
      const cancel = sheet.getByRole("button", { name: /^Cancel/ });
      await cancel.scrollIntoViewIfNeeded();
      await expect(cancel).toBeInViewport();
      await cancel.click({ trial: true });
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-mobile-action-sheet]")).toHaveCount(0);
      await expect(table.getByRole("button", { name: "Guest actions", exact: true }).first()).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await table.getByRole("button", { name: "Departure actions", exact: true }).click();
    await expect(page.locator("[data-mobile-action-sheet]")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await expect(page.locator("[data-mobile-action-sheet]")).toHaveCount(0);
  });
}

test("bookings show full names, keep history at the far left on mobile, and show sources in View", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await installMockBackend(page);
  const fixture = dayFixtures(new Date().toISOString());
  const rows = fixture.bookings.map((booking, index) => ({
    ...booking, business_id: BUSINESS_ID, tour_id: TOUR_ID, unit_price: 650, created_at: new Date().toISOString(),
    customer_name: index === 0 ? booking.customer_name : "LongUnbrokenCustomerName".repeat(5),
    source: index === 0 ? "WHATSAPP" : "WEB", external_ref: `KAYAK-DEMO:2026-10-21:${index + 1}`,
    refund_status: null, custom_fields: null, tours: { id: TOUR_ID, name: "Harbour paddle", duration_minutes: 120 }, slots: fixture.slots[0],
  }));
  await page.route("**/rest/v1/rpc/list_operator_bookings*", route => fulfillJson(route, rows));
  await page.route("**/rest/v1/rpc/operator_booking_history*", route => fulfillJson(route, [{ booking_id: rows[0].id, previous_booking_at: "2026-01-10T10:00:00Z", previous_booking_count: 3 }]));
  await page.route("**/rest/v1/bookings?*", async route => {
    const id = new URL(route.request().url()).searchParams.get("id")?.slice(3);
    const row = rows.find(booking => booking.id === id);
    if (row) await fulfillJson(route, row);
    else await route.fallback();
  });
  await page.route("**/rest/v1/invoices?*", route => fulfillJson(route, null));

  for (const path of ["/bookings", "/simple/bookings"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.getByRole("checkbox", { name: "Expand All", exact: true }).check();
    const table = page.getByRole("table").first();
    for (const width of [320, 390, 820, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(table.getByText(/Ref:|KAYAK-DEMO:/)).toHaveCount(0);
      await expect(table.getByText(/^(WHATSAPP|WEB|Website)$/)).toHaveCount(0);
      for (const booking of rows) {
        const row = table.locator(`tr[data-booking-id="${booking.id}"]`).filter({ visible: true });
        const name = row.getByText(booking.customer_name, { exact: true });
        await expect(name).toBeVisible();
        expect(await name.evaluate(element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const text = range.getBoundingClientRect();
          const bounds = element.getBoundingClientRect();
          return getComputedStyle(element).textOverflow !== "ellipsis"
            && text.right <= bounds.right + 1 && text.bottom <= bounds.bottom + 1
            && element.scrollWidth <= element.clientWidth + 1;
        }), `Complete name at ${width}px`).toBe(true);
      }
      if (width < 1024) {
        const row = table.locator(`tr[data-booking-id="${rows[0].id}"]`).filter({ visible: true });
        const badge = row.getByRole("button", { name: `3 previous paid bookings for ${rows[0].customer_name}`, exact: true });
        const badgeBox = (await badge.boundingBox())!;
        const rowBox = (await row.boundingBox())!;
        expect(badgeBox.x - rowBox.x).toBeLessThanOrEqual(17);
        expect(badgeBox.width).toBeGreaterThanOrEqual(44);
        const nameBox = (await row.getByText(rows[0].customer_name, { exact: true }).boundingBox())!;
        expect(badgeBox.x + badgeBox.width).toBeLessThan(nameBox.x);
        await row.getByRole("checkbox", { name: `Select ${rows[0].customer_name}`, exact: true }).check();
        await row.getByRole("checkbox", { name: `Select ${rows[0].customer_name}`, exact: true }).uncheck();
      }
      await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1440) await table.screenshot({ path: testInfo.outputPath(`${path.startsWith("/simple") ? "simple" : "full"}-booking-names-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [index, booking] of rows.entries()) {
      const row = table.locator(`tr[data-booking-id="${booking.id}"]`).filter({ visible: true });
      await row.getByRole("button", { name: "Guest actions", exact: true }).click();
      await page.locator("[data-mobile-action-sheet]").getByRole("button", { name: /^View booking/ }).click();
      await expect(page).toHaveURL(new RegExp(`/bookings/${booking.id}`));
      await expect(page.getByText(index === 0 ? "WhatsApp" : "Website", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(path);
      await page.getByRole("checkbox", { name: "Expand All", exact: true }).check();
    }
  }
});

test("bookings show the prior paid booking and recognise returning guests", async ({ page }) => {
  await installMockBackend(page);
  const fixtures = dayFixtures(new Date().toISOString());
  fixtures.slots[1].start_time = new Date(Date.parse(fixtures.slots[0].start_time) + 86_400_000).toISOString();
  const rows = fixtures.bookings.map((booking, index) => ({ ...booking, created_at: new Date().toISOString(), source: "WHATSAPP", tours: { id: TOUR_ID, name: "Atlantic Ocean Kayak Adventure" }, slots: fixtures.slots[index] || fixtures.slots[0] }));
  await page.route("**/rest/v1/rpc/list_operator_bookings*", route => fulfillJson(route, rows));
  await page.route("**/rest/v1/rpc/operator_booking_history*", async route => {
    expect(route.request().postDataJSON().p_business_id).toBe(BUSINESS_ID);
    await fulfillJson(route, rows.map((row, index) => ({ booking_id: row.id, previous_booking_at: index === 0 ? "2026-01-10T10:00:00Z" : null, previous_booking_count: index === 0 ? 3 : 0 })));
  });
  await page.goto("/bookings");
  await expect(page.getByRole("checkbox", { name: "Expand All", exact: true })).toHaveCount(2);
  for (const checkbox of await page.getByRole("checkbox", { name: "Expand All", exact: true }).all()) await checkbox.check();
  for (const width of [390, 1536]) {
    await page.setViewportSize({ width, height: 1000 });
    const badge = page.getByRole("button", { name: `3 previous paid bookings for ${rows[0].customer_name}`, exact: true });
    await expect(badge).toHaveText("3");
    const name = page.getByText(rows[0].customer_name, { exact: true }).filter({ visible: true }).first();
    expect((await badge.boundingBox())!.x + (await badge.boundingBox())!.width).toBeLessThanOrEqual((await name.boundingBox())!.x);
    await expect(page.getByText("No previous paid bookings", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /previous paid bookings for Sam/ })).toHaveCount(0);
    await badge.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("3 previous paid bookings");
    await expect(tooltip).toContainText("Last booking: 10 Jan 2026");
    expect(await tooltip.evaluate(element => { const r=element.getBoundingClientRect();return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })).toBe(true);
    await page.screenshot({ path: `/private/tmp/booking-history-badge-${width}.png` });
    await page.mouse.move(0, 0);
    await expect(tooltip).toHaveCount(0);
    await badge.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await badge.click();
    await expect(tooltip).toBeVisible();
    await badge.blur();
    await page.mouse.move(0, 0);
    await expectNoHorizontalOverflow(page);
  }
});

for (const path of ["/bookings", "/simple/bookings"]) {
  test(`${path} keeps month pickers above the booking table`, async ({ page }) => {
    await installMockBackend(page);
    const fixtures = dayFixtures(new Date().toISOString());
    const rows = fixtures.bookings.map(booking => ({ ...booking, created_at: new Date().toISOString(), tours: { id: TOUR_ID, name: "Harbour paddle" }, slots: fixtures.slots[0] }));
    await page.route("**/rest/v1/rpc/list_operator_bookings*", route => fulfillJson(route, rows));
    await page.goto(path);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("button", { name: /^(All|Pending|Paid|Confirmed|Completed|Cancelled)\s*\d+$/ })).toHaveCount(0);
      for (const name of ["Previous week", "Next week"]) {
        await expect(page.getByRole("button", { name, exact: true })).toHaveText("");
      }
      await page.locator('button[aria-haspopup="dialog"]').click();
      const picker = page.getByRole("dialog", { name: "Choose month", exact: true });
      await expect(picker).toBeVisible();
      expect(await picker.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
          && element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })).toBe(true);
      await picker.getByRole("button", { name: "Oct", exact: true }).click();
      const calendar = page.getByRole("dialog", { name: "Confirmed bookings month view", exact: true });
      await expect(calendar).toBeVisible();
      expect(await calendar.evaluate(element => element.parentElement === document.body)).toBe(true);
      await calendar.getByRole("button", { name: "Full screen", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Bookings month view", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Bookings month view", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(calendar).toHaveCount(0);
      await page.locator('button[aria-haspopup="dialog"]').click();
      await expect(picker).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
    }
  });
}

for (const width of [390, 1920]) {
  test(`booking date views select a day or a full week at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installMockBackend(page);
    await page.clock.install({ time: new Date("2026-10-15T22:30:00Z") });
    const requests: Array<{ p_start: string; p_end: string }> = [];
    const rows = ["2026-10-15", "2026-10-16", "2026-10-18", "2026-10-19"].map((date, index) => {
      const fixture = dayFixtures(date + "T00:00:00Z");
      return { ...fixture.bookings[0], id: `date-${index}`, customer_name: `Guest ${date}`, created_at: date + "T08:00:00Z", slots: { ...fixture.slots[0], id: `slot-${index}` }, slot_id: `slot-${index}`, tours: { id: TOUR_ID, name: "Harbour paddle" } };
    });
    await page.route("**/rest/v1/rpc/list_operator_bookings*", route => {
      const body = route.request().postDataJSON();
      requests.push(body);
      return fulfillJson(route, rows.filter(row => row.slots.start_time >= body.p_start && row.slots.start_time <= body.p_end));
    });
    const expectRange = async (start: string, end: string) => {
      await expect.poll(() => requests.at(-1)).toMatchObject({ p_start: start, p_end: end });
    };
    await page.goto("/bookings");
    await expectRange("2026-10-15T22:00:00.000Z", "2026-10-16T21:59:59.999Z");
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 3 })).toContainText("16 Oct");
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expectRange("2026-10-11T22:00:00.000Z", "2026-10-18T21:59:59.999Z");
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(3);
    await expect(page.getByRole("heading", { level: 3 }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath("bookings-week.png"), fullPage: true });
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expectRange("2026-10-15T22:00:00.000Z", "2026-10-16T21:59:59.999Z");
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expectRange("2026-10-11T22:00:00.000Z", "2026-10-18T21:59:59.999Z");
    await page.getByRole("button", { name: "Next week", exact: true }).click();
    await expectRange("2026-10-18T22:00:00.000Z", "2026-10-25T21:59:59.999Z");
    await page.getByRole("button", { name: "Previous week", exact: true }).click();
    await expectRange("2026-10-11T22:00:00.000Z", "2026-10-18T21:59:59.999Z");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expectRange("2026-10-15T22:00:00.000Z", "2026-10-16T21:59:59.999Z");
    await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(1);
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expectRange("2026-10-16T22:00:00.000Z", "2026-10-17T21:59:59.999Z");
    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    await expectRange("2026-10-15T22:00:00.000Z", "2026-10-16T21:59:59.999Z");
  });

  test(`roll call contact and manual departure selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installMockBackend(page);
    await page.clock.install({ time: new Date("2026-10-15T05:00:00Z") });
    await page.route("**/rest/v1/rpc/get_operator_dashboard", async route => {
      const body = route.request().postDataJSON();
      const fixture = dayFixtures(body.p_today_start);
      const manifest = [
        { ...fixture.bookings[0], phone: "082 555 0101", slots: { start_time: fixture.slots[0].start_time }, tours: fixture.slots[0].tours, waiver_status: "PENDING" },
        { ...fixture.bookings[1], phone: "invalid phone", slots: { start_time: fixture.slots[0].start_time }, tours: fixture.slots[0].tours },
        { ...fixture.bookings[1], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slot_id: SECOND_SLOT_ID, phone: "0044 7700 900123", customer_name: "Second departure", slots: { start_time: fixture.slots[1].start_time }, tours: fixture.slots[1].tours },
      ];
      await fulfillJson(route, { business_id: body.p_business_id, today_manifest: manifest, tomorrow_manifest: [], revenue: {}, weather_widget_locations: [] });
    });
    await page.goto("/");
    const roll = page.getByRole("region", { name: "Roll Call", exact: true });
    await expect(roll).toContainText("Departure 1 of 2");
    await expect(roll.getByText("waiver needed", { exact: false }).filter({ visible: true })).toBeVisible();
    await expect(roll.getByText("Confirm booking", { exact: false }).filter({ visible: true })).toBeVisible();
    const whatsapp = roll.getByRole("link", { name: /^WhatsApp Alexandra/ });
    await expect(whatsapp).toHaveAttribute("href", "https://wa.me/27825550101");
    await expect(roll.getByRole("link", { name: "WhatsApp Sam Ndlovu" })).toHaveCount(0);
    await expect(whatsapp).toHaveAttribute("target", "_blank");
    await page.context().route("https://wa.me/**", route => fulfillJson(route, { externalNavigation: true }));
    const popupPromise = page.waitForEvent("popup");
    await whatsapp.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL("https://wa.me/27825550101");
    await popup.close();
    // Finish loading the lazy module before advancing its chunk timeout.
    await expect(page.locator('[id^="wg_fwdg_"]')).toBeAttached();
    await page.clock.fastForward(4 * 60 * 60 * 1000);
    await expect(roll).toContainText("Departure 1 of 2");
    await roll.getByRole("button", { name: "Next departure", exact: true }).click();
    await expect(roll).toContainText("Departure 2 of 2");
    await expect(roll.getByRole("link", { name: "WhatsApp Second departure" })).toHaveAttribute("href", "https://wa.me/447700900123");
    await expect(page.getByRole("button", { name: "Follow schedule", exact: true })).toHaveCount(0);
    await roll.getByRole("button", { name: "Previous departure", exact: true }).click();
    await expect(roll).toContainText("Departure 1 of 2");
    await expectNoHorizontalOverflow(page);
    await roll.screenshot({ path: test.info().outputPath("roll-call.png") });
  });
}
