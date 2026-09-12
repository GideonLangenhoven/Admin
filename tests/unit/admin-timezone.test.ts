import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changeLocalTime, normalize24HourTime, utcToLocalParts, zonedToUtc } from "../../app/lib/admin-timezone";

describe("admin slot times", () => {
  it("accepts 24-hour input without capping the hour at 12", () => {
    expect(normalize24HourTime("14")).toBe("14:00");
    expect(normalize24HourTime("14:30")).toBe("14:30");
    expect(normalize24HourTime("1430")).toBe("14:30");
    expect(normalize24HourTime("24:00")).toBeNull();
  });

  it("does not use the browser's locale-dependent time control on the Slots page", () => {
    const slotsPage = readFileSync("app/slots/page.tsx", "utf8");

    expect(slotsPage).not.toContain('type="time"');
    expect(slotsPage).toContain('inputMode="numeric"');
  });

  it("stores 14:00 in UTC and displays it again as 14:00 in Johannesburg", () => {
    const changed = changeLocalTime("2026-08-31T06:00:00.000Z", "Africa/Johannesburg", 14, 0);

    expect(changed).toBe("2026-08-31T12:00:00.000Z");
    expect(utcToLocalParts(changed, "Africa/Johannesburg")).toMatchObject({ hours: 14, mins: 0 });
  });

  it("keeps report and slot boundaries at local midnight across clock changes", () => {
    for (const [day, timezone, utc] of [
      ["2026-10-04", "Australia/Sydney", "2026-10-03T14:00:00.000Z"],
      ["2026-04-05", "Australia/Sydney", "2026-04-04T13:00:00.000Z"],
      ["2026-03-08", "America/New_York", "2026-03-08T05:00:00.000Z"],
      ["2026-11-01", "America/New_York", "2026-11-01T04:00:00.000Z"],
      ["2026-09-11", "Africa/Johannesburg", "2026-09-10T22:00:00.000Z"],
      ["2026-09-11", "UTC", "2026-09-11T00:00:00.000Z"],
    ]) {
      const actual = new Date(zonedToUtc(day + "T00:00:00", timezone)).toISOString();
      expect(actual).toBe(utc);
      expect(utcToLocalParts(actual, timezone)).toMatchObject({ hours: 0, mins: 0, day: Number(day.slice(-2)) });
    }
  });
});
