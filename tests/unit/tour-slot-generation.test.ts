import { describe, expect, it } from "vitest";
import { buildTourSlotStartTimes, type TourSlotSchedule } from "../../app/lib/tour-slot-generation";

const schedule: TourSlotSchedule = {
  slotDateMode: "specific",
  slotDates: ["2026-10-12", "2026-10-24"],
  slotStartDate: "2026-10-01",
  slotEndDate: "2026-10-31",
  slotDays: [0],
  slotTimes: ["09:00", "14:30"],
};
const timezone = "Africa/Johannesburg";

describe("tour departure schedules", () => {
  it("creates every departure time only on the chosen dates, regardless of the range or weekdays", () => {
    expect(buildTourSlotStartTimes(schedule, timezone)).toEqual([
      "2026-10-12T07:00:00.000Z", "2026-10-12T12:30:00.000Z",
      "2026-10-24T07:00:00.000Z", "2026-10-24T12:30:00.000Z",
    ]);
    expect(buildTourSlotStartTimes({ ...schedule, slotDays: [] }, timezone)).toHaveLength(4);
  });

  it("ignores empty date rows and removes duplicate dates and times", () => {
    expect(buildTourSlotStartTimes({ ...schedule, slotDates: ["", "2026-10-24", "2026-10-12", "2026-10-24"], slotTimes: ["09:00", "", "09:00"] }, timezone)).toEqual([
      "2026-10-12T07:00:00.000Z", "2026-10-24T07:00:00.000Z",
    ]);
  });

  it("keeps inclusive date ranges and weekday filtering when range mode is selected", () => {
    expect(buildTourSlotStartTimes({ ...schedule, slotDateMode: "range", slotStartDate: "2026-10-10", slotEndDate: "2026-10-17", slotDays: [6], slotTimes: ["09:00"] }, timezone)).toEqual([
      "2026-10-10T07:00:00.000Z", "2026-10-17T07:00:00.000Z",
    ]);
  });

  it("uses the operator timezone across daylight saving changes and UTC date boundaries", () => {
    expect(buildTourSlotStartTimes({ ...schedule, slotDates: ["2026-10-03", "2026-10-04"], slotTimes: ["09:00"] }, "Australia/Sydney")).toEqual([
      "2026-10-02T23:00:00.000Z", "2026-10-03T22:00:00.000Z",
    ]);
  });

  it.each([
    [{ slotDates: [""] }, /at least one specific date/],
    [{ slotDates: ["2026-02-30"] }, /valid tour dates/],
    [{ slotTimes: ["", " "] }, /at least one start time/],
    [{ slotTimes: ["24:00"] }, /valid start times/],
    [{ slotDateMode: "range", slotStartDate: "" }, /start date and an end date/],
    [{ slotDateMode: "range", slotStartDate: "2026-11-01" }, /on or after/],
    [{ slotDateMode: "range", slotDays: [] }, /at least one day of the week/],
    [{ slotDateMode: "range", slotStartDate: "2026-10-12", slotEndDate: "2026-10-12" }, /no matching days/],
  ] as Array<[Partial<TourSlotSchedule>, RegExp]>)("rejects an incomplete or invalid schedule: %j", (changes, error) => {
    expect(() => buildTourSlotStartTimes({ ...schedule, ...changes }, timezone)).toThrow(error);
  });
});

describe("compact 24-hour departure input", () => {
  it("accepts 1800 and 18:00 as the same departure", () => {
    expect(buildTourSlotStartTimes({ ...schedule, slotDates: ["2026-10-12"], slotTimes: ["1800", "18:00", "18", "0930", "930"] }, timezone)).toEqual([
      "2026-10-12T16:00:00.000Z", "2026-10-12T07:30:00.000Z",
    ]);
  });
  it("preserves GMT when the departure timezone is UTC", () => {
    expect(buildTourSlotStartTimes({ ...schedule, slotDates: ["2026-10-12"], slotTimes: ["1800", "0000"] }, "UTC")).toEqual([
      "2026-10-12T18:00:00.000Z", "2026-10-12T00:00:00.000Z",
    ]);
  });
  it.each(["2400", "1860", "18000", "6pm", "18:000", "-1800"])("rejects invalid time %s without shifting it", time => {
    expect(() => buildTourSlotStartTimes({ ...schedule, slotTimes: [time] }, timezone)).toThrow(/valid start times/);
  });
});
