import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { sourceExports, sourceFunction, sourceHandler } from "../helpers/source-handler";
import * as lookupRules from "../../supabase/functions/_shared/my-bookings-lookup";

const serviceKey = "fixture-service-not-a-real-key";
const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: serviceKey };
const tokens = sourceExports("supabase/functions/_shared/booking-success.ts", {}, env) as any;
const booking = { id: "booking-a", business_id: "a", status: "PAID", waiver_token: "independent-waiver-secret", email: "guest@fixture.invalid", phone: "27820000000", tours: { id: "tour-a", business_id: "a" }, slots: { business_id: "a" } };

function queryClient(run: (table: string, calls: any[]) => any) {
  const requests: any[] = [];
  const client: any = {
    requests,
    rpc: async (name: string, args: any) => {
      requests.push({ rpc: name, args });
      if (name === "validate_promo_code") return { data: { valid: true, promo_id: "promo-a", code: "FIXTURE", discount_type: "FLAT", discount_value: 0 }, error: null };
      if (name === "reserve_voucher_amount") return { data: { success: true, reserved: 0 }, error: null };
      if (name === "release_voucher_reservations") return { data: null, error: null };
      throw new Error("Unexpected checkout rpc " + name);
    },
    from(table: string) {
      const calls: any[] = [];
      const execute = async () => { requests.push({ table, calls }); return run(table, calls); };
      const q: any = { then: (yes: any, no: any) => execute().then(yes, no), maybeSingle: execute, single: execute };
      for (const method of ["select", "eq", "in", "or", "order", "limit", "update", "insert"]) q[method] = (...args: any[]) => { calls.push([method, ...args]); return q; };
      return q;
    },
  };
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe("R01 signed booking confirmation capability", () => {
  it("is read-only, binds both booking and operator, and expires after 24 hours", async () => {
    const now = 1789000000000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const token = await tokens.issueBookingSuccessToken("booking-a", "a");
    expect(await tokens.verifyBookingSuccessToken(token, "booking-a", "a")).toBe(true);
    expect(await tokens.verifyBookingSuccessToken(token, "booking-b", "a")).toBe(false);
    expect(await tokens.verifyBookingSuccessToken(token, "booking-a", "b")).toBe(false);
    const customer = sourceExports("supabase/functions/_shared/customer-session.ts", {}, env) as any;
    expect((await customer.verifyCustomerSession(token)).valid).toBe(false);
    clock.mockReturnValue(now + tokens.BOOKING_SUCCESS_TTL_MS - 1);
    expect(await tokens.verifyBookingSuccessToken(token, "booking-a", "a")).toBe(true);
    clock.mockReturnValue(now + tokens.BOOKING_SUCCESS_TTL_MS);
    expect(await tokens.verifyBookingSuccessToken(token, "booking-a", "a")).toBe(false);
  });

  it("rejects a changed expiry, changed signature, booking IDs, malformed and different-secret tokens", async () => {
    const token = await tokens.issueBookingSuccessToken("booking-a", "a");
    const [expires, sig] = token.split(".");
    for (const invalid of ["", "booking-a", "..", `${Number(expires) + 1000}.${sig}`, `${expires}.${sig[0] === "a" ? "b" : "a"}${sig.slice(1)}`, `${expires}.%`, `${token}.extra`]) {
      expect(await tokens.verifyBookingSuccessToken(invalid, "booking-a", "a")).toBe(false);
    }
    const rotated = sourceExports("supabase/functions/_shared/booking-success.ts", {}, { ...env, BOOKING_SUCCESS_SECRET: "rotated-fixture-key" }) as any;
    expect(await rotated.verifyBookingSuccessToken(token, "booking-a", "a")).toBe(false);
  });

  it("keeps the capability out of the HTTP query and preserves existing success-URL parameters", async () => {
    const url = new URL(await tokens.bookingSuccessUrl("https://a.fixture.invalid/success?campaign=summer", "booking-a", "a"));
    expect(url.searchParams.get("ref")).toBe("booking-a");
    expect(url.searchParams.get("campaign")).toBe("summer");
    expect(url.searchParams.has("token")).toBe(false);
    expect(await tokens.verifyBookingSuccessToken(new URLSearchParams(url.hash.slice(1)).get("token"), "booking-a", "a")).toBe(true);
  });
});

function confirmationFixture(result: any = booking, error: any = null) {
  const db = queryClient(() => ({ data: result, error }));
  const handler = sourceHandler("supabase/functions/booking-success/index.ts", {
    "../_shared/tenant.ts": { createServiceClient: () => db }, "../_shared/booking-success.ts": tokens,
  }, env);
  return { db, request: (token: string, bookingId = "booking-a", businessId = "a", method = "POST") => handler(new Request("https://fixture.invalid/booking-success", {
    method, headers: { "x-tenant-business-id": businessId, origin: "https://forged.fixture.invalid" },
    ...(method === "POST" ? { body: JSON.stringify({ booking_id: bookingId, token }) } : {}),
  })) };
}

describe("R01 actual confirmation handler", () => {
  it("rejects forged references and cross-tenant/replayed capabilities before any database read", async () => {
    const f = confirmationFixture();
    const token = await tokens.issueBookingSuccessToken("booking-a", "a");
    for (const args of [["booking-a"], [""], [token, "booking-b"], [token, "booking-a", "b"], [token, "booking-a", ""]]) {
      expect((await f.request(...args as [string, string?, string?])).status).toBe(403);
    }
    expect(f.db.requests).toEqual([]);
  });

  it("returns the intended booking using both indexed IDs, with private no-store caching", async () => {
    const f = confirmationFixture();
    const response = await f.request(await tokens.issueBookingSuccessToken("booking-a", "a"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).booking).toMatchObject(booking);
    expect(f.db.requests[0].calls).toContainEqual(["eq", "id", "booking-a"]);
    expect(f.db.requests[0].calls).toContainEqual(["eq", "business_id", "a"]);
    expect(f.db.requests[0].calls[0][1]).not.toContain("waiver_payload");
    expect(f.db.requests[0].calls[0][1]).not.toContain("phone");
  });

  it.each([null, { ...booking, business_id: "b" }, { ...booking, id: "booking-b" }, { ...booking, tours: { business_id: "b" } }, { ...booking, slots: [{ business_id: "b" }] }])("rejects missing or mismatched rows/relations: %s", async result => {
    const response = await confirmationFixture(result).request(await tokens.issueBookingSuccessToken("booking-a", "a"));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(booking.email);
  });

  it("supports preflight, rejects GET, and fails closed on database errors", async () => {
    const f = confirmationFixture(null, { message: "private database detail" });
    expect((await f.request("", undefined, undefined, "OPTIONS")).status).toBe(200);
    expect((await f.request("", undefined, undefined, "GET")).status).toBe(405);
    const res = await f.request(await tokens.issueBookingSuccessToken("booking-a", "a"));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("private database detail");
  });
});

function checkoutFixture(webhookSecret = "fixture-webhook-secret") {
  const db = queryClient((table, calls) => {
    if (table === "bookings") return { data: { ...booking, tour_id: "tour-a", qty: 1, unit_price: 100, total_amount: 100 }, error: null };
    if (table === "tours") return { data: { base_price_per_person: 100 }, error: null };
    if (table === "booking_add_ons") return { data: [], error: null };
    if (table === "pending_reschedules") return { data: { id:"pr-a", diff:50, status:"PENDING", hold_id:"reschedule-hold" }, error:null };
    if (table === "holds") { const reschedule=calls.some((c:any[])=>c[0]==="eq" && c[1]==="id" && c[2]==="reschedule-hold"); return {data:{id:reschedule?"reschedule-hold":"hold-a", status:"ACTIVE", expires_at:new Date(Date.now()+900000).toISOString(),hold_type:reschedule?"RESCHEDULE":"ADD_GUESTS",metadata:{new_qty:2,diff:100}},error:null}; }
    if (table === "vouchers") return { data: [], error: null };
    throw new Error("Unexpected checkout table " + table);
  });

  (db as any).rpc = async (name: string, args: any) => ({ data: name === "save_checkout_request" ? {ok:true,request:{id:"request-a",...args.p_request}} : {ok:true,amount:100}, error:null });
  const auth = sourceExports("supabase/functions/_shared/auth.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({
      auth: { getUser: async (token: string) => ({ data: { user: token.startsWith("admin-") ? { id: token } : null } }) },
      from: () => ({ select: () => ({ eq: (_: string, user: string) => ({ maybeSingle: async () => ({ data: { business_id: user === "admin-b" ? "b" : "a", role: user === "admin-super" ? "SUPER_ADMIN" : "MAIN_ADMIN", suspended: user === "admin-suspended" } }) }) }) }),
    }) },
  }, env);
  const gateway = vi.fn<typeof fetch>(async () => Response.json({ id: "checkout-fixture", redirectUrl: "https://pay.fixture.invalid" }));
  const handler = sourceHandler("supabase/functions/create-checkout/index.ts", {
    "../_shared/auth.ts": auth, "../_shared/booking-success.ts": tokens,
    "../_shared/subscription.ts": { blockIfNotTrading: async () => null },
    "../_shared/tenant.ts": {
      createServiceClient: () => db,
      getTenantByBusinessId: async () => ({ business: { id: "a" }, credentials: { activeYocoSecretKey: "fixture-provider-key", yocoSecretKey: "fixture-provider-key", yocoWebhookSecret: webhookSecret } }),
      getBusinessAllowedOrigins: () => ["https://a.fixture.invalid"], isAllowedOrigin: () => true,
      resolveBusinessSiteUrls: () => ({ bookingSuccessUrl: "https://a.fixture.invalid/success", bookingCancelUrl: "https://a.fixture.invalid/cancel" }),
    },
  }, env, gateway);
  return { db, gateway, request: (authToken = "public-anon", body: any = {}) => handler(new Request("https://fixture.invalid/create-checkout", {
    method: "POST", headers: { authorization: "Bearer " + authToken }, body: JSON.stringify({ booking_id: "booking-a", amount: 100, skip_notifications: true, ...body }),
  })) };
}

