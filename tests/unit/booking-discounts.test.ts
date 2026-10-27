import { describe, expect, it } from "vitest";
import { legacyBookingDiscountRules, validateBookingDiscountRules, type BookingDiscountRule } from "../../app/lib/booking-discounts";
import { sourceFunction } from "../helpers/source-handler";

describe("operator booking discounts", () => {
  it("loads existing thresholds and preserves zero percent", () => {
    expect(legacyBookingDiscountRules({ loyalty_period_days: 60, loyalty_bookings_threshold: 4, loyalty_discount_percent: 0 })[0]).toMatchObject({ window_days: 60, min_bookings: 4, percent: 0 });
  });
  const group: BookingDiscountRule = { name: "Group offer", kind: "group", enabled: true, percent: 7, min_guests: 6, max_guests: 12 };
  it("accepts whole percentages and optional upper limits", () => {
    expect(validateBookingDiscountRules([group])).toBeNull();
    expect(validateBookingDiscountRules([{ ...group, max_guests: null, percent: 0 }])).toBeNull();
    expect(validateBookingDiscountRules([])).toBeNull();
  });
  it.each([
    { percent: 7.5 }, { percent: -1 }, { percent: 101 }, { percent: NaN }, { min_guests: 0 },
    { min_guests: 1.5 }, { max_guests: 5 }, { name: " " },
    { kind: "frequency", min_bookings: 0, window_days: 30 },
    { kind: "frequency", min_bookings: 2, window_days: 0 },
    { kind: "recency", min_days: 90, max_days: 30 },
  ])("rejects invalid operator settings: %j", patch => {
    expect(validateBookingDiscountRules([{ ...group, ...patch } as BookingDiscountRule])).toBeTruthy();
  });
  it("uses the server's configured discount rather than a hard-coded fallback", async () => {
    const calls: unknown[] = [];
    const calc = sourceFunction("supabase/functions/wa-webhook/index.ts", "calcDiscount", {
      supabase: { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: { type: "RETURNING", percent: 12, label: "Welcome back" }, error: null }; } },
    });
    expect(await calc({ business: { id: "a" } }, 3, "27820000000")).toMatchObject({ percent: 12, type: "RETURNING" });
    expect(calls).toEqual([{ name: "resolve_booking_discount", args: { p_business_id: "a", p_phone: "27820000000", p_qty: 3 } }]);
  });
  it("fails closed if discount verification is unavailable", async () => {
    const calc = sourceFunction("supabase/functions/wa-webhook/index.ts", "calcDiscount", { supabase: { rpc: async () => ({ data: null, error: { message: "unavailable" } }) } });
    await expect(calc({ business: { id: "a" } }, 3, "27820000000")).rejects.toThrow("Could not verify booking discounts");
  });
});
