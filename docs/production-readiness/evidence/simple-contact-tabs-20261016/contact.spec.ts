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
    if (url.origin === new URL(baseURL).origin) {
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


test('contact actions open separately across Simple View pages', async ({page, context}) => {
  await installMockBackend(page);
  await page.route('**/api/admin/login', route => fulfillJson(route, {auth_ready:true,admin:{id:ADMIN_ID,role:'ADMIN',business_id:BUSINESS_ID,name:'Synthetic operator',email:'operator@example.test',read_only:false}}));
  await page.route('**/rest/v1/rpc/operator_departure_manifest', route => fulfillJson(route, dayFixtures(new Date().toISOString()).bookings));
  await context.route('https://wa.me/**', route => route.fulfill({contentType:'text/plain',body:'Synthetic WhatsApp destination'}));
  for (const path of ['/simple','/simple/calendar','/simple/check-ins']) {
    await page.goto(path);
    const whatsapp=page.locator('.sv-contact-actions a[href^="https://wa.me/"]').first();
    const call=page.locator('.sv-contact-actions a[href^="tel:"]').first();
    for (const link of [whatsapp,call]) {
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('target','_blank');
      await expect(link).toHaveAttribute('rel','noopener noreferrer');
    }
    const original=page.url();
    const opened=context.waitForEvent('page');
    await whatsapp.click();
    const popup=await opened;
    await expect(popup).toHaveURL(/^https:\/\/wa\.me\//);
    await popup.close();
    expect(page.url()).toBe(original);
  }
});
