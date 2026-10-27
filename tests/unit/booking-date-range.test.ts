import { describe, expect, it } from "vitest";
import { bookingDateRange } from "../../app/lib/booking-date-range";
import { businessDateKey } from "../../app/lib/simple-view";

describe("booking date views", () => {
  it("limits Today to the operator's date when the browser day differs", () => {
    const today = businessDateKey("Africa/Johannesburg", new Date("2026-10-21T22:30Z"));
    const range = bookingDateRange(today, "day", "Africa/Johannesburg");
    expect(range.rangeStart.toISOString()).toBe("2026-10-21T22:00:00.000Z");
    expect(range.rangeEnd.toISOString()).toBe("2026-10-22T21:59:59.999Z");
  });

  it.each(["2026-10-19", "2026-10-21", "2026-10-25"])("shows Monday through Sunday for %s", (date) => {
    const range = bookingDateRange(date, "week", "Africa/Johannesburg");
    expect(range.firstDate).toBe("2026-10-19");
    expect(range.lastDate).toBe("2026-10-25");
    expect(range.rangeStart.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(range.rangeEnd.toISOString()).toBe("2026-10-25T21:59:59.999Z");
  });

  it("spans the year boundary and handles daylight saving within a week", () => {
    expect(bookingDateRange("2027-01-01", "week", "UTC")).toMatchObject({ firstDate: "2026-12-28", lastDate: "2027-01-03" });
    const range = bookingDateRange("2026-03-08", "week", "America/New_York");
    expect((range.rangeEnd.getTime() + 1 - range.rangeStart.getTime()) / 3600000).toBe(167);
  });

  it("preserves full month filtering including leap day", () => {
    const range = bookingDateRange("2028-02-15", "month", "Africa/Johannesburg");
    expect(range.firstDate).toBe("2028-02-01");
    expect(range.lastDate).toBe("2028-02-29");
    expect(range.rangeEnd.toISOString()).toBe("2028-02-29T21:59:59.999Z");
  });
});
