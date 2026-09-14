import * as voucherBalances from "../../supabase/functions/_shared/voucher-balances";
import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceFunction, sourceHandler } from "../helpers/source-handler";

const webhookFile = "supabase/functions/yoco-webhook/index.ts";

function referenceCheck(overrides: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = {
    bookings: [
      { id: "booking-a", business_id: "a", slot_id: "slot-a", yoco_checkout_id: "checkout-a", yoco_mode: "live" },
      { id: "booking-b", business_id: "b", slot_id: "slot-b", yoco_checkout_id: "checkout-b", yoco_mode: "live" },
    ],
    pending_reschedules: [
      { id: "pending-a", booking_id: "booking-a", business_id: "a", yoco_checkout_id: "reschedule-a", yoco_mode: "live" },
      { id: "pending-b", booking_id: "booking-b", business_id: "b", yoco_checkout_id: "reschedule-b", yoco_mode: "live" },
    ],
    holds: [
      { id: "hold-a", booking_id: "booking-a", slot_id: "slot-a", metadata: { yoco_checkout_id: "guests-a", yoco_mode: "live" } },
      { id: "hold-b", booking_id: "booking-b", slot_id: "slot-b", metadata: { yoco_checkout_id: "guests-b", yoco_mode: "live" } },
    ],
    vouchers: [{ id: "voucher-a", business_id: "a", yoco_checkout_id: "gift-a", value: 500, yoco_mode: "live" }],
    combo_settlements: [{ id: "settlement-a", owed_business_id: "a", yoco_checkout_id: "settlement-checkout-a", amount_owed: 500 }],
    ...overrides,
  };
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        maybeSingle: async () => ({ data: (tables[table] || []).find(row => filters.every(([key, value]) => row[key] === value)) || null, error: null }),
      };
      return query;
    },
  };
  return sourceFunction(webhookFile, "validateWebhookReferences", { supabase: db });
}

const payment = (metadata: any, overrides: any = {}) => ({ amount: 50000, currency: "ZAR", mode: "live", metadata, ...overrides });

