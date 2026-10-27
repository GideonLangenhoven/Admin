import { describe, expect, it } from "vitest";
import { webChatFixture } from "../helpers/web-chat-fixture";

function fixture() {
  const f = webChatFixture();
  f.settings.llmAvailable = false;
  f.tour.name = "Morning Kayak";
  f.tour.base_price_per_person = 600;
  f.slot.start_time = f.bookingState.selectedDate + "T08:30:00+02:00";
  const next = new Date(f.bookingState.selectedDate + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const secondDate = next.toISOString().slice(0, 10);
  f.rows.slots.push({ ...f.slot, id: "later", start_time: secondDate + "T11:00:00+02:00" });
  for (const [id, name, price] of [["sunset", "Sunset Paddle", 500], ["hike", "Midday Hike", 700]] as const) {
    f.rows.tours.push({ ...f.tour, id, name, base_price_per_person: price });
    f.rows.slots.push({ ...f.slot, id: id + "-slot", tour_id: id, start_time: secondDate + (id === "sunset" ? "T17:00:00+02:00" : "T12:00:00+02:00") });
  }
  const contacts = { name: "Zoë O'Neill", email: "zoe@fixture.invalid", phone: "+353 87 123 4567" };
  const contactState = { ...f.bookingState, ...contacts, step: "ASK_DETAILS", tname: f.tour.name, tprice: 600, total: 1200, baseTotal: 1200, slotTime: f.slot.start_time, pendingDate: f.bookingState.selectedDate, pendingTime: "08:30", custom_fields: { old: "answer" }, custom_field_defs: [{ key: "old" }], extras: [{ id: "old-extra" }], vid: "old-voucher", vded: 10 };
  return { ...f, contacts, contactState, secondDate };
}

describe("guest booking corrections at contact collection", () => {
  it.each(["Switch from Morning Kayak to Sunset Paddle", "I want Sunset Paddle instead of Morning Kayak", "Not Morning Kayak, Sunset Paddle instead", "Switch to paddle"])("uses the requested tour and excludes a named old tour: %s", async message => {
    const f = fixture();
    const result = await f.post(await f.session(), message, f.contactState);
    expect(result.state).toMatchObject({ step: "PICK_DATE", tid: "sunset", ...f.contacts });
    expect(result.state.slotId).toBeFalsy();
    expect(result.state.total).toBeUndefined();
  });

  it("reopens tour selection when the old tour is rejected without a replacement", async () => {
    const f = fixture();
    const result = await f.post(await f.session(), "I don't want Morning Kayak", f.contactState);
    expect(result.state.step).toBe("PICK_TOUR");
    expect(result.state.tid).toBeFalsy();
    expect(result.state.name).toBe(f.contacts.name);
  });

  it.each(["Switch to Dolphin Cruise", "Please change to Dolphin Cruise", "Can we swap to Dolphin Cruise?"])("asks for a valid tour when a switch names an unknown experience: %s", async message => {
    const f = fixture();
    const result = await f.post(await f.session(), message, f.contactState);
    expect(result.state).toMatchObject({ step: "PICK_TOUR", ...f.contacts });
    expect(result.state.tid).toBeFalsy();
    expect(result.state.slotId).toBeFalsy();
    expect(result.state.total).toBeFalsy();
    expect(result.reply).toMatch(/which tour/i);
  });

  it("switches named tours twice without retaining an old schedule, quote or tour-specific answers", async () => {
    const f = fixture();
    const token = await f.session();
    let result = await f.post(token, "Please switch to Sunset Paddle", f.contactState);
    expect(result.state).toMatchObject({ step: "PICK_DATE", tid: "sunset", tname: "Sunset Paddle", ...f.contacts, requestedQty: 2 });
    for (const field of ["slotId", "slotTime", "selectedDate", "pendingDate", "pendingTime", "total", "baseTotal", "custom_fields", "custom_field_defs", "extras", "vid"]) expect(result.state[field]).toBeFalsy();
    expect(result.reply).toContain("Sunset Paddle");
    for (const msg of ["btn:" + f.secondDate, "btn:sunset-slot", "btn:qty:2"]) result = await f.post(token, msg, result.state);
    expect(result.state).toMatchObject({ step: "ASK_DETAILS", total: 1000 });
    result = await f.post(token, "Can we change the tour to Midday Hike?", result.state);
    expect(result.state).toMatchObject({ step: "PICK_DATE", tid: "hike", tname: "Midday Hike", ...f.contacts });
    for (const msg of ["btn:" + f.secondDate, "btn:hike-slot", "btn:qty:2", "Zoë O'Neill", "btn:no_voucher"]) result = await f.post(token, msg, result.state);
    expect(result.state).toMatchObject({ step: "CONFIRM", tid: "hike", slotId: "hike-slot", qty: 2, total: 1400 });
    expect(result.reply).toContain("Midday Hike");
    expect(result.reply).toContain("12:00");
    expect(result.reply).toContain("R1400");
    expect(result.reply).not.toMatch(/Morning Kayak|Sunset Paddle|08:30|17:00|R1200|R1000/);
    expect(f.rows.bookings).toEqual([]);
  });

  it("asks a focused question for an ambiguous tour request before parsing it as contact data", async () => {
    const f = fixture();
    const result = await f.post(await f.session(), "Change to Morning Kayak or Sunset Paddle", f.contactState);
    expect(result.state.step).toBe("PICK_TOUR");
    expect(result.state.tid).toBeFalsy();
    expect(result.state.name).toBe(f.contacts.name);
    expect(result.reply).toMatch(/which.*tour/i);
    expect(result.buttons.map((button: any) => button.value)).toEqual(expect.arrayContaining([f.tour.id, "sunset"]));
  });

  it.each(["Email: guest.example.com", "Phone: abcdef", "Email: guest@@example.com"])("rejects malformed contact input without using it as a name: %s", async message => {
    const f = fixture();
    const state = { ...f.contactState, name: "", email: "", phone: "" };
    const result = await f.post(await f.session(), message, state);
    expect(result.state).toMatchObject({ step: "ASK_DETAILS", name: "", email: "", phone: "" });
    expect(result.reply).toMatch(message.startsWith("Email") ? /valid email/i : /valid phone/i);
  });

  it.each(["Zoë O'Neill", "María del Carmen de la Cruz Fernández", "李小龍", "Jean-Luc D’Arcy"])("preserves an international name exactly: %s", async name => {
    const f = fixture();
    const result = await f.post(await f.session(), name, { ...f.contactState, name: "", email: "", phone: "" });
    expect(result.state.name).toBe(name);
    expect(result.state.step).toBe("ASK_DETAILS");
  });

  it.each([["Email: wednesday@fixture.invalid", "email", "wednesday@fixture.invalid"], ["Name: Friday Moyo", "name", "Friday Moyo"]])("treats a weekday inside contact input as a detail: %s", async (message, field, value) => {
    const f = fixture();
    const result = await f.post(await f.session(), message, { ...f.contactState, name: "", email: "", phone: "" });
    expect(result.state).toMatchObject({ step: "ASK_DETAILS", selectedDate: f.contactState.selectedDate, slotId: f.slot.id, [field]: value });
    expect(result.reply).not.toMatch(/available departures|which date|which time/i);
  });

  it("forgets a rejected time when choosing a different date", async () => {
    const f = fixture();
    const token = await f.session();
    let result = await f.post(token, "6am", { ...f.contactState, step: "PICK_TIME" });
    expect(result.state).toMatchObject({ step: "PICK_TIME", pendingTime: "06:00" });
    expect(result.reply).toContain("06:00");
    result = await f.post(token, "Change date to " + f.secondDate, result.state);
    expect(result.state).toMatchObject({ step: "PICK_TIME", selectedDate: f.secondDate });
    expect(result.state.pendingTime).toBeFalsy();
    expect(result.state.slotId).toBeFalsy();
    expect(result.reply).not.toContain("06:00");
    expect(result.buttons).toEqual([{ label: "11:00 (10 spots)", value: "later" }]);
  });

  it("produces contact instructions without Markdown delimiters", async () => {
    const f = fixture();
    const result = await f.post(await f.session(), "2", { ...f.contactState, step: "ASK_QTY" });
    expect(result.state.step).toBe("ASK_DETAILS");
    expect(result.reply).not.toContain("*");
    expect(result.reply).toContain("one at a time");
  });

  it.each(["Change party size to 3 people", "Make it 3 people", "Change the number of people to 3", "3 people"])("applies the requested count instead of asking again: %s", async message => {
    const f = fixture();
    const result = await f.post(await f.session(), message, f.contactState);
    expect(result.state).toMatchObject({ step: "ASK_DETAILS", qty: 3, requestedQty: 3, total: 1800, ...f.contacts });
    expect(result.reply).toContain("3 people");
    expect(result.reply).not.toMatch(/how many/i);
  });

  for (const capacity of [3, 6]) {
    it.each([2, capacity, capacity + 1])(`rechecks a changed count of %i against ${capacity} available spots and the current rate`, async qty => {
      const f = fixture();
      f.slot.available_capacity = capacity;
      f.slot.price_per_person_override = 650 as any;
      const result = await f.post(await f.session(), `Make it ${qty} people`, f.contactState);
      expect(result.state).toMatchObject(f.contacts);
      expect(result.state.vid).toBeUndefined();
      if (qty <= capacity) {
        expect(result.state).toMatchObject({ step: "ASK_DETAILS", qty, tprice: 650, total: qty * 650 * (qty >= 6 ? 0.95 : 1) });
        expect(result.reply).not.toMatch(/how many/i);
      } else {
        expect(result.state.step).toBe("ASK_QTY");
        expect(result.state.qty).not.toBe(qty);
        expect(result.state.total).toBeUndefined();
        expect(result.reply).toContain(`${capacity} spots`);
      }
      expect(f.rows.bookings).toEqual([]);
    });
  }

  it.each(["Make it 3 or 4 people", "Change party size to -2 people", "Change party size to 1.5 people"])("asks for a valid unambiguous count: %s", async message => {
    const f = fixture();
    const result = await f.post(await f.session(), message, f.contactState);
    expect(result.state).toMatchObject({ step: "ASK_QTY", qty: 2 });
    expect(result.state.total).toBeUndefined();
    expect(result.reply).toMatch(/how many/i);
  });

  it("clears the rejected time when a different date is selected from the calendar", async () => {
    const f = fixture();
    const token = await f.session();
    const rejected = await f.post(token, "6am", { ...f.contactState, step: "PICK_TIME" });
    const back = await f.post(token, "back", rejected.state);
    const selected = await f.post(token, "btn:" + f.secondDate, back.state);
    expect(selected.state).toMatchObject({ step: "PICK_TIME", selectedDate: f.secondDate });
    expect(selected.state.pendingTime).toBeFalsy();
    expect(selected.reply).not.toContain("06:00");
    expect(selected.buttons).toEqual([{ label: "11:00 (10 spots)", value: "later" }]);
    const oldButton = await f.post(token, "btn:" + f.slot.id, selected.state);
    expect(oldButton.state.slotId).toBeFalsy();
    expect(oldButton.buttons.map((button: any) => button.value)).toEqual(["later"]);
  });

  it("honours a newly supplied time on a newly supplied date", async () => {
    const f = fixture();
    const result = await f.post(await f.session(), "Change date to " + f.secondDate + " at 11am", f.contactState);
    expect(result.state).toMatchObject({ step: "ASK_QTY", selectedDate: f.secondDate, slotId: "later", pendingTime: "11:00" });
  });

  it.each(["Email: nope", "Phone: invalid", "Name: <script>alert(1)</script>", "   "])("does not advance or overwrite previously valid contacts: %s", async message => {
    const f = fixture();
    const result = await f.post(await f.session(), message, f.contactState);
    expect(result.state).toMatchObject({ step: "ASK_DETAILS", ...f.contacts });
    expect(Object.keys(result.validationErrors).length).toBeGreaterThan(0);
    expect(f.rows.bookings).toEqual([]);
  });

  it.each(["name", "email", "phone"])("rejects missing %s at confirmation without erasing another field", async field => {
    const f = fixture();
    const result = await f.post(await f.session(), "btn:confirm", { ...f.bookingState, [field]: " " });
    expect(result.state).toMatchObject({ ...f.bookingState, step: "ASK_DETAILS", [field]: "" });
    expect(result.validationErrors[field]).toBeTruthy();
    expect(f.rows.bookings).toEqual([]);
    expect(f.calls.filter(call => call.kind === "fetch")).toEqual([]);
  });

  it.each(["Morning Kayak", "Sunset Paddle", "Midday Hike"])("completes %s up to contact collection using the actual handler", async name => {
    const f = fixture();
    const tour = f.rows.tours.find(tour => tour.name === name)!;
    const token = await f.session();
    let result = await f.post(token, "btn:book");
    result = await f.post(token, "btn:" + tour.id, result.state);
    result = await f.post(token, "btn:" + result.calendar[0].date, result.state);
    result = await f.post(token, "btn:" + result.buttons[0].value, result.state);
    result = await f.post(token, "2 people", result.state);
    expect(result.state).toMatchObject({ step: "ASK_DETAILS", tid: tour.id, total: 2 * tour.base_price_per_person });
    expect(result.reply).not.toContain("*");
    expect(f.rows.bookings).toEqual([]);
  });
});
