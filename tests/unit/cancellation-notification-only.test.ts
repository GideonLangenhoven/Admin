import * as jsx from "react/jsx-runtime";
import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceFunction, sourceHandler } from "../helpers/source-handler";

const booking = {
  id: "10000000-0000-4000-8000-000000000001", business_id: "tenant-a", customer_name: "Synthetic Guest",
  email: "synthetic@example.invalid", phone: "27825550100", status: "PAID", source: "WEB", qty: 2,
  refund_status: "ACTION_REQUIRED", refund_amount: 900, cancellation_self_service: false,
  tours: { name: "Synthetic trip" }, slots: { start_time: "2099-10-21T16:00Z" },
};
function query(result: any, filters: any[] = []) {
  const chain: any = {};
  for (const name of ["select", "update", "insert", "eq", "in", "not", "gt", "order", "limit"]) {
    chain[name] = (...args: any[]) => { filters.push([name, ...args]); return chain; };
  }
  chain.single = chain.maybeSingle = async () => result;
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}
function cancelFixture(single = false, source = "WEB") {
  const rpc = vi.fn(async (_name, args) => ({ data: { ok: true, is_paid: true, refund_amount: 900, refund_action_required: args.p_offer_choice, late_forfeit: false } }));
  const wa = vi.fn(async () => undefined);
  const emails: any[] = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "admin-a" } } }) }, rpc,
    from: (table: string) => query({ data: table === "admin_users" ? { business_id: "tenant-a", role: "MAIN_ADMIN" } : table === "bookings" ? single ? { ...booking, source } : [{ ...booking, source }] : null }),
  };
  const handler = sourceHandler(`supabase/functions/${single ? "cancel-booking" : "weather-cancel"}/index.ts`, {
    "../_shared/tenant.ts": {
      createServiceClient: () => db, getTenantByBusinessId: async () => ({ business: { id: "tenant-a" } }),
      getBusinessDisplayName: () => "Synthetic operator", sendWhatsappWithWindowReopen: wa,
      resolveManageBookingsUrl: () => "https://synthetic.invalid/my-bookings", getAdminAppOrigins: () => ["https://synthetic.invalid"],
      isAllowedOrigin: () => true, formatTenantDateTime: () => "21 Oct 2099",
    },
    "../_shared/auth.ts": {
      requireAuth: async () => ({ userId: "admin-a", role: "MAIN_ADMIN", businessId: "tenant-a", isServiceRole: false }),
      canAccessBusiness: (auth: any, businessId: string) => Boolean(businessId) && (auth.isServiceRole || auth.role === "SUPER_ADMIN" || auth.businessId === businessId),
      auditServiceCall: async () => undefined,
      AuthError: class extends Error {},
    },
  }, { SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" }, async (_input, init) => {
    emails.push(JSON.parse(String(init?.body))); return Response.json({ ok: true });
  });
  return { rpc, wa, emails, post: (offer?: unknown) => handler(new Request("https://synthetic.invalid/cancel", {
    method: "POST", headers: { Authorization: "Bearer synthetic-admin" },
    body: JSON.stringify({ booking_id: booking.id, business_id: "tenant-a", slot_ids: ["slot-a"], ...(offer === undefined ? {} : { offer_choice: offer }) }),
  })) };
}