describe("Yoco merchant and checkout binding", () => {
  it.each(["a", "b"])("accepts the stored checkout for merchant %s", async business => {
    expect(await referenceCheck()("checkout-" + business, payment({ type: "BOOKING", booking_id: "booking-" + business }), business)).toBe(true);
  });

  it("rejects a valid merchant's event containing another merchant's checkout", async () => {
    expect(await referenceCheck()("checkout-b", payment({ booking_id: "booking-a" }), "a")).toBe(false);
  });

  it("rejects metadata booking references outside the signing merchant", async () => {
    expect(await referenceCheck()("checkout-b", payment({ booking_id: "booking-b" }), "a")).toBe(false);
  });

  it("does not apply test events to live checkouts", async () => {
    expect(await referenceCheck()("checkout-a", payment({ booking_id: "booking-a" }, { mode: "test" }), "a")).toBe(false);
  });

  it("accepts an uplift on its stored pending reschedule", async () => {
    expect(await referenceCheck()("reschedule-a", payment({ type: "RESCHEDULE", booking_id: "booking-a", pending_reschedule_id: "pending-a" }), "a")).toBe(true);
  });

  it("rejects an unrelated pending reschedule even with an authorized booking", async () => {
    expect(await referenceCheck()("reschedule-a", payment({ type: "RESCHEDULE", booking_id: "booking-a", pending_reschedule_id: "pending-b" }), "a")).toBe(false);
  });

  it("accepts an add-guests payment for that booking's hold", async () => {
    expect(await referenceCheck()("guests-a", payment({ type: "ADD_GUESTS", booking_id: "booking-a", hold_id: "hold-a", new_qty: 3 }), "a")).toBe(true);
  });

  it("rejects a foreign hold and a checkout from another uplift", async () => {
    const check = referenceCheck();
    expect(await check("guests-a", payment({ type: "ADD_GUESTS", booking_id: "booking-a", hold_id: "hold-b", new_qty: 3 }), "a")).toBe(false);
    expect(await check("other-checkout", payment({ type: "ADD_GUESTS", booking_id: "booking-a", hold_id: "hold-a", new_qty: 3 }), "a")).toBe(false);
  });

  it.each(["DEPOSIT_50", "SPLIT_100", "ADD_PEOPLE", "invented"])("rejects unsupported payment type %s", async type => {
    expect(await referenceCheck()("checkout-a", payment({ type, booking_id: "booking-a" }), "a")).toBe(false);
  });

  it("checks gift and settlement cash amounts and currency", async () => {
    const check = referenceCheck();
    for (const [checkout, metadata] of [
      ["gift-a", { type: "GIFT_VOUCHER", voucher_id: "voucher-a" }],
      ["settlement-checkout-a", { type: "COMBO_SETTLEMENT", settlement_id: "settlement-a", business_id: "a" }],
    ] as const) {
      expect(await check(checkout, payment(metadata), "a")).toBe(true);
      expect(await check(checkout, payment(metadata, { amount: 100 }), "a")).toBe(false);
      expect(await check(checkout, payment(metadata, { currency: "USD" }), "a")).toBe(false);
    }
  });

  it("rejects settlement links containing another operator pair's combo", async () => {
    const check = referenceCheck({
      combo_settlements: [{ id: "settlement-a", owed_business_id: "a", collector_business_id: "b", yoco_checkout_id: "settlement-checkout-a", amount_owed: 500, combo_booking_ids: ["combo-foreign"] }],
      combo_bookings: [{ id: "combo-foreign", combo_offers: { business_a_id: "c", business_b_id: "d" }, combo_booking_items: [] }],
    });
    expect(await check("settlement-checkout-a", payment({ type: "COMBO_SETTLEMENT", settlement_id: "settlement-a" }), "a")).toBe(false);
  });

  it("accepts only the owed operator's legs of a multi-operator settlement", async () => {
    const check = referenceCheck({
      combo_settlements: [{ id: "settlement-a", owed_business_id: "a", collector_business_id: "b", yoco_checkout_id: "settlement-checkout-a", amount_owed: 500, combo_booking_ids: ["combo-own"] }],
      combo_bookings: [{ id: "combo-own", combo_offers: { business_a_id: "b" }, combo_booking_items: [{ business_id: "a", position: 2 }, { business_id: "b", position: 1 }, { business_id: "c", position: 3 }] }],
    });
    expect(await check("settlement-checkout-a", payment({ type: "COMBO_SETTLEMENT", settlement_id: "settlement-a" }), "a")).toBe(true);
  });
});

