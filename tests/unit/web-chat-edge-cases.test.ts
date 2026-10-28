import { describe, expect, it } from "vitest";
import { webChatFixture } from "../helpers/web-chat-fixture";

type Fixture = ReturnType<typeof webChatFixture>;

async function managedBooking(f: Fixture) {
  const booking = {
    id: "booking-a", business_id: f.business.id, email: "guest@fixture.invalid",
    customer_name: "Fixture Guest", phone: "+27110000000", qty: 2,
    unit_price: 400, total_amount: 800, total_captured: 800, status: "PAID",
    slot_id: f.slot.id, tour_id: f.tour.id,
    slots: { start_time: f.slot.start_time }, tours: { name: f.tour.name },
  };
  f.rows.bookings.push(booking);
  const token = await f.session();
  const customer = await f.verifiedCustomer();
  return {
    booking,
    post: async (message: string, step: string, extra = {}) => {
      const response = await f.request({ chat_session: token, customer_session: customer,
        message, state: { step, booking_id: booking.id, ...extra } });
      return { status: response.status, ...await response.json() };
    },
  };
}

describe("web chat destructive-action consent", () => {
  it("does not invent a refund when the operator policy cannot be loaded", async () => {
    const f = webChatFixture();
    const customer = await managedBooking(f);
    f.failures["rpc:calculate_refund_percent"] = { message: "Policy unavailable" };
    const result = await customer.post("btn:cancel", "PICK_ACTION");
    expect(result.state.step).toBe("REVIEW_REQUEST");
    expect(result.reply).not.toMatch(/95%|receive a.*refund/);
    expect(f.calls.filter(call => call.kind === "invoke")).toEqual([]);
  });

  for (const text of ["btn:cancel_action", "no, keep it", "do not cancel", "don't cancel", "yes, but don't cancel yet", "Can I cancel?", "what happens if I cancel?"]) {
    it(`keeps the booking when cancellation was not confirmed: ${text}`, async () => {
      const f = webChatFixture();
      const customer = await managedBooking(f);
      await customer.post(text, "CONFIRM_CANCEL");
      expect(f.calls.filter(call => call.kind === "invoke")).toEqual([]);
      expect(customer.booking.status).toBe("PAID");
    });
  }

  for (const text of ["btn:confirm_cancel", "yes", "yes, cancel", "please cancel"]) {
    it(`cancels only the verified booking with explicit consent: ${text}`, async () => {
      const f = webChatFixture();
      const customer = await managedBooking(f);
      await customer.post(text, "CONFIRM_CANCEL");
      expect(f.calls.filter(call => call.kind === "invoke")).toMatchObject([
        { name: "rebook-booking", data: { body: { booking_id: customer.booking.id, action: "CANCEL_REFUND" } } },
      ]);
    });
  }

  for (const text of ["don't resend", "yes, but don't send yet", "Can you resend it later?"]) {
    it(`does not email without consent: ${text}`, async () => {
      const f = webChatFixture();
      const customer = await managedBooking(f);
      await customer.post(text, "RESEND_CONFIRM");
      expect(f.calls.filter(call => call.kind === "fetch")).toEqual([]);
    });
  }

  for (const email of ["error", "throw", "invalid"]) {
    it(`does not claim an email was sent after provider ${email}`, async () => {
      const f = webChatFixture();
      const customer = await managedBooking(f);
      f.settings.email = email;
      const result = await customer.post("btn:resend_email", "RESEND_CONFIRM");
      expect(result.reply).not.toMatch(/^Sent!/i);
      expect(result.reply).toMatch(/couldn't|could not|wrong|try again|unavailable/i);
    });
  }

  it("does not submit a review request that the guest negates", async () => {
    const f = webChatFixture();
    const customer = await managedBooking(f);
    await customer.post("don't send yet", "REVIEW_REQUEST", { action: "reschedule" });
    expect(f.rows.chat_messages.some(row => String(row.body).includes("[URGENT]"))).toBe(false);
    expect(f.rows.conversations.some(row => row.status === "HUMAN")).toBe(false);
  });

  it("places a requested booking review in the same web conversation for a human", async () => {
    const f = webChatFixture();
    const customer = await managedBooking(f);
    const result = await customer.post("btn:req_reschedule", "REVIEW_REQUEST", { action: "reschedule" });
    expect(result.state.status).toBe("HUMAN");
    expect(f.rows.conversations.some(row => row.status === "HUMAN" && row.phone.startsWith("web:"))).toBe(true);
    expect(f.rows.chat_messages.every(row => row.phone.startsWith("web:"))).toBe(true);
  });
});

describe("web chat changes reflect the actual booking service result", () => {
  for (const response of [{ ok: "false", diff: 0 }, { ok: true, diff: "bad amount" }, { ok: true, diff: 200, payment_url: "javascript:alert(1)" }]) {
    it(`does not claim success for malformed amendment data ${JSON.stringify(response)}`, async () => {
      const f = webChatFixture();
      const customer = await managedBooking(f);
      f.rows.slots.push({ ...f.slot, id: "new-slot" });
      f.db.functions.invoke = async () => ({ data: response as any, error: null });
      const result = await customer.post("btn:new-slot", "RESCH_DATE");
      expect(result.paymentUrl).toBeFalsy();
      expect(result.reply).not.toMatch(/Rescheduled to|Timeslot updated/);
      expect(customer.booking.slot_id).toBe(f.slot.id);
    });
  }

  for (const change of ["closed", "past", "full", "wrong-tour"]) {
    it(`does not reschedule from a stale ${change} departure button`, async () => {
      const f = webChatFixture();
      const customer = await managedBooking(f);
      f.rows.slots.push({ ...f.slot, id: "new-slot", status: change === "closed" ? "CLOSED" : "OPEN",
        available_capacity: change === "full" ? 1 : 10, tour_id: change === "wrong-tour" ? "other-tour" : f.tour.id,
        start_time: new Date(Date.now() + (change === "past" ? -1 : 96) * 3_600_000).toISOString() });
      await customer.post("btn:new-slot", "RESCH_DATE");
      expect(f.calls.filter(call => call.kind === "invoke")).toEqual([]);
      expect(customer.booking.slot_id).toBe(f.slot.id);
    });
  }

  it("rechecks the cutoff when a previously valid reschedule button is clicked", async () => {
    const f = webChatFixture();
    const customer = await managedBooking(f);
    customer.booking.slots.start_time = new Date(Date.now() + 12 * 3_600_000).toISOString();
    f.rows.slots.push({ ...f.slot, id: "new-slot" });
    const result = await customer.post("btn:new-slot", "RESCH_DATE");
    expect(result.state.step).toBe("REVIEW_REQUEST");
    expect(f.calls.filter(call => call.kind === "invoke")).toEqual([]);
  });

  it("lets verified guests select the exact booking before offering mutations", async () => {
    const f = webChatFixture();
    const customer = await managedBooking(f);
    f.rows.bookings.push({ ...customer.booking, id: "booking-second", customer_name: "Second booking" });
    const choices = await customer.post("guest@fixture.invalid", "LOOKUP");
    expect(choices.state.step).toBe("LOOKUP");
    expect(choices.buttons).toHaveLength(2);
    const second = choices.buttons.find((button: any) => button.value.includes("booking-second"));
    const selected = await customer.post("btn:" + second.value, "LOOKUP");
    expect(selected.state).toMatchObject({ step: "PICK_ACTION", booking_id: "booking-second" });
    expect(selected.reply).toContain("2 people, Paid\n");
    expect(selected.state.bookings.map((booking: any) => booking.id)).toEqual(["booking-second"]);
    expect(f.calls.filter(call => call.kind === "invoke")).toEqual([]);
  });

  it("offers a real operator review instead of an unsupported tour switch", async () => {
    const f = webChatFixture();
    const customer = await managedBooking(f);
    const result = await customer.post("btn:change tour", "PICK_ACTION");
    expect(result.state.step).toBe("REVIEW_REQUEST");
    expect(result.reply).toMatch(/team|operator/i);
    expect(f.calls.filter(call => call.kind === "invoke")).toEqual([]);
  });

  it("describes a paid reschedule as pending until its extra payment is received", async () => {
    const f = webChatFixture();
    const customer = await managedBooking(f);
    f.rows.slots.push({ ...f.slot, id: "new-slot", start_time: new Date(Date.now() + 96 * 3_600_000).toISOString() });
    f.db.functions.invoke = async () => ({ data: { ok: true, diff: 200, payment_url: "https://pay.fixture.invalid/change" }, error: null });
    const result = await customer.post("btn:new-slot", "RESCH_DATE");
    expect(result.paymentUrl).toBe("https://pay.fixture.invalid/change");
    expect(result.reply).toMatch(/unchanged until payment|stays unchanged|until.*pay|pay.*confirm/i);
    expect(result.reply).not.toMatch(/Timeslot updated|Rescheduled to/);
    expect(customer.booking.slot_id).toBe(f.slot.id);
  });

  it("does not claim a reschedule succeeded when the service returns ok:false", async () => {
    const f = webChatFixture();
    const customer = await managedBooking(f);
    f.rows.slots.push({ ...f.slot, id: "new-slot", start_time: new Date(Date.now() + 96 * 3_600_000).toISOString() });
    f.db.functions.invoke = async () => ({ data: { ok: false }, error: null });
    const result = await customer.post("btn:new-slot", "RESCH_DATE");
    expect(result.reply).not.toMatch(/Rescheduled|updated|switched/i);
    expect(result.paymentUrl).toBeFalsy();
  });
});

describe("web chat contact details can be entered and corrected", () => {
  it("stops an abandoned booking without treating cancel as the customer's name", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "cancel", { ...f.bookingState, step: "ASK_DETAILS", name: "" });
    expect(result.state.step).toBe("IDLE");
    expect(result.state.name).toBeUndefined();
    expect(f.rows.bookings).toEqual([]);
    expect(f.calls.filter(call => call.kind === "fetch")).toEqual([]);
  });

  it("changes a cart date while preserving contacts and requiring a fresh confirmation", async () => {
    const f = webChatFixture();
    const token = await f.session();
    const date = new Date(Date.now() + 120 * 3_600_000).toISOString().slice(0, 10);
    f.rows.slots.push({ ...f.slot, id: "later-slot", start_time: date + "T08:00:00.000Z" });
    let result = await f.post(token, "change my date to " + date, f.bookingState);
    expect(result.state).toMatchObject({ step: "PICK_TIME", selectedDate: date, name: f.bookingState.name, email: f.bookingState.email, phone: f.bookingState.phone });
    expect(result.state.checkout_attempt).not.toBe(f.bookingState.checkout_attempt);
    result = await f.post(token, "btn:later-slot", result.state);
    result = await f.post(token, "btn:qty:2", result.state);
    expect(result.state).toMatchObject({ qty: 2, slotId: "later-slot", email: f.bookingState.email, phone: f.bookingState.phone });
    expect(f.rows.bookings).toEqual([]);
    expect(f.calls.filter(call => call.kind === "fetch")).toEqual([]);
  });

  it("collects name, email and international phone from one ordinary sentence", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "Jane Smith jane@example.com +44 7700 900123", {
      ...f.bookingState, step: "ASK_DETAILS", name: "", email: "", phone: "",
    });
    expect(result.state).toMatchObject({ step: "ASK_VOUCHER", name: "Jane Smith", email: "jane@example.com", phone: "+447700900123" });
  });

  it("preserves the international prefix when the guest enters 00", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "0044 7700 900123", { ...f.bookingState, step: "ASK_DETAILS", phone: "" });
    expect(result.state.phone).toBe("+447700900123");
  });

  for (const [message, key, value] of [
    ["email: corrected@example.com", "email", "corrected@example.com"],
    ["phone: +44 7700 900123", "phone", "+447700900123"],
    ["name: Corrected Guest", "name", "Corrected Guest"],
  ]) {
    it(`lets the guest replace ${key} after going back`, async () => {
      const f = webChatFixture();
      const token = await f.session();
      const back = await f.post(token, "back", { ...f.bookingState, step: "ASK_VOUCHER" });
      expect(back.state.step).toBe("ASK_DETAILS");
      const result = await f.post(token, message, back.state);
      expect(result.state[key]).toBe(value);
    });
  }

  it("accepts names outside the Latin alphabet", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "李明, guest@example.com, +86 138 0013 8000", {
      ...f.bookingState, step: "ASK_DETAILS", name: "", email: "", phone: "",
    });
    expect(result.state).toMatchObject({ step: "ASK_VOUCHER", name: "李明", email: "guest@example.com", phone: "+8613800138000" });
  });
});

