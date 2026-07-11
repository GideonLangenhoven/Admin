import { describe, it, expect } from "vitest";
import { formatDuration, tourEndDate, isMultiDay } from "../../app/lib/duration";

describe("formatDuration", () => {
  it("renders minutes below an hour and non-whole hours", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(90)).toBe("90 min");
  });
  it("renders whole hours", () => {
    expect(formatDuration(60)).toBe("1 hour");
    expect(formatDuration(180)).toBe("3 hours");
  });
  it("renders days at 1440+ minutes", () => {
    expect(formatDuration(1440)).toBe("1 day");
    expect(formatDuration(4320)).toBe("3 days");
    expect(formatDuration(2160)).toBe("1.5 days");
  });
  it("handles null/undefined/zero", () => {
    expect(formatDuration(null)).toBe("0 min");
    expect(formatDuration(undefined)).toBe("0 min");
  });
});

describe("isMultiDay", () => {
  it("is true from 1440 minutes up", () => {
    expect(isMultiDay(1439)).toBe(false);
    expect(isMultiDay(1440)).toBe(true);
    expect(isMultiDay(null)).toBe(false);
  });
});

describe("tourEndDate", () => {
  it("ends ON the last day for whole-day durations (3-day tour departing Mon ends Wed)", () => {
    const end = tourEndDate("2026-07-13T07:00:00.000Z", 4320)!; // Mon
    expect(end.toISOString()).toBe("2026-07-15T07:00:00.000Z"); // Wed
  });
  it("returns the start for sub-day durations", () => {
    const end = tourEndDate("2026-07-13T07:00:00.000Z", 90)!;
    expect(end.toISOString()).toBe("2026-07-13T07:00:00.000Z");
  });
  it("is null for invalid input", () => {
    expect(tourEndDate("", 4320)).toBeNull();
    expect(tourEndDate("not-a-date", 4320)).toBeNull();
  });
});