describe("Yoco environment selection", () => {
  it("does not fall back to live charging when test credentials are missing", async () => {
    const credentials = sourceExports("supabase/functions/_shared/tenant.ts", {
      "https://esm.sh/@supabase/supabase-js@2": {}, "./pagination.ts": {},
    }, { SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-".repeat(2) }).getBusinessCredentials as (db: any, businessId: string) => Promise<any>;
    const db = { rpc: async () => ({ data: { yoco_test_mode: true, yoco_secret_key: "sk_live_fixture", yoco_webhook_secret: "live-hook" }, error: null }) };
    expect(await credentials(db, "a")).toMatchObject({ activeYocoSecretKey: "", activeYocoWebhookSecret: "" });
  });

  it.each([
    [false, "sk_test_misfiled", "sk_test_fixture", "live-hook", "test-hook", ""],
    [true, "sk_live_fixture", "sk_live_misfiled", "live-hook", "test-hook", ""],
    [false, "sk_live_fixture", "sk_test_fixture", "", "test-hook", ""],
    [true, "sk_live_fixture", "sk_test_fixture", "live-hook", "", ""],
    [false, "sk_live_fixture", "sk_test_fixture", "live-hook", "test-hook", "sk_live_fixture"],
    [true, "sk_live_fixture", "sk_test_fixture", "live-hook", "test-hook", "sk_test_fixture"],
  ])("enables checkout only with matching credentials: test=%s, key=%s/%s", async (mode, live, test, liveHook, testHook, expected) => {
    const credentials = sourceExports("supabase/functions/_shared/tenant.ts", {
      "https://esm.sh/@supabase/supabase-js@2": {}, "./pagination.ts": {},
    }, { SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-".repeat(2) }).getBusinessCredentials as (db: any, businessId: string) => Promise<any>;
    const db = { rpc: async () => ({ data: { yoco_test_mode: mode, yoco_secret_key: live, yoco_test_secret_key: test, yoco_webhook_secret: liveHook, yoco_test_webhook_secret: testHook }, error: null }) };
    const result = await credentials(db, "a");
    expect(result.activeYocoSecretKey).toBe(expected);
    if (live === "sk_test_misfiled") expect(result.yocoSecretKey).toBe("");
    if (test === "sk_live_misfiled") expect(result.yocoTestSecretKey).toBe("");
  });

  it("verifies delayed live payments with their live secret after switching to test", async () => {
    const verify = sourceFunction(webhookFile, "verifyWebhookSignature", {
      supabase: {},
      getTenantByBusinessId: async () => ({ credentials: { activeYocoWebhookSecret: "test-hook", yocoWebhookSecret: "live-hook", yocoTestWebhookSecret: "test-hook" } }),
      Webhook: class {
        constructor(private secret: string) {}
        verify(_body: string, headers: any) { if (headers["webhook-signature"] !== this.secret) throw new Error("bad signature"); }
      },
    });
    const request = new Request("https://fixture.invalid", { headers: { "webhook-signature": "live-hook" } });
    await expect(verify(request, "{}", "a", "payment.succeeded", "live")).resolves.toBeUndefined();
    await expect(verify(request, "{}", "a", "payment.succeeded", "test")).rejects.toThrow("bad signature");
  });
});

it("refuses ambiguous WhatsApp merchant mappings before choosing credentials or a fallback tenant", async () => {
  const scan = vi.fn();
  const tenant = sourceExports("supabase/functions/_shared/tenant.ts", {
    "https://esm.sh/@supabase/supabase-js@2": {}, "./pagination.ts": { fetchAllRows: scan },
  }, { SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-".repeat(2) });
  const lookup: any = { select: () => lookup, eq: () => lookup, maybeSingle: async () => ({ data: null, error: { message: "multiple rows" } }) };
  const rpc = vi.fn();
  await expect((tenant.resolveTenantByWhatsappPayload as any)({ from: () => lookup, rpc }, {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "12345" } } }] }],
  })).rejects.toThrow("WhatsApp operator lookup failed");
  expect(rpc).not.toHaveBeenCalled();
  expect(scan).not.toHaveBeenCalled();
});

it("WhatsApp issues payment through authenticated shared checkout, preserving server validation", async () => {
  const fetch = vi.fn(async (_url: string, _init: any) => Response.json({ id: "checkout-a", redirectUrl: "https://payments.invalid/a" }));
  const checkout = sourceFunction("supabase/functions/wa-webhook/index.ts", "requestCheckout", {
    SUPABASE_URL: "https://fixture.invalid", SUPABASE_KEY: "fixture-service", fetch,
  });
  await expect(checkout({ booking_id: "booking-a", type: "BOOKING", amount: 100 })).resolves.toHaveProperty("redirectUrl");
  expect(fetch.mock.calls[0][0]).toBe("https://fixture.invalid/functions/v1/create-checkout");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ booking_id: "booking-a", type: "BOOKING", skip_notifications: true });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer fixture-service");
});

it("routes every WhatsApp batch change and message to its own operator, including status callbacks", async () => {
  const process = vi.fn();
  const resolve = vi.fn(async (_db: any, body: any) => ({ business: { id: body.entry[0].changes[0].value.metadata.phone_number_id } }));
  const batch = sourceFunction("supabase/functions/wa-webhook/index.ts", "processWhatsappBatch", {
    supabase: {}, resolveTenantByWhatsappPayload: resolve, processWhatsappValue: process,
  });
  const valueA = { metadata: { phone_number_id: "a" }, messages: [{ id: "a1" }, { id: "a2" }], statuses: [{ id: "status-a" }] };
  const valueB = { metadata: { phone_number_id: "b" }, messages: [{ id: "b1" }] };
  await batch({ entry: [{ changes: [{ value: valueA }] }, { changes: [{ value: valueB }] }] });
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(process.mock.calls.map(([tenant, _value, message]) => [tenant.business.id, message?.id || "statuses"])).toEqual([
    ["a", "statuses"], ["a", "a1"], ["a", "a2"], ["b", "b1"],
  ]);
});