describe("operator cancellation notification only", () => {
  for (const single of [false, true]) {
    it(`${single ? "single" : "weather"} cancellation persists the choice and sends both notices without customer options`, async () => {
      const f = cancelFixture(single); expect((await f.post(false)).status).toBe(200);
      expect(f.rpc).toHaveBeenCalledWith("cancel_booking_transaction", expect.objectContaining({ p_offer_choice: false }));
      expect(f.wa).toHaveBeenCalledTimes(1);
      const message = f.wa.mock.calls[0][2].full_message;
      expect(message).toContain("cancelled"); expect(message).toContain("contact us directly");
      expect(message).not.toMatch(/my-bookings|reschedule|voucher|refund|forfeit|No payment was taken/i);
      expect(f.emails).toHaveLength(1);
      expect(f.emails[0].data).toMatchObject({ notification_only: true, offer_choice: false, total_amount: 900 });
    });
    it(`${single ? "single" : "weather"} keeps existing choice behavior when omitted and validates input`, async () => {
      const f = cancelFixture(single); expect((await f.post()).status).toBe(200);
      expect(f.rpc.mock.calls[0][1].p_offer_choice).toBe(true);
      expect(f.emails[0].data.offer_choice).toBe(true);
      f.rpc.mockClear(); expect((await f.post("false")).status).toBe(400); expect(f.rpc).not.toHaveBeenCalled();
    });
  }

  it("notify-only also sends a plain notice to travel-platform guests", async () => {
    const f = cancelFixture(false, "OTA_VIATOR"); expect((await f.post(false)).status).toBe(200);
    expect(f.wa.mock.calls[0][2].full_message).not.toMatch(/refund|voucher|reschedule|rebooking|my-bookings/i);
    expect(f.emails[0].data).toMatchObject({ notification_only: true, offer_choice: false });
  });

  it("weather email renders options only with explicit consent", () => {
    const render = sourceFunction("supabase/functions/send-email/index.ts", "cancellationHtml", { heroImg: () => "" });
    const data = { is_weather: true, customer_name: "Synthetic", ref: "SYNTHETIC", _manageUrl: "https://synthetic.invalid/my-bookings" };
    expect(render({ ...data, offer_choice: true })).toContain("Your options");
    for (const extra of [{ notification_only: true, offer_choice: true }, { offer_choice: false }]) {
      const html = render({ ...data, ...extra, total_amount: 900 });
      expect(html).toContain("Trip Cancelled");
      expect(html).not.toMatch(/Your options|Manage My Booking|Get a Voucher|Request Refund|refund is on its way|forfeited/);
    }
  });

  it.each([{ is_weather: true }, { reason: "Cancelled due to weather conditions" }])("weather contact-only email directs guests to the operator for rescheduling: %j", weather => {
    const render = sourceFunction("supabase/functions/send-email/index.ts", "cancellationHtml", { heroImg: () => "" });
    const data = { ...weather, customer_name: "Synthetic", ref: "SYNTHETIC", _manageUrl: "https://synthetic.invalid/my-bookings" };
    const guidance = "Please contact the operator to discuss your rescheduling options.";
    const html = render({ ...data, notification_only: true, offer_choice: true, voucher_code: "OLD-VOUCHER", is_forfeit: true, refund_amount: 900 });
    expect(html).toContain(guidance);
    expect(html).not.toMatch(/Your options|Manage My Booking|Get a Voucher|Request Refund|refund is on its way|forfeited|OLD-VOUCHER/);
    expect(render({ ...data, offer_choice: true })).not.toContain(guidance);
    expect(render({ ...data, is_weather: false, reason: "Operator unavailable", notification_only: true })).not.toContain(guidance);
  });

  it("per-cancellation dialog offers both outcomes and can be dismissed", async () => {
    for (const [result, expected] of [[true, { offerChoice: true }], ["alt", { offerChoice: false }], [false, null]] as const) {
      const confirm = vi.fn(async () => result);
      const exports = sourceExports("app/lib/cancellation-choice.ts", { "./app-notify": { confirmAction: confirm } });
      expect(await (exports.confirmCancellation as any)("Cancel trip", "Synthetic trip")).toEqual(expected);
      expect(confirm.mock.calls[0][0]).toMatchObject({ altLabel: "Cancel & notify only", confirmLabel: "Cancel & offer options" });
    }
  });
});

