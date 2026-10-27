import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";
import { webChatFixture } from "../helpers/web-chat-fixture";

const source = "supabase/functions/web-chat/index.ts";
const parseDate = sourceFunction(source, "parseChatDate", {});
const parseTime = sourceFunction(source, "parseChatTime", {});

describe("requested booking dates and times", () => {
  it.each([
    ["2026-10-05", "2026-10-14"],
    ["2026-10-04", "2026-10-07"],
    ["2026-10-30", "2026-11-04"],
    ["2026-12-28", "2027-01-06"],
  ])("resolves next week Wednesday from %s to %s", (today, expected) => {
    expect(parseDate("Please get me a booking for next week Wednesday", today)).toBe(expected);
  });

  it.each(["I asked for next Wednesday not Tuesday", "Wednesday, not Tuesday", "Not Tuesday, Wednesday please"])(
    "uses the requested weekday and excludes the rejected weekday: %s", message => {
      expect(parseDate(message, "2026-10-05")).toBe("2026-10-07");
    },
  );
  it("respects the calendar date supplied alongside its weekday", () => {
    expect(parseDate("Wednesday 14 October", "2026-10-05")).toBe("2026-10-14");
    expect(parseDate("I don't want Tuesday, Wednesday please", "2026-10-05")).toBe("2026-10-07");
  });

  it.each([
    ["I want to kayak next morning for the 6am slot", "06:00"],
    ["Wednesday at 6:30 am please", "06:30"],
    ["I asked for 6am not 8:30", "06:00"],
    ["Can we change to 6 pm?", "18:00"],
    ["Book for 4 people at 06:00", "06:00"],
    ["4 people", null], ["2026-10-14", null], ["25:00", null],
    ["6am or 8am", null], ["Not 6am", null], ["I don’t want 6am", null],
  ])("extracts only an unambiguous time: %s", (message, expected) => {
    expect(parseTime(message)).toBe(expected);
  });
});

function reportedFixture(wednesdayTime: "06:00" | "08:30" | null = "06:00") {
  const f = webChatFixture();
  f.tour.name = "Morning Kayak";
  f.tour.base_price_per_person = 600;
  Object.assign(f.slot, { id: "tuesday", start_time: "2026-10-13T08:30:00+02:00", available_capacity: 16, capacity_total: 16 });
  if (wednesdayTime) f.rows.slots.push({ ...f.slot, id: "wednesday", start_time: "2026-10-14T" + wednesdayTime + ":00+02:00" });
  f.rows.tours.push({ ...f.tour, id: "sunset", name: "Sunset Paddle", base_price_per_person: 500 });
  f.rows.tours.push({ ...f.tour, id: "hike", name: "Midday Hike", base_price_per_person: 700 });
  f.rows.slots.push({ ...f.slot, id: "sunset-slot", tour_id: "sunset" }, { ...f.slot, id: "hike-slot", tour_id: "hike" });
  return f;
}