describe("web chat stale options and failed voucher checkouts", () => {
  for (const remaining of [10, 2]) {
    it(`preserves a requested party through the full journey and rechecks ${remaining} remaining seats`, async () => {
      const f = webChatFixture();
      const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: f.business.timezone }).format(new Date(Date.now() + 24 * 3_600_000));
      f.slot.start_time = tomorrow + "T08:00:00.000Z";
      const token = await f.session();
      let result = await f.post(token, "book a Sea Kayak Tour for 4 tomorrow");
      if (result.state.step === "PICK_TOUR") result = await f.post(token, "btn:" + f.tour.id, result.state);
      expect(result.state).toMatchObject({ step: "PICK_TIME", requestedQty: 4, selectedDate: tomorrow });
      result = await f.post(token, "btn:" + f.slot.id, result.state);
      expect(result.buttons).toContainEqual({ label: "Continue with 4 people", value: "qty:4" });
      f.slot.available_capacity = remaining;
      result = await f.post(token, "btn:qty:4", result.state);
      if (remaining < 4) {
        expect(result.state.step).toBe("ASK_QTY");
        expect(result.reply).toContain("2 spots");
        expect(f.rows.bookings).toEqual([]);
      } else {
        expect(result.state).toMatchObject({ step: "ASK_DETAILS", qty: 4 });
        for (const message of ["Fixture Guest, guest@fixture.invalid, +27110000000", "no", "btn:confirm"]) result = await f.post(token, message, result.state);
        expect(result.paymentUrl).toBeTruthy();
        expect(f.rows.bookings[0]).toMatchObject({ qty: 4, total_amount: 1600, slot_id: f.slot.id });
      }
    });
  }

  it("returns the real hold deadline for new and repeated payment links", async () => {
    const f = webChatFixture();
    const token = await f.session();
    const first = await f.post(token, "btn:confirm", f.bookingState);
    const retry = await f.post(token, "btn:confirm", f.bookingState);
    expect(first.paymentExpiresAt).toBe(f.rows.holds[0].expires_at);
    expect(retry.paymentExpiresAt).toBe(first.paymentExpiresAt);
  });

  for (const checkout of ["unsafe-url", "missing-url"]) {
    it(`does not leave a held booking for a malformed ${checkout} checkout reply`, async () => {
      const f = webChatFixture();
      f.settings.checkout = checkout;
      const result = await f.post(await f.session(), "btn:confirm", f.bookingState);
      expect(result.paymentUrl).toBeFalsy();
      expect(result.state.status).toBe("HUMAN");
      expect(f.rows.bookings[0].status).toBe("CANCELLED");
      expect(f.rows.holds.every(hold => hold.status !== "ACTIVE")).toBe(true);
    });
  }

  it("offers another departure when the selected time sells out before party size", async () => {
    const f = webChatFixture();
    f.slot.available_capacity = 0;
    f.rows.slots.push({ ...f.slot, id: "another-slot", start_time: new Date(Date.now() + 96 * 3_600_000).toISOString(), available_capacity: 10 });
    const result = await f.post(await f.session(), "2", { ...f.bookingState, step: "ASK_QTY" });
    expect(result.state.step).toBe("PICK_DATE");
    expect(result.calendar.flatMap((day: any) => day.slots).map((slot: any) => slot.id)).toEqual(["another-slot"]);
    expect(result.reply).not.toContain("0 or fewer");
  });

  for (const step of ["ASK_VOUCHER", "ENTER_VOUCHER"]) {
    it(`replaces voucher credit instead of stacking the previous deduction in ${step}`, async () => {
      const f = webChatFixture();
      f.rows.vouchers.push({ id: "voucher-new", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 200, value: 200 });
      const result = await f.post(await f.session(), "CANOE888", { ...f.bookingState, step, vid: "voucher-old", vded: 100, total: 700 });
      expect(result.state).toMatchObject({ step: "CONFIRM", vid: "voucher-new", vded: 200, total: 600 });
    });
  }

  for (const change of ["closed", "past", "full", "different-day"]) {
    it(`does not accept a stale time button for a ${change} slot`, async () => {
      const f = webChatFixture();
      if (change === "closed") f.slot.status = "CLOSED";
      if (change === "past") f.slot.start_time = new Date(Date.now() - 3_600_000).toISOString();
      if (change === "full") f.slot.available_capacity = 0;
      if (change === "different-day") f.slot.start_time = new Date(Date.now() + 120 * 3_600_000).toISOString();
      const result = await f.post(await f.session(), "btn:" + f.slot.id, { ...f.bookingState, step: "PICK_TIME" });
      expect(result.state.step).not.toBe("ASK_QTY");
      expect(f.rows.bookings).toEqual([]);
    });
  }

  it("can recover from a failed fully covered voucher confirmation", async () => {
    const f = webChatFixture();
    const token = await f.session();
    f.rows.vouchers.push({ id: "voucher-a", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 800, value: 800 });
    const summary = await f.post(token, "CANOE888", { ...f.bookingState, step: "ASK_VOUCHER" });
    f.failures["rpc:confirm_voucher_booking"] = { message: "Capacity changed" };
    const failed = await f.post(token, "btn:confirm", summary.state);
    expect(failed.reply).not.toMatch(/You're booked/);
    expect(f.rows.bookings.filter(row => row.status === "PENDING")).toEqual([]);
    delete f.failures["rpc:confirm_voucher_booking"];
    const recovered = await f.post(token, "btn:confirm", summary.state);
    expect(recovered.reply).not.toContain("still being prepared");
    expect(f.rows.bookings.filter(row => row.status === "PAID")).toHaveLength(1);
  });

  it("keeps a voucher-paid booking confirmed while accurately reporting an email outage", async () => {
    const f = webChatFixture();
    f.settings.email = "error";
    f.rows.vouchers.push({ id: "voucher-a", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 800, value: 800 });
    const result = await f.post(await f.session(), "btn:confirm", { ...f.bookingState, vid: "voucher-a", vded: 800, total: 0 });
    expect(result.reply).toContain("You're booked");
    expect(result.reply).not.toContain("email on its way");
    expect(result.reply).toContain("couldn't send the email");
    expect(result.manageBookingsUrl).toBe("https://a.booking.fixture.invalid/my-bookings");
    expect(f.rows.bookings[0].status).toBe("PAID");
  });

  it("recovers a committed voucher booking when the RPC response is lost", async () => {
    const f = webChatFixture();
    f.rows.vouchers.push({ id: "voucher-a", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 800, value: 800 });
    const rpc = f.db.rpc;
    f.db.rpc = async (name, data) => {
      const result = await rpc(name, data);
      return name === "confirm_voucher_booking" ? { data: null, error: { message: "Response lost after commit" } } : result;
    };
    const result = await f.post(await f.session(), "btn:confirm", { ...f.bookingState, vid: "voucher-a", vded: 800, total: 0 });
    expect(result.reply).toContain("You're booked");
    expect(f.rows.bookings).toHaveLength(1);
    expect(f.rows.bookings[0].status).toBe("PAID");
    expect(f.calls.filter(call => call.kind === "delete" && call.name === "bookings")).toEqual([]);
  });

  it("matches a gift tour by its real name for any operator", async () => {
    const f = webChatFixture();
    f.tour.name = "Mountain Bike Adventure";
    const result = await f.post(await f.session(), f.tour.name, { step: "GIFT_PICK_TOUR" });
    expect(result.state).toMatchObject({ step: "GIFT_RECIPIENT", gtid: f.tour.id, gtname: f.tour.name });
  });

  it("preserves a personal gift message that contains a question", async () => {
    const f = webChatFixture();
    const message = "Happy birthday! Are you ready for an adventure?";
    const result = await f.post(await f.session(), message, { step: "GIFT_MESSAGE", gtid: f.tour.id, gtname: f.tour.name });
    expect(result.state).toMatchObject({ step: "GIFT_BUYER_NAME", gmessage: message });
  });
});

