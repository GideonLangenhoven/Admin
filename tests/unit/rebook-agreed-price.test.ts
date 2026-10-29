import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";
import { getPaidPortions } from "../../supabase/functions/_shared/vouchers";

// M1: unit_price is the list price a booking was made at; an admin price
// override or promo lives only in its agreed total. A rebook keeps that
// agreed difference, so moving an R750/pp override (list R850) to another
// R850 departure costs nothing, unless an admin explicitly reprices.
const SERVICE = "fixture-service";
const base = {
  id: "bk", business_id: "biz-a", tour_id: "tour", slot_id: "old-slot", status: "PAID", qty: 2, unit_price: 850,
  total_amount: 1500, original_total: 1700, voucher_amount_paid: 0, discount_type: "MANUAL", discount_notes: "Loyal guest",
  email: "guest@example.invalid", phone: null, slots: { start_time: "2026-11-01T06:00:00Z" }, tours: { name: "Harbour paddle" },
};

function query(result: unknown) {
  const chain: any = {};
  for (const name of ["select", "update", "insert", "eq", "in", "not", "gt", "order", "limit"]) chain[name] = () => chain;
  chain.single = chain.maybeSingle = async () => result;
  chain.then = (yes: any, no: any) => Promise.resolve(result).then(yes, no);
  return chain;
}

function fixture(booking: Record<string, unknown> = {}, newSlot: Record<string, unknown> = {}, extras: unknown[] = []) {
  const b = { ...base, ...booking };
  const slot = { id: "new-slot", tour_id: "tour", start_time: "2026-11-08T06:00:00Z", capacity_total: 10, booked: 0, held: 0, price_per_person_override: null, last_minute_at: null, ...newSlot };
  const rpc = vi.fn(async (name: string) => ({ data: name === "apply_booking_change" ? { ok: true, diff: 0 } : { ok: true, hold_id: "h", pending_reschedule_id: "p", expires_at: "2026-11-01T06:15:00Z" } }));
  const tables: Record<string, unknown> = {
    bookings: { data: b }, admin_users: { data: { business_id: "biz-a", role: "MAIN_ADMIN" } }, slots: { data: slot },
    tours: { data: { base_price_per_person: 850, name: "Harbour paddle" } }, booking_add_ons: { data: extras }, logs: { data: null },
  };
  const fetchImpl = vi.fn(async (url: string) => Response.json(String(url).endsWith("/create-checkout") ? { redirectUrl: "https://pay.invalid/x" } : { ok: true }));
  const db = { rpc, auth: { getUser: async () => ({ data: { user: { id: "admin-a" } } }) }, from: (t: string) => query(tables[t] ?? { data: null }) };
  const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: SERVICE };
  const handler = sourceHandler("supabase/functions/rebook-booking/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => db,
      getTenantByBusinessId: async () => ({ business: { id: "biz-a" }, credentials: {} }), formatTenantDateTime: () => "Sat 8 Nov, 08:00",
      getBusinessDisplayName: () => "Fixture Tours", getAdminAppOrigins: () => [], normalizePhone: (p: string) => p, sendWhatsappTextForTenant: async () => undefined,
    },
    "../_shared/customer-session.ts": { verifyCustomerSession: async () => ({ valid: false }) },
    "../_shared/vouchers.ts": { getPaidPortions }, "../_shared/combo.ts": {},
    // The real shared helper, wired to this fixture's database.
    "../_shared/auth.ts": sourceExports("supabase/functions/_shared/auth.ts", { "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db } }, env),
  }, env, fetchImpl as unknown as typeof fetch);
  const post = async (body: Record<string, unknown>, token = "admin-jwt") => {
    const res = await handler(new Request("https://fixture.invalid/rebook-booking", {
      method: "POST", headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ booking_id: "bk", action: "RESCHEDULE", new_slot_id: "new-slot", ...body }),
    }));
    return res.json();
  };
  const change = () => rpc.mock.calls.find(([name]) => name === "apply_booking_change")?.[1] as any;
  const amendment = () => rpc.mock.calls.find(([name]) => name === "prepare_booking_amendment")?.[1] as any;
  return { post, change, amendment };
}

describe("rebook keeps the price agreed for the booking", () => {
  it("previews and moves an admin override to a same-price departure at no charge", async () => {
    const f = fixture();
    expect(await f.post({ preview: true })).toEqual({
      ok: true, preview: true, list_unit_price: 850, new_qty: 2, extras_total: 0, carried: -200, carried_reason: "Loyal guest",
      new_total: 1500, credit: 1500, diff: 0,
    });
    expect(await f.post({})).toMatchObject({ ok: true, diff: 0 });
    // unit_price stays the list price; the agreed total carries the override.
    expect(f.change()).toMatchObject({ p_new_unit_price: 850, p_new_total: 1500, p_new_qty: 2 });
  });

  it("charges the list price only when an admin explicitly reprices", async () => {
    const admin = fixture();
    expect(await admin.post({ preview: true, reprice: true })).toMatchObject({ carried: 0, new_total: 1700, diff: 200 });
    expect(await admin.post({ reprice: true })).toMatchObject({ diff: 200, payment_url: "https://pay.invalid/x" });
    expect(admin.amendment()).toMatchObject({ p_new_unit_price: 850, p_new_total_amount: 1700, p_diff: 200 });

    // Guests and bots cannot reprice their own booking.
    expect(await fixture().post({ preview: true, reprice: true }, SERVICE)).toMatchObject({ carried: -200, diff: 0 });
  });

  it("keeps a promo discount and still charges a pricier departure's difference", async () => {
    const f = fixture({ discount_type: null, discount_notes: null, promo_code: "WINTER10", total_amount: 1530 }, { price_per_person_override: 950 });
    expect(await f.post({ preview: true })).toMatchObject({ list_unit_price: 950, carried: -170, carried_reason: "Promo code WINTER10", new_total: 1730, diff: 200 });
  });

  it("leaves list-priced bookings exactly as before", async () => {
    const f = fixture({ discount_type: null, discount_notes: null, unit_price: 700, total_amount: 1400, original_total: 1400 }, { price_per_person_override: 900 });
    expect(await f.post({ preview: true })).toMatchObject({ carried: 0, carried_reason: null, new_total: 1800, diff: 400 });
  });

  it("never creates a rounding difference on an uneven party", async () => {
    const f = fixture({ qty: 3, total_amount: 2350, original_total: 2550 }, {}, [{ unit_price: 120, qty: 1 }]);
    expect(await f.post({ preview: true })).toMatchObject({ new_total: 2350, diff: 0 });
  });

  it("scales the agreed difference when a weather credit claim brings fewer guests", async () => {
    const f = fixture({ status: "CANCELLED", refund_status: "ACTION_REQUIRED", refund_amount: 1500 });
    expect(await f.post({ preview: true, new_qty: 1 })).toMatchObject({ carried: -100, new_total: 750, credit: 1500, diff: -750 });
  });
});