describe("R01 confirmation issuance must not bypass booking ownership", () => {
  it("does not create a payment when the saved checkout mode has no webhook secret", async () => {
    const f = checkoutFixture("");
    const response = await f.request("admin-a");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "BUSINESS_PAYMENT_CONFIG_MISSING" });
    expect(f.gateway).not.toHaveBeenCalled();
  });
  it.each(["public-anon", "forged-service-role-jwt", "admin-b", "admin-suspended"])("denies %s before payment, pricing writes or token issuance", async auth => {
    const f = checkoutFixture();
    const res = await f.request(auth, { booking_token: "booking-a", type: "ADD_GUESTS" });
    expect(res.status).toBe(403);
    expect(f.gateway).not.toHaveBeenCalled();
    expect(f.db.requests).toHaveLength(1);
    expect(f.db.requests[0].calls.some((c: any[]) => ["update", "insert"].includes(c[0]))).toBe(false);
  });

  it.each([["public-anon", "BOOKING"], [serviceKey, "BOOKING"], ["admin-a", "BOOKING"], ["admin-super", "BOOKING"]])("preserves authorized %s %s checkout and issues the correctly scoped redirect", async (auth, type) => {
    const f = checkoutFixture();
    const res = await f.request(auth, { type, ...(auth === "public-anon" ? { booking_token: booking.waiver_token } : {}) });
    expect(res.status).toBe(200);
    expect((await res.json()).redirectUrl).toBe("https://pay.fixture.invalid");
    const payment = JSON.parse(String(f.gateway.mock.calls[0][1]?.body));
    expect(payment.amount).toBe(10000);
    const url = new URL(payment.successUrl);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    expect(await tokens.verifyBookingSuccessToken(token, "booking-a", "a")).toBe(true);
    expect(await tokens.verifyBookingSuccessToken(token, "booking-a", "b")).toBe(false);
  });

  // R12: uplifts derive their charge server-side (pending_reschedules.diff for
  // RESCHEDULE, qty-delta x unit_price for ADD_GUESTS) — never the caller amount.
  it.each([[serviceKey, "RESCHEDULE", { pending_reschedule_id: "pr-a" }, 5000], [serviceKey, "ADD_GUESTS", { hold_id: "hold-a", new_qty: 2 }, 10000]])("prices authorized %s %s uplift from server records, not caller amount", async (auth, type, extra, expectedCents) => {
    const f = checkoutFixture();
    const res = await f.request(auth, { type, amount: 1, ...extra });
    expect(res.status).toBe(200);
    const payment = JSON.parse(String(f.gateway.mock.calls[0][1]?.body));
    expect(payment.amount).toBe(expectedCents);
  });

  it("routes WhatsApp payment redirects through guarded checkout issuance", () => {
    const wa = readFileSync("supabase/functions/wa-webhook/index.ts", "utf8");
    expect(wa).not.toContain('fetch("https://payments.yoco.com/api/checkouts"');
    expect(wa).toContain('"/functions/v1/create-checkout"');
    expect(wa).not.toMatch(/successUrl: withQuery\([^\n]+\{ ref:/);
    expect(wa).not.toContain('console.log("YOCO:" + JSON.stringify(yocoData))');
    expect(readFileSync("booking/app/lib/booking-checkout.ts", "utf8")).toContain("booking_token: input.bookingToken");
  });
});