describe("Guest-change checkout contract", () => {
  function addGuestsFixture(checkoutStatus = 200) {
    const writes: any[] = [];
    const fetch = vi.fn(async (_url: string, _init: any) => Response.json(checkoutStatus === 200
      ? { redirectUrl: "https://payments.invalid/extra-guests" } : { error: "PAYMENT_CONFIG_MISSING" }, { status: checkoutStatus }));
    const db = {
      rpc: async () => ({ data: { ok: true, hold_id: "hold-a" }, error: null }),
      from(table: string) {
        const query: any = {
          eq: () => query,
          update: (data: any) => { writes.push({ table, data }); return query; },
          insert: (data: any) => { writes.push({ table, data }); return query; },
          then: (resolve: any) => resolve({ error: null }),
        };
        return query;
      },
    };
    const handle = sourceFunction("supabase/functions/rebook-booking/index.ts", "handleAddGuests", {
      supabase: db, isUnpaidBooking: () => false, fetch,
      SUPABASE_URL: "https://fixture.invalid", SUPABASE_KEY: "fixture-service",
      ok: (_req: any, data: any) => Response.json(data),
      fail: (_req: any, error: string, status: number) => Response.json({ error }, { status }),
    });
    return { writes, fetch, call: (new_qty: number) => handle({}, { id: "booking-a", business_id: "a", slot_id: "slot-a", qty: 2, unit_price: 500, total_amount: 1000, status: "PAID" }, { new_qty }) };
  }

  it("keeps paid guests unchanged until the typed hold's uplift is paid", async () => {
    const f = addGuestsFixture();
    expect(await (await f.call(3)).json()).toMatchObject({ ok: true, diff: 500, payment_url: "https://payments.invalid/extra-guests" });
    expect(f.writes.some(write => write.table === "bookings")).toBe(false);
    expect(f.writes.some(write => write.table === "holds")).toBe(false);
    expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toMatchObject({ type: "ADD_GUESTS", hold_id: "hold-a", booking_id: "booking-a", new_qty: 3, amount: 500 });
  });

  it("reports checkout failure instead of claiming guests were added", async () => {
    const f = addGuestsFixture(503);
    expect((await f.call(3)).status).toBe(502);
    expect(f.writes.some(write => write.table === "bookings")).toBe(false);
  });

  it("rejects fractional guest quantities before reserving capacity", async () => {
    const f = addGuestsFixture();
    expect((await f.call(2.5)).status).toBe(400);
    expect(f.writes).toEqual([]);
    expect(f.fetch).not.toHaveBeenCalled();
  });
});

async function upliftFixture(type: string, eventType = "payment.succeeded", confirmationError = "") {
  const calls: any[] = [];
  const booking = { id: "booking-a", business_id: "a", slot_id: "slot-a", qty: 2, unit_price: 500, total_amount: 1000, total_captured: 1000, status: "PAID", waiver_status: "PENDING", yoco_checkout_id: "base-checkout" };
  const hold = { id: "hold-a", booking_id: booking.id, slot_id: booking.slot_id, qty: 1, metadata: { yoco_checkout_id: "uplift-checkout", yoco_mode: "live" } };
  const pending = { id: "pending-a", booking_id: booking.id, business_id: "a", status: "PENDING", hold_id: hold.id, yoco_checkout_id: "uplift-checkout", yoco_mode: "live", diff: 500 };
  const rows: any = { bookings: booking, holds: hold, pending_reschedules: pending };
  const db = {
    from(table: string) {
      let insert: any;
      const finish = async () => {
        if (insert) calls.push({ table, insert });
        return { data: rows[table] || null, error: null };
      };
      const query: any = {
        select: () => query, eq: () => query, single: finish, maybeSingle: finish,
        insert: (value: any) => { if (table !== "logs") throw new Error("Unexpected financial insert"); insert = value; return query; },
        update: () => { throw new Error("Financial updates must be inside the RPC"); },
        then: (yes: any, no: any) => finish().then(yes, no),
      };
      return query;
    },
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "claim_yoco_payment") return { data: "claimed", error: null };
      if (name === "confirm_booking_uplift") return { data: confirmationError ? { ok: false, error: confirmationError } : { ok: true }, error: null };
      if (name === "finish_yoco_payment") return { data: null, error: null };
      throw new Error("Unexpected RPC: " + name);
    },
  };
  const handler = sourceHandler(webhookFile, {
    "../_shared/voucher-balances.ts": voucherBalances,
    "../_shared/tenant.ts": { createServiceClient: () => db, getTenantByBusinessId: async () => ({ business: { id: "a" }, credentials: { yocoWebhookSecret: "fixture-hook" } }), getBusinessDisplayName: () => "A" },
    "../_shared/waiver.ts": {}, "../_shared/combo.ts": {},
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: any) => fn },
    "npm:standardwebhooks": { Webhook: class { verify() {} } },
  }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" });
  const response = await handler(new Request("https://fixture.invalid/yoco", { method: "POST", body: JSON.stringify({
    type: eventType, payload: { id: "uplift-payment", mode: "live", amount: 50000, currency: "ZAR", metadata: {
      checkoutId: "uplift-checkout", type, booking_id: booking.id, hold_id: hold.id,
      ...(type === "RESCHEDULE" ? { pending_reschedule_id: pending.id } : { new_qty: 3 }),
    } },
  }) }));
  return { response, calls, booking };
}