describe("web chat custom booking questions", () => {
  const simpleQuestions = [
    { key: "weight", label: "Your weight in kg", type: "number", required: true },
    { key: "note", label: "Anything else we should know?", type: "textarea", required: false },
  ];

  it("links to the canonical booking site even when My Bookings has a custom external URL", async () => {
    const f = webChatFixture();
    (f.business as any).manage_bookings_url = "https://accounts.fixture.invalid/manage";
    (f.business as any).booking_custom_fields = [{ ...simpleQuestions[0], scope: "participant" }];
    const result = await f.post(await f.session(), "btn:confirm", f.bookingState);
    expect(new URL(result.bookingUrl).origin).toBe("https://a.booking.fixture.invalid");
  });

  it("collects configured simple questions, supports optional skip, and stores their canonical definitions", async () => {
    const f = webChatFixture();
    (f.business as any).booking_custom_fields = simpleQuestions;
    const token = await f.session();
    let result = await f.post(token, "Fixture Guest, guest@fixture.invalid, +27110000000", { ...f.bookingState, step: "ASK_DETAILS" });
    expect(result.state.step).toBe("ASK_CUSTOM_FIELD");
    expect(result.reply).toContain("Your weight in kg");
    const invalid = await f.post(token, "not a number", result.state);
    expect(invalid.state.step).toBe("ASK_CUSTOM_FIELD");
    expect(invalid.state.custom_fields.weight).toBeUndefined();
    result = await f.post(token, "80", invalid.state);
    expect(result.reply).toContain("Anything else");
    result = await f.post(token, "skip", result.state);
    expect(result.state.step).toBe("ASK_VOUCHER");
    result = await f.post(token, "no", result.state);
    result = await f.post(token, "btn:confirm", result.state);
    expect(result.paymentUrl).toBeTruthy();
    expect(f.rows.bookings[0].custom_fields).toMatchObject({ weight: "80", note: "", __booking_questions: { format: 1, business_id: "a", tour_id: f.tour.id } });
  });

  it("does not accept skip for a required answer", async () => {
    const f = webChatFixture();
    (f.business as any).booking_custom_fields = simpleQuestions;
    const result = await f.post(await f.session(), "skip", { ...f.bookingState, step: "ASK_CUSTOM_FIELD", custom_field_defs: [], custom_fields: {} });
    expect(result.state.step).toBe("ASK_CUSTOM_FIELD");
    expect(result.state.custom_fields).toEqual({});
    expect(result.reply).toContain("Your weight in kg");
  });

  for (const voucher of [false, true]) {
    it(`revalidates required answers before ${voucher ? "voucher" : "paid"} checkout even with forged empty definitions`, async () => {
      const f = webChatFixture();
      (f.business as any).booking_custom_fields = simpleQuestions;
      if (voucher) f.rows.vouchers.push({ id: "voucher-a", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 800, value: 800 });
      const result = await f.post(await f.session(), "btn:confirm", { ...f.bookingState, total: voucher ? 0 : 800, vid: voucher ? "voucher-a" : null, vded: voucher ? 800 : 0, custom_field_defs: [], custom_fields: {} });
      expect(result.state.step).toBe("ASK_CUSTOM_FIELD");
      expect(result.reply).toContain("Your weight in kg");
      expect(f.rows.bookings).toEqual([]);
      expect(f.calls.filter(call => call.name === "confirm_voucher_booking" || call.kind === "fetch")).toEqual([]);
    });
  }

  it("filters disabled, foreign-business and other-tour questions using the shared rules", async () => {
    const f = webChatFixture();
    (f.business as any).booking_custom_fields = [
      { ...simpleQuestions[0], key: "disabled", enabled: false },
      { ...simpleQuestions[0], key: "other_tour", tour_ids: ["other-tour"] },
      { ...simpleQuestions[0], key: "foreign", business_id: "other-business" },
    ];
    const result = await f.post(await f.session(), "Fixture Guest", { ...f.bookingState, step: "ASK_DETAILS" });
    expect(result.state.step).toBe("ASK_VOUCHER");
  });

  for (const definition of [
    { ...simpleQuestions[0], scope: "participant" },
    { key: "meal", label: "Meal option", type: "select", required: true, options: ["Vegetarian", "Regular"] },
  ]) {
    for (const step of ["ASK_DETAILS", "ASK_CUSTOM_FIELD", "CONFIRM"]) {
      it(`links ${definition.scope || definition.type} questions to a usable selected booking form from ${step}`, async () => {
        const f = webChatFixture();
        (f.business as any).booking_custom_fields = [definition];
        const result = await f.post(await f.session(), step === "CONFIRM" ? "btn:confirm" : "Fixture Guest", { ...f.bookingState, step, custom_field_defs: [] });
        expect(result.state.step).toBe("IDLE");
        const link = new URL(result.bookingUrl);
        expect(link.origin).toBe("https://a.booking.fixture.invalid");
        expect(link.pathname).toBe("/book");
        expect(link.searchParams.get("tour")).toBe(f.tour.id);
        expect(link.searchParams.get("slot")).toBe(f.slot.id);
        expect(f.rows.bookings).toEqual([]);
      });
    }
  }

  it("does not bypass required questions when their configuration cannot be loaded", async () => {
    const f = webChatFixture();
    f.failures["select:businesses"] = { message: "Configuration unavailable" };
    const result = await f.post(await f.session(), "btn:confirm", f.bookingState);
    expect(result.paymentUrl).toBeFalsy();
    expect(f.rows.bookings).toEqual([]);
  });
});