describe("R01 success-page and verified payment polling compatibility", () => {
  function pageLoader(result: any, extra: any = {}) {
    const state: any = {};
    const invoke = vi.fn(async (name: string) => name === "booking-success" ? result : {});
    const setters = Object.fromEntries(["Booking", "Loading", "OtherTours", "Notice"].map(name => ["set" + name, (value: any) => { state[name] = value; }]));
    const bindings = {
      ref: "booking-a", theme: { id: "a" }, token: "fixture-token", amendmentId:null, active: true, timer: undefined,
      tenantSupabase: { functions: { invoke } }, supabase: { functions: { invoke } }, ...setters, ...extra,
    };
    return { state, invoke, load: sourceFunction("booking/app/success/page.tsx", "loadConfirmation", bindings) };
  }

  it("loads a valid paid confirmation and retains the existing delivery fallback", async () => {
    const f = pageLoader({ data: { booking: { ...booking, tours: null } } });
    await f.load();
    expect(f.state.Booking).toMatchObject({ id: "booking-a", business_id: "a", status: "PAID" });
    expect(f.invoke).toHaveBeenCalledWith("confirm-booking", { body: { booking_id: "booking-a", booking_token: booking.waiver_token } });
    expect(f.state.Loading).toBe(false);
  });

  it.each([{ ...booking, business_id: "b" }, { ...booking, id: "booking-b" }, null])("rejects wrong-operator/reference responses and failed lookups: %s", async result => {
    const f = pageLoader({ data: { booking: result } });
    await f.load();
    expect(f.state.Booking).toBeNull();
    expect(f.state.Notice).toContain("couldn't load");
    expect(f.invoke).not.toHaveBeenCalledWith("confirm-booking", expect.anything());
  });

  it("offers verified My Bookings for old reference-only links without a private lookup", async () => {
    const f = pageLoader({}, { token: null });
    await f.load();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.state.Notice).toContain("sign in to My Bookings");
  });

  it("does not announce payment success before webhook confirmation, and bounds retries", async () => {
    const schedule = vi.fn();
    const f = pageLoader({ data: { booking: { ...booking, status: "HELD" } } }, { setTimeout: schedule });
    await f.load();
    expect(f.state.Booking).toBeNull();
    expect(f.state.Notice).toContain("not yet confirmed");
    expect(schedule).toHaveBeenCalledOnce();
    await f.load(30);
    expect(schedule).toHaveBeenCalledOnce();
    expect(f.invoke).not.toHaveBeenCalledWith("confirm-booking", expect.anything());
  });

  it("ignores completed requests after the success page is unmounted", async () => {
    const f = pageLoader({ data: { booking } }, { active: false });
    await f.load();
    expect(f.state.Booking).toBeNull();
    expect(f.invoke).toHaveBeenCalledTimes(1);
  });

  it("payment polling passes customer proof and never queries bookings using a reference header", async () => {
    let poll: () => Promise<void> = async () => {};
    const invoke = vi.fn(async () => ({ data: { bookings: [{ ...booking, last_amendment_id: "amendment-a" }] } }));
    const pollRef = { current: null as any };
    const showToast = vi.fn();
    const start = sourceFunction("booking/app/my-bookings/page.tsx", "startPaymentPolling", {
      theme: { id: "a" }, email: booking.email, authSession: false, dialCode: "+27", phoneDigits: "820000000",
      normalizePhone: () => booking.phone, localStorage: { getItem: () => "verified-customer-session" },
      supabase: { functions: { invoke } }, setPaymentPending: vi.fn(), paymentPollRef: pollRef,
      setInterval: (fn: any) => { poll = fn; return 9; }, clearInterval: vi.fn(), showToast, reloadAfterAction: vi.fn(),
    });
    start("booking-a", "amendment-a");
    await poll();
    expect(invoke).toHaveBeenCalledWith("my-bookings-lookup", { body: {
      booking_id: "booking-a", business_id: "a", customer_session: "verified-customer-session", email: booking.email, emailOnly: false, phone_tail: "820000000",
    } });
    expect(showToast).toHaveBeenCalledOnce();
    expect(pollRef.current).toBeNull();
  });

  it("specific-booking polling keeps the lookup handler's verified email AND tenant restrictions", async () => {
    const db = { ...queryClient((table, calls) => {
      if (table === "businesses") return { data: [{ id: "a", booking_site_url: "https://a.fixture.invalid" }], error: null };
      expect(calls).toContainEqual(["eq", "business_id", "a"]);
      expect(calls).toContainEqual(["eq", "email", booking.email]);
      expect(calls).toContainEqual(["eq", "id", "booking-a"]);
      return { data: [booking, { ...booking, business_id: "b" }, { ...booking, email: "another@fixture.invalid" }], error: null };
    }), auth: { getUser: async () => ({ data: { user: null } }) } };
    const handler = sourceHandler("supabase/functions/my-bookings-lookup/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
      "../_shared/my-bookings-lookup.ts": lookupRules, "../_shared/tenant.ts": {}, "../_shared/otp-attempts.ts": {},
      "../_shared/customer-session.ts": { verifyCustomerSession: async (token: string) => token === "verified-session" ? { valid: true, email: booking.email, businessId: "a" } : { valid: false } },
    }, env);
    const request = (token: string) => handler(new Request("https://fixture.invalid/my-bookings-lookup", {
      method: "POST", headers: { origin: "https://a.fixture.invalid", authorization: "Bearer public-anon" },
      body: JSON.stringify({ booking_id: "booking-a", customer_session: token, phone_tail: "820000000" }),
    }));
    expect((await request("forged-session")).status).toBe(401);
    expect(db.requests.some(q => q.table === "bookings")).toBe(false);
    expect((await (await request("verified-session")).json()).bookings).toEqual([booking]);
  });
});