it.each(["ADD_GUESTS", "RESCHEDULE"])("settles %s through one financial RPC before finishing the event", async type => {
  const { response, calls, booking } = await upliftFixture(type);
  expect(response.status).toBe(200);
  expect(calls.filter(call => call.name === "confirm_booking_uplift")).toHaveLength(1);
  expect(calls.find(call => call.name === "claim_yoco_payment").args.p_key).toBe("yoco_payment:a:live:uplift-payment");
  expect(calls.find(call => call.name === "confirm_booking_uplift").args).toMatchObject({ p_booking_id: booking.id, p_checkout_id: "uplift-checkout", p_captured_cents: 50000, p_currency: "ZAR" });
  expect(calls.findIndex(call => call.name === "confirm_booking_uplift")).toBeLessThan(calls.findIndex(call => call.name === "finish_yoco_payment"));
});

it.each(["ADD_GUESTS", "RESCHEDULE"])("keeps %s reservations retryable after a failed payment attempt", async type => {
  const { response, calls } = await upliftFixture(type, "payment.failed");
  expect(response.status).toBe(200);
  expect(calls.filter(call => call.name)).toEqual([]);
  expect(calls).toHaveLength(1);
  expect(calls[0].table).toBe("logs");
});

it.each(["ADD_GUESTS", "RESCHEDULE"])("does not acknowledge an uncommitted %s payment", async type => {
  const { response, calls } = await upliftFixture(type, "payment.succeeded", "no_capacity");
  expect(response.status).toBe(503);
  expect(calls.find(call => call.name === "finish_yoco_payment").args.p_ok).toBe(false);
  expect(calls.filter(call => call.table === "logs")).toEqual([]);
});

