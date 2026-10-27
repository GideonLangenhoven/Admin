import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

const durationUnits = { min: 1, hours: 60, days: 1440 };
const editDuration = sourceFunction("app/settings/page.tsx", "minutesToDurationForm", {});

describe("tour duration editing", () => {
  it.each([
    [150, "2", "hours", "30"], [90, "1", "hours", "30"], [120, "2", "hours", "0"],
    [45, "45", "min", "0"], [4320, "3", "days", "0"], [null, "", "min", "0"],
  ])("loads %s minutes without changing the tour length", (minutes, duration, durationUnit, durationMinutes) => {
    expect(editDuration(minutes)).toEqual({ duration, durationUnit, durationMinutes });
  });
});

function fixture(duration: string, durationMinutes = "0", durationUnit = "hours", editing = true) {
  const insert = vi.fn();
  const update = vi.fn();
  const query = { eq: vi.fn(async () => ({ error: null })), select: () => ({ single: async () => ({ data: { id: "new-tour" }, error: null }) }) };
  insert.mockReturnValue(query);
  update.mockReturnValue(query);
  const setTourError = vi.fn();
  const save = sourceFunction("app/settings/page.tsx", "handleSaveTour", {
    tourForm: { name: "Kelp tour", description: "Marine adventure", price: "600", duration, durationMinutes, durationUnit,
      slotTimes: [""], slotDateMode: "specific", slotDates: [""], lastMinuteHours: "", lastMinuteEndHours: "", lastMinutePrice: "",
      confirmationTagline: "", image_url: "", voucher_image_url: "", sort_order: "0", active: true, default_capacity: "10" },
    DURATION_UNIT_MINUTES: durationUnits, editingTour: editing ? { id: "tour" } : null,
    businessId: "operator", supabase: { from: () => ({ insert, update }) },
    setTourError, setTourSaving: vi.fn(), resetTourForm: vi.fn(), fetchTours: vi.fn(),
  });
  return { save: () => save({ preventDefault: vi.fn() }), insert, update, setTourError };
}

describe("tour duration saving", () => {
  it.each([true, false])("saves 2 hours and 30 minutes as 150 minutes (editing=%s)", async editing => {
    const f = fixture("2", "30", "hours", editing);
    await f.save();
    expect(editing ? f.update : f.insert).toHaveBeenCalledWith(expect.objectContaining({ duration_minutes: 150 }));
  });
  it.each([
    ["0", "30", "hours", 30], ["45", "0", "min", 45], ["3", "0", "days", 4320],
  ])("saves a valid duration %s + %s %s", async (duration, extraMinutes, unit, total) => {
    const f = fixture(duration, extraMinutes, unit);
    await f.save();
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ duration_minutes: total }));
  });
  it.each([["0", "0"], ["2", "60"], ["2", "-1"], ["2", "30.5"], ["-1", "30"], ["1.5", "0"], ["abc", "0"], ["", "30"]])("rejects invalid duration %s hours + %s minutes before saving", async (duration, minutes) => {
    const f = fixture(duration, minutes);
    await f.save();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.insert).not.toHaveBeenCalled();
    expect(f.setTourError).toHaveBeenCalledWith(expect.any(String));
  });
});
