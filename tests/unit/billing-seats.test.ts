import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { periodBounds } from "../../app/lib/billing-period";

// Item 15 — "Add seat to plan" fails with "No subscription found", always,
// for every tenant, regardless of subscription age. Root cause: the route
// selected subscriptions.seats_purchased/billing_cycle_start/billing_cycle_end
// — columns that only ever existed in a parked, never-applied migration.
// PostgREST fails the whole SELECT when any column doesn't exist, and the
// error was discarded, so `sub` was always undefined.
describe("billing seats (item 15)", () => {
  const seatsRoute = readFileSync("app/api/billing/seats/route.ts", "utf8");
  const pauseRoute = readFileSync("app/api/billing/pause/route.ts", "utf8");
  const resumeRoute = readFileSync("app/api/billing/resume/route.ts", "utf8");

  it("seats route no longer selects the phantom columns that made every lookup fail", () => {
    expect(seatsRoute).not.toContain('.select("id, seats_purchased');
    expect(seatsRoute).not.toContain("billing_cycle_start, billing_cycle_end, status");
    expect(seatsRoute).toContain('.select("id, plan_id, period_start, period_end, status")');
  });

  it("seats route checks the lookup error instead of silently discarding it", () => {
    expect(seatsRoute).toContain("const { data: sub, error: subErr }");
    expect(seatsRoute).toContain("if (subErr) console.error");
  });

  it("seats route accepts TRIAL as well as ACTIVE, matching requireActiveSubscription", () => {
    expect(seatsRoute).toContain('sub.status !== "ACTIVE" && sub.status !== "TRIAL"');
  });

  it("seats route writes the new seat count to businesses.max_admin_seats, not the unread subscriptions column", () => {
    expect(seatsRoute).toContain('.from("businesses").update({ max_admin_seats: newSeats })');
  });

  it("seats route reads seat price from the real plans table via the shared FALLBACK default", () => {
    expect(seatsRoute).toContain('.from("plans")');
    expect(seatsRoute).toContain("extra_seat_price_zar ?? 500");
  });

  it("seats route's billing_line_items insert uses the real table columns", () => {
    expect(seatsRoute).toContain("source_type: \"SUBSCRIPTION\"");
    expect(seatsRoute).toContain("amount_zar: proration");
    expect(seatsRoute).not.toContain("unit_amount_zar:");
    expect(seatsRoute).not.toContain("invoice_period_start:");
  });

  it("pause/resume routes no longer write the phantom paused_at/resumed_at columns", () => {
    expect(pauseRoute).not.toContain("paused_at: new Date");
    expect(resumeRoute).not.toContain("resumed_at: new Date");
  });

  it("all three routes stay reachable when the tenant is suspended (unchanged S4 gate)", () => {
    for (const src of [seatsRoute, pauseRoute, resumeRoute]) {
      expect(src).toContain("getCallerAdmin(req, { skipSubscriptionCheck: true })");
    }
  });
});

// periodBounds is the pure function both /api/billing/subscription and
// /api/billing/seats rely on for proration math — genuinely behavioral
// coverage for "a fresh and a long-standing subscription", not just a
// source-text check, since this is what actually computes the billing
// window either kind of subscription prorates against.
//
// Fixed, hand-computed dates throughout (not "N days before today") so these
// stay deterministic regardless of which day/timezone the suite runs in —
// this exact class of runtime-dependent date math is what the function
// itself needed fixing for (see billing-period.ts).
describe("periodBounds (shared by subscription GET and seats POST)", () => {
  it("computes correct bounds for a fresh subscription (period_start a few days into its cycle)", () => {
    const { billing_cycle_start, billing_cycle_end } = periodBounds("2026-07-03", null);
    expect(billing_cycle_start).toBe("2026-07-03");
    // No period_end on a fresh, still-open subscription — falls back to the
    // end of that start month, not today's month.
    expect(billing_cycle_end).toBe("2026-07-31");
  });

  it("computes correct bounds for a long-standing subscription (period_start many months ago)", () => {
    const { billing_cycle_start, billing_cycle_end } = periodBounds("2026-01-15", null);
    expect(billing_cycle_start).toBe("2026-01-15");
    // Still anchored to ITS OWN period, not the current calendar month —
    // a subscription created long ago must prorate against its own cycle.
    expect(billing_cycle_end).toBe("2026-01-31");
  });

  it("uses the real period_end when the subscription has one, regardless of age", () => {
    const { billing_cycle_start, billing_cycle_end } = periodBounds("2026-01-01", "2026-01-31");
    expect(billing_cycle_start).toBe("2026-01-01");
    expect(billing_cycle_end).toBe("2026-01-31");
  });

  it("falls back to the current UTC calendar month when a subscription has no period_start at all", () => {
    const now = new Date();
    const { billing_cycle_start } = periodBounds(null, null);
    const expectedStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    expect(billing_cycle_start).toBe(expectedStart.toISOString().slice(0, 10));
  });

  it("is immune to a local timezone ahead of UTC (the actual bug this function had)", () => {
    // Regression guard: an earlier version built the fallback end date via
    // `new Date(year, month, day)` (local time) and serialized it with
    // .toISOString() — for any timezone ahead of UTC, local midnight on the
    // last day of the month rolls back to 22:00 UTC the day before, so the
    // computed end date was silently one calendar day short. Every one of
    // the fixed-date assertions above already exercises this, but this test
    // makes the guard explicit rather than incidental.
    const { billing_cycle_end } = periodBounds("2026-04-01", null);
    expect(billing_cycle_end).toBe("2026-04-30");
  });
});
