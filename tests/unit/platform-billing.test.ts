import { describe, expect, it } from "vitest";
import { computeActiveDays } from "../../app/lib/platform-billing";

// Pro-rata math for platform (BookingTours -> operator) monthly invoices.
// Fixed, hand-computed dates throughout (not "N days before today") so these
// stay deterministic regardless of which day the suite runs on — same
// discipline as billing-period.test's periodBounds coverage.
describe("computeActiveDays (platform invoice pro-ration)", () => {
  it("full active month — no pause events at all", () => {
    const r = computeActiveDays("2026-07-01", "2026-07-31", "2026-01-01", null, [], "ACTIVE", "2026-08-01");
    expect(r.totalDays).toBe(31);
    expect(r.activeDays).toBe(31);
    expect(r.pauseWindows).toEqual([]);
  });

  it("full paused month — paused before the month started, never resumed", () => {
    const r = computeActiveDays(
      "2026-07-01",
      "2026-07-31",
      "2026-01-01",
      null,
      [{ action_type: "BILLING_PAUSED", created_at: "2026-06-15T00:00:00Z" }],
      "PAUSED",
      "2026-08-01",
    );
    expect(r.totalDays).toBe(31);
    expect(r.activeDays).toBe(0);
  });

  it("paused mid-month, still paused at generation time", () => {
    const r = computeActiveDays(
      "2026-07-01",
      "2026-07-31",
      "2026-01-01",
      null,
      [{ action_type: "BILLING_PAUSED", created_at: "2026-07-10T00:00:00Z" }],
      "PAUSED",
      "2026-08-01",
    );
    expect(r.totalDays).toBe(31);
    // 1st through 9th active (9 days), paused from the 10th onward.
    expect(r.activeDays).toBe(9);
  });

  it("paused then resumed within the same month", () => {
    const r = computeActiveDays(
      "2026-07-01",
      "2026-07-31",
      "2026-01-01",
      null,
      [
        { action_type: "BILLING_PAUSED", created_at: "2026-07-05T00:00:00Z" },
        { action_type: "BILLING_RESUMED", created_at: "2026-07-15T00:00:00Z" },
      ],
      "ACTIVE",
      "2026-08-01",
    );
    expect(r.totalDays).toBe(31);
    // Paused days 5-14 inclusive (10 days), active again from the 15th.
    expect(r.activeDays).toBe(21);
  });

  it("subscription started mid-month — pro-rated for the late start, not just pauses", () => {
    const r = computeActiveDays("2026-07-01", "2026-07-31", "2026-07-10", null, [], "ACTIVE", "2026-08-01");
    expect(r.totalDays).toBe(31);
    // Existed from the 10th through the 31st inclusive = 22 days.
    expect(r.activeDays).toBe(22);
  });

  it("already paused entering the month (event predates the period) still deducts correctly, no special-casing needed", () => {
    const r = computeActiveDays(
      "2026-07-01",
      "2026-07-31",
      "2026-01-01",
      null,
      [
        { action_type: "BILLING_PAUSED", created_at: "2026-06-20T00:00:00Z" },
        { action_type: "BILLING_RESUMED", created_at: "2026-07-06T00:00:00Z" },
      ],
      "ACTIVE",
      "2026-08-01",
    );
    expect(r.totalDays).toBe(31);
    // Paused for the first 5 days of July (1st-5th), active from the 6th.
    expect(r.activeDays).toBe(26);
  });

  it("subscription didn't exist yet during this billed month", () => {
    const r = computeActiveDays("2026-07-01", "2026-07-31", "2026-08-15", null, [], "ACTIVE", "2026-08-01");
    expect(r.activeDays).toBe(0);
    expect(r.totalDays).toBe(31);
  });
});
