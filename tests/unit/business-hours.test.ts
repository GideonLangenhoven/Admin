import { describe, expect, test } from "vitest";
import {
  DEFAULT_BUSINESS_HOURS,
  isCompleteBusinessHours,
  normalizeBusinessHours,
} from "../../app/lib/business-hours";

describe("business hours", () => {
  test("normalizes missing schedules into the weekly shape expected by Postgres", () => {
    expect(normalizeBusinessHours(null)).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(Object.keys(normalizeBusinessHours({}))).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  });

  test("preserves configured days and fills missing days", () => {
    const hours = normalizeBusinessHours({
      mon: { closed: false, open: "07:30", close: "16:15" },
      sun: { closed: true, open: "09:00", close: "12:00" },
    });

    expect(hours.mon).toEqual({ closed: false, open: "07:30", close: "16:15" });
    expect(hours.sun).toEqual({ closed: true, open: "09:00", close: "12:00" });
    expect(hours.tue).toEqual(DEFAULT_BUSINESS_HOURS.tue);
  });

  test("rejects incomplete or invalid configured schedules", () => {
    expect(isCompleteBusinessHours(null)).toBe(false);
    expect(isCompleteBusinessHours({ mon: { closed: false, open: "09:00", close: "17:00" } })).toBe(false);
    expect(isCompleteBusinessHours({ ...DEFAULT_BUSINESS_HOURS, mon: { closed: false, open: "17:00", close: "09:00" } })).toBe(false);
    expect(isCompleteBusinessHours(DEFAULT_BUSINESS_HOURS)).toBe(true);
  });
});
