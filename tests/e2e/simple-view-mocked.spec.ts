import { expect, test, type Page, type Route } from "@playwright/test";

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
      "access-control-allow-origin": "http://127.0.0.1:3000",
      "access-control-allow-headers": "authorization, apikey, content-profile, x-client-info",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function installMockBackend(page: Page, state: "populated" | "empty" | "error" = "populated", staffName: string | null = "Taylor Operator") {
  const session = fakeSession();
  const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fixture.supabase.co").hostname.split(".")[0];

  await page.context().addCookies([
    { name: "ck_session_hint", value: "1", url: "http://127.0.0.1:3000" },
    { name: "ck_admin_role", value: "ADMIN", url: "http://127.0.0.1:3000" },
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
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      // A visual fixture must never reach a real server-side mutation.
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
      await fulfillJson(route, { id: ADMIN_ID, role: "ADMIN", business_id: BUSINESS_ID, name: staffName, settings_permissions: {}, suspended: false, read_only: false });
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
    if (url.pathname.endsWith("/rest/v1/bookings")) {
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
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
}

async function resetScroll(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  });
}

test.describe("Simple view mocked responsive acceptance", () => {
  test("renders Today, Calendar, and Check-ins safely across target devices", async ({ page }) => {
    test.setTimeout(120_000);
    await installMockBackend(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/simple");
    await expect(page.getByRole("heading", { name: "Welcome, Taylor Operator" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cape Kayak Co., Simple view" })).toBeVisible();
    await page.screenshot({ path: "/tmp/simple-view-phone-overview.png", fullPage: true });
    await page.getByText("2 bookings", { exact: true }).click();
    await expect(page.getByText("4 of 6 arrived")).toBeVisible();
    await expect(page.getByText("Alexandra van der Merwe-Smith", { exact: false })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Simple view" }).filter({ visible: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await resetScroll(page);
    await page.screenshot({ path: "/tmp/simple-view-phone.png", fullPage: true });

    const tomorrow = await page.evaluate(() => {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + 86_400_000));
      const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${value.year}-${value.month}-${value.day}`;
    });
    await page.goto(`/simple/check-ins?date=${tomorrow}&slot=${SLOT_ID}`);
    await expect(page.getByRole("heading", { name: "Check-ins" })).toBeVisible();
    await expect(page.getByText("4 of 6 arrived")).toBeVisible();
    await expect(page.getByText("Confirm payment received")).toBeVisible();
    await expect(page.getByRole("button", { name: /Confirm R.*received/ })).toBeVisible();
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
    await page.goto(`/simple/check-ins?date=${tomorrow}`);
    await expect(page.getByRole("heading", { name: "Check-ins" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Full dashboard" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "/tmp/simple-view-desktop.png", fullPage: true });
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: "/tmp/simple-view-dark.png", fullPage: true, animations: "disabled" });
    await page.getByRole("link", { name: "Today", exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome, Taylor Operator" })).toBeVisible();
    await page.screenshot({ path: "/tmp/simple-view-dark-today.png", fullPage: true, animations: "disabled" });
  });

  test("uses a neutral welcome when the signed-in staff member has no name", async ({ page }) => {
    await installMockBackend(page, "empty", null);
    await page.goto("/simple");
    await expect(page.getByRole("heading", { name: "Welcome", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cape Kayak Co., Simple view" })).toBeVisible();
  });

  for (const state of ["empty", "error"] as const) {
    test(`keeps the ${state} state readable on a narrow phone`, async ({ page }) => {
      await installMockBackend(page, state);
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto("/simple");
      await expect(page.getByRole("heading", { name: state === "empty" ? "No departures today" : "Today is unavailable" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `/tmp/simple-view-${state}.png`, fullPage: true });
    });
  }
});