function rebookFixture(actor: "customer" | "admin" | "service", selfService = false) {
  const b = { ...booking, status: "CANCELLED", cancellation_self_service: selfService };
  const rpc = vi.fn();
  const db = {
    rpc,
    auth: { getUser: async () => ({ data: { user: { id: "synthetic-admin" } } }) },
    from: (table: string) => query({ data: table === "admin_users" ? { business_id: "tenant-a", role: "MAIN_ADMIN" } : b }),
  };
  const handler = sourceHandler("supabase/functions/rebook-booking/index.ts", {
    "../_shared/tenant.ts": { createServiceClient: () => db },
    // The real shared helper over this fixture's database (admin and service-key paths).
    "../_shared/auth.ts": sourceExports("supabase/functions/_shared/auth.ts", { "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db } }, { SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" }),
    "../_shared/customer-session.ts": { verifyCustomerSession: async () => ({ valid: true, businessId: "tenant-a", email: b.email }) },
    "../_shared/vouchers.ts": {}, "../_shared/combo.ts": {},
  }, { SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" });
  return { rpc, post: (action: string) => handler(new Request("https://synthetic.invalid/rebook", {
    method: "POST", headers: { Authorization: "Bearer " + (actor === "service" ? "synthetic-service" : "synthetic-admin") },
    body: JSON.stringify({ booking_id: b.id, action, ...(actor === "customer" ? { customer_session: "synthetic-session" } : {}) }),
  })) };
}

describe("customer enforcement", () => {
  for (const actor of ["customer", "service"] as const) {
    for (const action of ["RESCHEDULE", "CLAIM_CREDIT", "CANCEL_REFUND", "CANCEL_VOUCHER"]) {
      it(`blocks ${actor} ${action} for operator-managed cancellations`, async () => {
        const f = rebookFixture(actor); const response = await f.post(action);
        expect(response.status).toBe(403); expect((await response.json()).error).toContain("handled by the operator");
        expect(f.rpc).not.toHaveBeenCalled();
      });
    }
  }
  it("allows tenant admins to resolve the booking, and preserves opted-in customer access", async () => {
    for (const f of [rebookFixture("admin"), rebookFixture("customer", true)]) {
      const response = await f.post("RESCHEDULE");
      expect(response.status).toBe(400); expect((await response.json()).error).toContain("new_slot_id required");
    }
  });
  for (const state of ["CONFIRM_VOUCHER_CONVERT", "CONFIRM_WX_REFUND_ACTION", "RESCHEDULE_PICK", "MY_BOOKINGS_LIST", "IDLE"]) {
    it(`WhatsApp ${state} honors notify-only, including stale buttons`, async () => {
      const sent: string[] = []; const changes: any[] = []; const filters: any[] = [];
      const db = { from: (table: string) => query({ data: table === "bookings" ? { ...booking, status: "CANCELLED", cancellation_reason: "Weather cancellation" } : table === "outbox" ? [] : null }, filters) };
      const handle = sourceFunction("supabase/functions/wa-webhook/index.ts", "handleMsg", {
        getConvo: async () => ({ id: "conversation-a", current_state: state, state_data: state === "IDLE" ? {} : { booking_id: booking.id } }),
        supabase: db, getSubscriptionState: async () => ({ trading: true }), shouldBotReply: async () => ({ active: true }),
        sendText: async (_t: any, _p: any, message: string) => { sent.push(message); },
        setConvo: async (_id: string, data: any) => { changes.push(data); },
        logE: async () => { throw new Error("Unexpected bot error"); },
      });
      await handle({ business: { id: "tenant-a" } }, booking.phone, state === "IDLE" ? "refund" : "yes", "text");
      expect(sent).toEqual(["This cancellation is being handled by our team. Please contact us directly for follow-up."]);
      expect(changes[0]).toEqual({ current_state: "IDLE", state_data: {} });
      expect(filters).toContainEqual(["eq", "business_id", "tenant-a"]);
      expect(filters.some(f => f[0] === "update")).toBe(false);
    });
  }
});


it("stale WhatsApp actions stay blocked when the stored phone uses a different format", async () => {
  const sent: string[] = [];
  const handle = sourceFunction("supabase/functions/wa-webhook/index.ts", "handleMsg", {
    getConvo: async () => ({ id: "conversation-a", current_state: "CONFIRM_VOUCHER_CONVERT", state_data: { booking_id: booking.id } }),
    supabase: { from: (table: string) => {
      const result: any = { data: table === "bookings" ? { ...booking, status: "CANCELLED" } : table === "outbox" ? [] : null };
      const q = query(result); const eq = q.eq;
      q.eq = (key: string, value: string) => { if (key === "phone" && value !== booking.phone) result.data = null; return eq(key, value); };
      return q;
    } },
    getSubscriptionState: async () => ({ trading: true }), shouldBotReply: async () => ({ active: true }),
    sendText: async (_t: any, _p: any, message: string) => { sent.push(message); }, setConvo: vi.fn(),
    logE: async () => { throw new Error("Unexpected bot error"); },
  });
  await handle({ business: { id: "tenant-a" } }, "+" + booking.phone, "yes", "text");
  expect(sent).toEqual(["This cancellation is being handled by our team. Please contact us directly for follow-up."]);
});

it("cancelled customer cards show choices only when enabled", () => {
  const Card = sourceExports("booking/app/my-bookings/BookingCard.tsx", {
    "react/jsx-runtime": jsx, "next/link": { default: "a" }, "next/navigation": { useRouter: () => ({ push: vi.fn() }) },
    "../lib/pricing": { paidPortions: () => ({ cashPaid: 900, voucherPaid: 0 }) },
    "../lib/format": { fmtDate: () => "21 Oct", fmtTime: () => "18:00" },
    "../lib/duration": { isMultiDay: () => false, tourEndDate: () => null },
    "./constants": { getTimeTier: () => "PAST", getHrsBefore: () => -1, getCountdownText: () => null },
    "./ActionBtn": { default: "action-button" },
  }).default as (props: any) => any;
  const props = { countdownTick: 0, tripPhotos: {}, expandedWhatToBring: {} };
  function labels(node: any): string[] {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(labels);
    return [...(node.props?.label ? [node.props.label] : []), ...labels(node.props?.children)];
  }
  for (const variant of ["hero", "card", "row"]) {
    const render = (enabled: boolean) => Card({ ...props, variant, b: { ...booking, status: "CANCELLED", cancellation_self_service: enabled } });
    expect(labels(render(false))).toEqual([]);
    if (variant !== "row") expect(labels(render(true))).toContain("Pick a new date");
  }
});

it("individual paid and voucher cancellations send the notify-only choice without issuing a voucher", async () => {
  for (const method of ["CARD", "VOUCHER"]) {
    const requests: any[] = [];
    const cancel = sourceFunction("app/bookings/page.tsx", "cancelBooking", {
      confirmCancellation: async () => ({ offerChoice: false }), confirmAction: async () => "alt",
      supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-admin" } } }) } },
      SU: "https://synthetic.invalid", setActionBookingId: vi.fn(), notify: vi.fn(), loadBookings: vi.fn(),
      fetch: async (url: string, init: any) => { requests.push({ url, body: JSON.parse(init.body) }); return Response.json({ ok: true, notification_only: true }); },
    });
    await cancel({ ...booking, payment_method: method });
    expect(requests).toHaveLength(1); expect(requests[0].url).toContain("/cancel-booking");
    expect(requests[0].body.offer_choice).toBe(false);
  }
});

it("weather slot and broadcast callers submit notify-only and can be dismissed safely", async () => {
  for (const [file, name] of [["app/bookings/page.tsx", "cancelSlotWeather"], ["app/broadcasts/page.tsx", "sendWeatherCancel"]]) {
    for (const choice of [{ offerChoice: false }, null]) {
      const invoke = vi.fn(async () => ({ data: { bookings_cancelled: 1, notified: 2 } }));
      const cancel = sourceFunction(file, name, {
        businessId: "tenant-a", selectedSlotIds: ["slot-a"], bookings: [booking], weatherReason: "weather",
        confirmCancellation: async () => choice, supabase: { functions: { invoke } },
        setCancellingWeatherId: vi.fn(), setCancellingWeather: vi.fn(), setWeatherResult: vi.fn(),
        setSelectedSlotIds: vi.fn(), setBookings: vi.fn(), setSelectedDate: vi.fn(), loadSlots: vi.fn(), loadHistory: vi.fn(),
        notify: vi.fn(), loadBookings: vi.fn(),
      });
      await cancel({ timeLabel: "Synthetic trip", bookings: [{ ...booking, slot_id: "slot-a" }] });
      if (choice) expect(invoke).toHaveBeenCalledWith("weather-cancel", expect.objectContaining({ body: expect.objectContaining({ offer_choice: false }) }));
      else expect(invoke).not.toHaveBeenCalled();
    }
  }
});
