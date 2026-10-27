import { describe, expect, it } from "vitest";
import { calendarDateInTz, calendarDateIso, fmtTimezone, parseCalendarDate } from "../../booking/app/lib/format";
import { isBookableSlot, isSameDeparture } from "../../booking/app/lib/pricing";
import { readRefundTiers, refundDisclosure } from "../../booking/app/lib/cancellation-policy";

const departure = "2026-11-02T14:00:00Z";
const start = Date.parse(departure);
const tiers = readRefundTiers([
  { hours_before: 0, refund_percent: 0 },
  { hours_before: 6, refund_percent: 25 },
  { hours_before: 48, refund_percent: 75 },
])!;

describe("guest cancellation disclosure agrees with inclusive server boundaries", () => {
  for (const [hours, before, at, after] of [[48, 75, 75, 25], [6, 25, 25, 0], [0, 0, 0, 0]]) {
    it(`matches before, at and after the ${hours}-hour boundary`, () => {
      const boundary = start - hours * 3_600_000;
      expect(refundDisclosure(tiers, departure, boundary - 1)?.percent).toBe(before);
      expect(refundDisclosure(tiers, departure, boundary)?.percent).toBe(at);
      expect(refundDisclosure(tiers, departure, boundary + 1)?.percent).toBe(after);
    });
  }
  it("subtracts elapsed hours across daylight saving and formats the deadline's offset", () => {
    const disclosure = refundDisclosure(tiers, departure, start - 49 * 3_600_000)!;
    expect(disclosure.nextChange).toEqual({ at: "2026-10-31T14:00:00.000Z", percent: 25 });
    expect(fmtTimezone(disclosure.nextChange!.at, "America/New_York")).toMatch(/GMT-4|EDT/);
    expect(fmtTimezone(departure, "America/New_York")).toMatch(/GMT-5|EST/);
  });
  it("marks a reduced refund and skips thresholds with unchanged percentages", () => {
    expect(refundDisclosure(tiers, departure, start - 12 * 3_600_000)).toMatchObject({ percent: 25, reduced: true });
    const same = readRefundTiers([{ hours_before: 48, refund_percent: 80 }, { hours_before: 24, refund_percent: 80 }, { hours_before: 0, refund_percent: 0 }])!;
    expect(refundDisclosure(same, departure, start - 60 * 3_600_000)?.nextChange?.at).toBe("2026-11-01T14:00:00.000Z");
    const increasing = readRefundTiers([{ hours_before: 48, refund_percent: 25 }, { hours_before: 6, refund_percent: 75 }, { hours_before: 0, refund_percent: 0 }])!;
    expect(refundDisclosure(increasing, departure, start - 60 * 3_600_000)).toMatchObject({ percent: 25, reduced: false });
    expect(refundDisclosure(increasing, departure, start - 12 * 3_600_000)).toMatchObject({ percent: 75, reduced: false });
  });
  it("uses no invented rules when structured data is absent or malformed", () => {
    for (const raw of [null, [], "cancel within two days", [{ hours_before: null, refund_percent: 75 }], [{ hours_before: 24, refund_percent: "unknown" }], [{ hours_before: true, refund_percent: 75 }], [{ hours_before: "", refund_percent: 0 }], [{ hours_before: 24, refund_percent: 75 }, { hours_before: 24, refund_percent: 25 }]]) expect(readRefundTiers(raw)).toBeNull();
    expect(refundDisclosure(tiers, "invalid", start)).toBeNull();
  });
});

describe("operator calendar dates and booking validity", () => {
  it("groups a departure into the operator's day independently of browser timezone", () => {
    expect(calendarDateIso(calendarDateInTz("2026-10-03T01:00:00Z", "America/New_York"))).toBe("2026-10-02");
    expect(calendarDateIso(calendarDateInTz("2026-10-03T23:30:00Z", "Africa/Johannesburg"))).toBe("2026-10-04");
    expect(calendarDateIso(parseCalendarDate("2026-10-03", "America/New_York")!)).toBe("2026-10-03");
    expect(parseCalendarDate("2026-02-31", "UTC")).toBeNull();
    expect(parseCalendarDate("invalid", "UTC")).toBeNull();
  });
  it("requires open status, enough capacity and strictly more than the existing cutoff", () => {
    const slot = { id: "slot", tour_id: "tour", start_time: departure, capacity_total: 5, booked: 2, held: 1, status: "OPEN" };
    expect(isBookableSlot(slot, start - 3_600_001, 2)).toBe(true);
    expect(isBookableSlot(slot, start - 3_600_000)).toBe(false);
    expect(isBookableSlot(slot, start - 7_200_000, 3)).toBe(false);
    expect(isBookableSlot({ ...slot, status: "CANCELLED" }, start - 7_200_000)).toBe(false);
    expect(isBookableSlot({ ...slot, booked: 5 }, start - 7_200_000)).toBe(false);
  });
  it("keeps the selected instant and identity when a departure is retimed", () => {
    const slot = { id: "slot", tour_id: "tour", start_time: departure, capacity_total: 5, booked: 0, held: 0, status: "OPEN" };
    expect(isSameDeparture(slot, { ...slot, start_time: "2026-11-02T14:00:00.000Z" })).toBe(true);
    expect(isSameDeparture(slot, { ...slot, start_time: "2026-11-03T14:00:00Z" })).toBe(false);
    expect(isSameDeparture(slot, { ...slot, tour_id: "another-tour" })).toBe(false);
  });
});