describe("the reported Wednesday conversation", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-05T10:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  for (const modelAvailable of [true, false]) {
    it(`remembers the request across the hamburger detour and corrections (model ${modelAvailable ? "on" : "off"})`, async () => {
      const f = reportedFixture();
      f.settings.llmAvailable = modelAvailable;
      const token = await f.session();
      const unrelated = await f.post(token, "I want a handburger");
      expect(unrelated.state.step).toBe("IDLE");
      const requested = await f.post(token, "no please get me a booking for next week Wednesday", unrelated.state);
      expect(requested.state).toMatchObject({ step: "PICK_TOUR", pendingDate: "2026-10-14" });
      const selected = await f.post(token, "I want to kayak next morning for the 6am slot", requested.state);
      expect(selected.state).toMatchObject({ step: "ASK_QTY", tid: f.tour.id, selectedDate: "2026-10-14", slotId: "wednesday" });
      expect(selected.reply).toContain("Wednesday");
      expect(selected.reply).toContain("06:00");
      let result = selected;
      for (const correction of ["I asked for the Wednesday", "I asked for next Wednesday not Tuesday"]) {
        result = await f.post(token, correction, result.state);
        expect(result.state).toMatchObject({ step: "ASK_QTY", selectedDate: "2026-10-14", slotId: "wednesday" });
        expect(result.reply).toContain("Wednesday");
        expect(result.reply).not.toContain("Tuesday");
      }
      expect(f.calls.filter(call => call.kind === "llm" && ["web-date", "web-faq"].includes(call.name)).slice(modelAvailable ? 1 : 0)).toEqual([]);
      expect(f.rows.bookings).toEqual([]);
      expect(f.rows.conversations.some(row => row.status === "HUMAN")).toBe(false);
    });
  }

  it("explains that Wednesday is unavailable without selecting Tuesday or asking for guests", async () => {
    const f = reportedFixture(null);
    f.settings.llmAvailable = false;
    const token = await f.session();
    const first = await f.post(token, "no please get me a booking for next week Wednesday");
    let result = await f.post(token, "I want to kayak next morning for the 6am slot", first.state);
    for (const correction of [null, "I asked for the Wednesday", "I asked for next Wednesday not Tuesday"]) {
      if (correction) result = await f.post(token, correction, result.state);
      expect(result.state).toMatchObject({ step: "PICK_DATE", pendingDate: "2026-10-14", pendingTime: "06:00" });
      expect(result.state.slotId).toBeFalsy();
      expect(result.state.selectedDate).toBeFalsy();
      expect(result.reply).toMatch(/no .*available.*Wed, 14 Oct/i);
      expect(result.reply).not.toMatch(/great pick|how many|Times for Tue/);
      expect(result.calendar).toEqual(expect.arrayContaining([expect.objectContaining({ date: "2026-10-13" })]));
    }
  });

  it("offers 08:30 as an explicit alternative when Wednesday has no 06:00 departure", async () => {
    const f = reportedFixture("08:30");
    const token = await f.session();
    const result = await f.post(token, "Book Morning Kayak next week Wednesday at 6am");
    expect(result.state).toMatchObject({ step: "PICK_TIME", selectedDate: "2026-10-14", pendingTime: "06:00" });
    expect(result.state.slotId).toBeFalsy();
    expect(result.reply).toMatch(/no .*06:00.*Wed, 14 Oct/i);
    expect(result.reply).not.toMatch(/great pick|how many/);
    expect(result.buttons).toContainEqual({ label: "08:30 (16 spots)", value: "wednesday" });
    const accepted = await f.post(token, "btn:wednesday", result.state);
    expect(accepted.state).toMatchObject({ step: "ASK_QTY", slotId: "wednesday", pendingTime: "08:30" });
  });

  it("uses a new date, time and party size supplied while choosing a tour", async () => {
    const f = reportedFixture();
    const result = await f.post(await f.session(), "Morning Kayak next week Wednesday at 6am for 4 people", { step: "PICK_TOUR", pendingDate: "2026-10-13", pendingTime: "08:30", requestedQty: 2 });
    expect(result.state).toMatchObject({ step: "ASK_QTY", selectedDate: "2026-10-14", slotId: "wednesday", requestedQty: 4 });
    expect(result.reply).toContain("4 people");
  });

  it.each(["ASK_QTY", "ASK_DETAILS", "ASK_CUSTOM_FIELD", "ASK_VOUCHER", "ENTER_VOUCHER", "CONFIRM"])(
    "handles a date correction before consuming a %s answer", async step => {
      const f = reportedFixture();
      const previous = { ...f.bookingState, step, tid: f.tour.id, tname: f.tour.name, slotId: "tuesday", slotTime: f.slot.start_time, selectedDate: "2026-10-13", pendingDate: "2026-10-14", pendingTime: "06:00", vcode: "OLD", vid: "old-voucher" };
      const result = await f.post(await f.session(), "I asked for next Wednesday not Tuesday", previous);
      expect(result.state).toMatchObject({ step: "ASK_QTY", selectedDate: "2026-10-14", slotId: "wednesday", name: previous.name, email: previous.email });
      expect(result.state.checkout_attempt).not.toBe(previous.checkout_attempt);
      expect(result.state.vid).toBeUndefined();
      expect(result.state.total).toBeUndefined();
      expect(result.reply).toContain("Wednesday");
      expect(result.reply).not.toContain("Tuesday");
      expect(f.rows.bookings).toEqual([]);
    },
  );

  it("changes an explicitly corrected time without keeping the old slot", async () => {
    const f = reportedFixture();
    f.rows.slots.push({ ...f.slot, id: "late-wednesday", start_time: "2026-10-14T08:30:00+02:00" });
    const result = await f.post(await f.session(), "I asked for 6am not 8:30", { ...f.bookingState, step: "ASK_QTY", tid: f.tour.id, slotId: "late-wednesday", slotTime: "2026-10-14T08:30:00+02:00", selectedDate: "2026-10-14" });
    expect(result.state).toMatchObject({ step: "ASK_QTY", slotId: "wednesday", selectedDate: "2026-10-14", pendingTime: "06:00" });
  });

  it.each(["Not Tuesday", "Not 08:30", "I don't want Tuesday", "I don’t want 08:30"])("clears a rejected departure before asking another booking question: %s", async message => {
    const f = reportedFixture();
    const result = await f.post(await f.session(), message, { ...f.bookingState, step: "ASK_QTY", tid: f.tour.id, tname: f.tour.name, slotId: "tuesday", slotTime: f.slot.start_time, selectedDate: "2026-10-13" });
    expect(result.state.step).toBe(message.includes("Tuesday") ? "PICK_DATE" : "PICK_TIME");
    expect(result.state.slotId).toBeUndefined();
    expect(result.reply).not.toMatch(/how many/i);
  });

  it.each(["I don't want a booking", "I want to know more about Morning Kayak"])("does not mistake information or a refusal for purchase intent: %s", async message => {
    const f = reportedFixture();
    const result = await f.post(await f.session(), message);
    expect(result.state.step).toBe("IDLE");
  });

  it("keeps the requested week when the next reply repeats Wednesday and adds a time", async () => {
    const f = reportedFixture();
    const result = await f.post(await f.session(), "Morning Kayak next Wednesday at 6am", { step: "PICK_TOUR", pendingDate: "2026-10-14" });
    expect(result.state).toMatchObject({ step: "ASK_QTY", slotId: "wednesday", selectedDate: "2026-10-14" });
  });

  it("keeps booking selections when a trip question merely mentions a weekday", async () => {
    const f = reportedFixture();
    f.settings.llmAvailable = false;
    const state = { ...f.bookingState, step: "ASK_DETAILS" };
    const result = await f.post(await f.session(), "What should I bring on Wednesday?", state);
    expect(result.state).toMatchObject({ step: state.step, slotId: state.slotId, selectedDate: state.selectedDate });
    expect(result.reply).toContain(f.business.what_to_bring);
  });
});