function otherPaymentFixture(type: "GIFT_VOUCHER" | "COMBO" | "COMBO_SETTLEMENT", failTable = "", comboOk = true) {
  const calls: any[] = [];
  const rows: Record<string, any[]> = {
    bookings: [{ id: "booking-a", business_id: "a", yoco_checkout_id: "checkout-a" }],
    vouchers: type === "GIFT_VOUCHER" ? [{ id: "voucher-a", business_id: "a", yoco_checkout_id: "checkout-a", value: 500, status: "PENDING" }] : [],
    combo_bookings: [{ id: "combo-a", yoco_checkout_id: "checkout-a", combo_total: 500, payment_status: "PENDING", combo_offers: { business_a_id: type === "COMBO" ? "a" : "b", business_b_id: "a" }, combo_booking_items: [] }],
    combo_settlements: [{ id: "settlement-a", owed_business_id: "a", collector_business_id: "b", yoco_checkout_id: "checkout-a", amount_owed: 500, status: "PENDING_PAYMENT", combo_booking_ids: ["combo-a"] }],
    combo_booking_items: [],
  };
  const db = {
    from(table: string) {
      let patch: any, insert: any;
      const filters: [string, unknown][] = [];
      const execute = async (single: boolean) => {
        const selected = (rows[table] || []).filter(row => filters.every(([key, value]) => row[key] === value));
        if (patch || insert) calls.push({ table, patch, insert });
        if (patch && table === failTable) return { data: null, error: { message: "Temporary update error" } };
        if (patch) selected.forEach(row => Object.assign(row, patch));
        return { data: single ? selected[0] || null : selected, error: null };
      };
      const query: any = {
        select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        is: () => query, insert: (value: any) => { insert = value; return query; }, update: (value: any) => { patch = value; return query; },
        maybeSingle: () => execute(true), single: () => execute(true), then: (yes: any, no: any) => execute(false).then(yes, no),
      };
      return query;
    },
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "claim_yoco_payment") return { data: "claimed", error: null };
      if (name === "finish_yoco_payment") return { data: null, error: null };
      throw new Error("Unexpected RPC: " + name);
    },
  };
  const handler = sourceHandler(webhookFile, {
    "../_shared/voucher-balances.ts": voucherBalances,
    "../_shared/tenant.ts": { createServiceClient: () => db, getTenantByBusinessId: async () => ({ business: { id: "a" }, credentials: { yocoWebhookSecret: "fixture-hook" } }), formatTenantDate: () => "date" },
    "../_shared/waiver.ts": {}, "../_shared/combo.ts": { confirmComboAndNotify: async () => ({ ok: comboOk, bookingsConfirmed: comboOk ? 2 : 0 }) },
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: any) => fn }, "npm:standardwebhooks": { Webhook: class { verify() {} } },
  }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" }, async () => Response.json({ ok: true }));
  const metadata = type === "GIFT_VOUCHER" ? { voucher_id: "voucher-a" }
    : type === "COMBO" ? { booking_id: "booking-a", combo_booking_id: "combo-a" } : { settlement_id: "settlement-a", business_id: "a" };
  return {
    calls, rows,
    call: () => handler(new Request("https://fixture.invalid/yoco", { method: "POST", body: JSON.stringify({
      type: "payment.succeeded", payload: payment({ type, checkoutId: "checkout-a", ...metadata }, { id: "payment-a" }),
    }) })),
  };
}

it("does not complete a gift payment when voucher activation failed", async () => {
  const f = otherPaymentFixture("GIFT_VOUCHER", "vouchers");
  expect((await f.call()).status).toBe(503);
  expect(f.rows.vouchers[0].status).toBe("PENDING");
  expect(f.calls.find(call => call.name === "finish_yoco_payment").args.p_ok).toBe(false);
});

it("activates the fully funded own-operator gift and completes its lease", async () => {
  const f = otherPaymentFixture("GIFT_VOUCHER");
  expect((await f.call()).status).toBe(200);
  expect(f.rows.vouchers[0]).toMatchObject({ status: "ACTIVE", current_balance: 500 });
  expect(f.calls.find(call => call.name === "finish_yoco_payment").args.p_ok).toBe(true);
});

it("retries a combo payment when atomic multi-leg confirmation fails", async () => {
  const f = otherPaymentFixture("COMBO", "", false);
  expect((await f.call()).status).toBe(503);
  expect(f.calls.find(call => call.name === "finish_yoco_payment").args.p_ok).toBe(false);
});

it("keeps settlement payment retryable when a leg update fails", async () => {
  const f = otherPaymentFixture("COMBO_SETTLEMENT", "combo_bookings");
  expect((await f.call()).status).toBe(503);
  expect(f.rows.combo_settlements[0].status).toBe("PENDING_PAYMENT");
  expect(f.calls.find(call => call.name === "finish_yoco_payment").args.p_ok).toBe(false);
});

it("marks a settlement complete only after its own operator's legs", async () => {
  const f = otherPaymentFixture("COMBO_SETTLEMENT");
  expect((await f.call()).status).toBe(200);
  const legUpdate = f.calls.findIndex(call => call.table === "combo_bookings" && call.patch);
  const settlementUpdate = f.calls.findIndex(call => call.table === "combo_settlements" && call.patch);
  expect(legUpdate).toBeGreaterThan(-1);
  expect(settlementUpdate).toBeGreaterThan(legUpdate);
  expect(f.rows.combo_settlements[0].status).toBe("PAID");
});
