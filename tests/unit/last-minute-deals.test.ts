import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rescheduleUnitPrice } from "../../app/lib/reschedule-price";
import { rescheduleUnitPrice as bookingRescheduleUnitPrice, BOOKING_CUTOFF_MINUTES } from "../../booking/app/lib/pricing";

const SLOT = { price_per_person_override: 450, base_price_per_person: 600 };
const WINDOW_SQL = readFileSync("supabase/migrations/20260725090000_last_minute_deals.sql", "utf8");
// apply_last_minute_deals is redefined here, so this file — not the one above —
// is the body that actually runs. Guards have to hold in both.
const LIVE_SQL = readFileSync("supabase/migrations/20260725130000_last_minute_deal_window.sql", "utf8");

describe("last-minute deals: reschedule pricing", () => {
  it("quotes the slot price for a normal (peak) override", () => {
    expect(rescheduleUnitPrice({ ...SLOT, last_minute_at: null }, 0)).toBe(450);
    expect(bookingRescheduleUnitPrice({ price_per_person_override: 450, last_minute_at: null }, 600)).toBe(450);
  });

  it("quotes base price when the slot was discounted by the last-minute cron", () => {
    // Otherwise a paid customer reschedules into a deal and claims the difference.
    expect(rescheduleUnitPrice({ ...SLOT, last_minute_at: "2026-07-25T09:00:00Z" }, 0)).toBe(600);
    expect(bookingRescheduleUnitPrice({ price_per_person_override: 450, last_minute_at: "2026-07-25T09:00:00Z" }, 600)).toBe(600);
  });

  it("never undercharges on a stale flag left on an upward re-price", () => {
    const repriced = { price_per_person_override: 800, base_price_per_person: 600, last_minute_at: "2026-07-25T09:00:00Z" };
    expect(rescheduleUnitPrice(repriced, 0)).toBe(800);
    expect(bookingRescheduleUnitPrice({ price_per_person_override: 800, last_minute_at: "2026-07-25T09:00:00Z" }, 600)).toBe(800);
  });

  it("falls back to base price with no override", () => {
    expect(rescheduleUnitPrice({ price_per_person_override: null, base_price_per_person: 600 }, 0)).toBe(600);
    expect(bookingRescheduleUnitPrice({ price_per_person_override: null, last_minute_at: null }, 600)).toBe(600);
    expect(rescheduleUnitPrice(undefined, 600)).toBe(600);
  });
});

describe("last-minute deals: server enforcement", () => {
  it("rebook-booking skips only a genuine last-minute discount", () => {
    const src = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");
    expect(src).toContain("slotOverride != null && slotOverride < newBasePrice");
    expect(src).toContain("price_per_person_override, last_minute_at");
  });

  it("only ever lowers a price and never touches sold-out or closed slots", () => {
    expect(WINDOW_SQL).toContain("COALESCE(s.price_per_person_override, t.base_price_per_person) > t.last_minute_price");
    expect(WINDOW_SQL).toContain("COALESCE(s.booked, 0) + COALESCE(s.held, 0) < s.capacity_total");
    expect(WINDOW_SQL).toContain("s.status = 'OPEN'");
    expect(WINDOW_SQL).toContain("s.last_minute_at IS NULL");
  });

  it("keeps repricing cron-only while leaving the cron able to call it", () => {
    expect(WINDOW_SQL).toContain("REVOKE EXECUTE ON FUNCTION public.apply_last_minute_deals() FROM PUBLIC, anon, authenticated");
    expect(WINDOW_SQL).toContain("GRANT  EXECUTE ON FUNCTION public.apply_last_minute_deals() TO service_role");
    // The recreated slot list must keep its original grants
    expect(WINDOW_SQL).toContain("GRANT EXECUTE ON FUNCTION public.list_available_slots(uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role");
  });

  it("clears the deal flag wherever an operator sets a price by hand", () => {
    const slots = readFileSync("app/slots/page.tsx", "utf8");
    const pricing = readFileSync("app/pricing/page.tsx", "utf8");
    expect(slots).toContain("last_minute_at: null");
    expect(slots).toContain("baseUpdates.last_minute_at = null");
    expect(pricing).toContain("is_peak: true, price_per_person_override: winningPrice, last_minute_at: null");
    expect(pricing).toContain("is_peak: false, price_per_person_override: null, last_minute_at: null");
  });

  it("never advertises a deal the booking flow will not sell", () => {
    const home = readFileSync("booking/app/page.tsx", "utf8");
    expect(home).toContain("BOOKING_CUTOFF_MINUTES");
    expect(home).toContain('.not("price_per_person_override", "is", null)');
    expect(BOOKING_CUTOFF_MINUTES).toBe(60);
  });
});

describe("last-minute deals: start and cut-off window", () => {
  it("opens no earlier than the start and no later than the cut-off", () => {
    expect(LIVE_SQL).toContain("AND s.start_time > now() + make_interval(hours => COALESCE(t.last_minute_end_hours, 0))");
    expect(LIVE_SQL).toContain("AND s.start_time <= now() + make_interval(hours => t.last_minute_hours)");
  });

  it("restores the price the deal replaced rather than dropping to base", () => {
    // A peak-priced slot that goes on deal must come back at its peak price.
    expect(LIVE_SQL).toContain("SET price_before_deal = s.price_per_person_override");
    expect(LIVE_SQL).toContain("SET price_per_person_override = s.price_before_deal");
    expect(LIVE_SQL).toContain("price_before_deal = NULL");
    expect(LIVE_SQL).toContain("last_minute_at = NULL");
  });

  it("closes only upcoming, un-held slots past the cut-off", () => {
    // create-checkout recomputes the total from price_per_person_override at pay
    // time, so closing under a live hold would charge more than the page quoted.
    expect(LIVE_SQL).toContain("AND COALESCE(s.held, 0) = 0");
    expect(LIVE_SQL).toContain("AND s.start_time <= now() + make_interval(hours => t.last_minute_end_hours)");
    expect(LIVE_SQL).toContain("AND s.start_time > now()");
    expect(LIVE_SQL).toContain("AND t.last_minute_end_hours IS NOT NULL");
  });

  it("keeps the live function under the same guards as the original", () => {
    expect(LIVE_SQL).toContain("COALESCE(s.price_per_person_override, t.base_price_per_person) > t.last_minute_price");
    expect(LIVE_SQL).toContain("COALESCE(s.booked, 0) + COALESCE(s.held, 0) < s.capacity_total");
    expect(LIVE_SQL).toContain("s.status = 'OPEN'");
    expect(LIVE_SQL).toContain("s.last_minute_at IS NULL");
    expect(LIVE_SQL).toContain("REVOKE EXECUTE ON FUNCTION public.apply_last_minute_deals() FROM PUBLIC, anon, authenticated");
    expect(LIVE_SQL).toContain("GRANT  EXECUTE ON FUNCTION public.apply_last_minute_deals() TO service_role");
  });

  it("refuses a window that is not a window", () => {
    expect(LIVE_SQL).toContain("last_minute_end_hours < last_minute_hours");
    expect(LIVE_SQL).toContain("last_minute_end_hours >= 0");
  });

  it("makes the operator set all three fields or none", () => {
    const settings = readFileSync("app/settings/page.tsx", "utf8");
    expect(settings).toContain("const lmSet = [lmHours, lmEndHours, lmPrice].filter(v => v !== null).length");
    expect(settings).toContain("lmSet > 0 && lmSet < 3");
    expect(settings).toContain("lmEndHours >= (lmHours as number)");
    expect(settings).toContain("last_minute_end_hours: lmEndHours");
  });
});
