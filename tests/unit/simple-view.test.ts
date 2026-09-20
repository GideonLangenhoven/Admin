import { describe, expect, it } from "vitest";
import { addDaysToDateKey, businessDateKey, businessDayRange, isDateKey, safeSimpleReturn, walkInUrl } from "../../app/lib/simple-view";

describe("simple view date handling", () => {
  it("uses the business timezone for today", () => {
    const instant = new Date("2026-09-20T22:30:00Z");
    expect(businessDateKey("Africa/Johannesburg", instant)).toBe("2026-09-21");
    expect(businessDateKey("America/New_York", instant)).toBe("2026-09-20");
  });

  it("creates DST-safe business-day ranges", () => {
    const spring = businessDayRange("2026-03-08", "America/New_York");
    expect((new Date(spring.endIso).getTime() - new Date(spring.startIso).getTime()) / 3_600_000).toBe(23);
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("rejects impossible date keys", () => {
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2028-02-29")).toBe(true);
  });
});

describe("simple view return navigation", () => {
  it("allows only known internal destinations and supported context", () => {
    expect(safeSimpleReturn("/simple/check-ins?date=2026-09-20&slot=00000000-0000-4000-8000-000000000001&evil=1"))
      .toBe("/simple/check-ins?date=2026-09-20&slot=00000000-0000-4000-8000-000000000001");
    expect(safeSimpleReturn("https://evil.example/simple")).toBe("/simple");
    expect(safeSimpleReturn("//evil.example/simple")).toBe("/simple");
    expect(safeSimpleReturn("/bookings")).toBe("/simple");
  });

  it("builds a walk-in URL with preserved date, departure and return context", () => {
    const href = walkInUrl({
      date: "2026-09-20",
      tourId: "tour-id",
      slotId: "slot-id",
      returnTo: "/simple/calendar?date=2026-09-20",
    });
    const parsed = new URL(href, "https://local.test");
    expect(parsed.pathname).toBe("/simple/new-booking");
    expect(parsed.searchParams.get("date")).toBe("2026-09-20");
    expect(parsed.searchParams.get("tour")).toBe("tour-id");
    expect(parsed.searchParams.get("slot")).toBe("slot-id");
    expect(parsed.searchParams.get("returnTo")).toBe("/simple/calendar?date=2026-09-20");
  });
});
