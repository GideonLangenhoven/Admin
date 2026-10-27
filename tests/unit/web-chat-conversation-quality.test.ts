import { describe, expect, it } from "vitest";
import { webChatFixture } from "../helpers/web-chat-fixture";
import { sourceFunction } from "../helpers/source-handler";

const dateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(date);
const nextDay = () => {
  const date = new Date(dateKey(new Date()) + "T10:00:00+02:00");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
};

describe("web chat conversational routing", () => {
  for (const [message, answer] of [
    ["How do I book?", "Choose Book a Tour, select a date, then pay securely."],
    ["How long is a gift voucher valid?", "Gift vouchers are valid for three years."],
    ["What is included when I book?", "Your guide and all paddling equipment are included."],
    ["Can I get a refund if the weather is bad?", "Our team confirms the available options if weather affects a trip."],
    ["Is parking available?", "Use the public parking beside the harbour."],
    ["What payment methods are available?", "We accept Visa, Mastercard and Amex."],
    ["Are gift vouchers available?", "Gift vouchers can be purchased on the Gift Voucher page."],
    ["What are your opening hours?", "Departure times vary by date. Check the available sessions."],
  ]) {
    it(`answers the question without starting checkout: ${message}`, async () => {
      const f = webChatFixture();
      f.settings.llmAvailable = false;
      f.rows.chat_faq_entries.push({ id: "answer-a", business_id: "a", enabled: true, question_pattern: message, match_keywords: ["information"], answer });
      const result = await f.post(await f.session(), message);
      expect(result.state.step).toBe("IDLE");
      expect(result.reply).toBe(answer);
      expect(f.rows.bookings).toEqual([]);
      expect(f.rows.vouchers).toEqual([]);
    });
  }

  for (const message of ["I don't want to book yet", "I don’t want to book yet", "I'm not ready to book", "Do not book anything"]) {
    it(`respects a declined booking: ${message}`, async () => {
      const f = webChatFixture();
      const result = await f.post(await f.session(), message);
      expect(result.state.step).toBe("IDLE");
      expect(f.rows.bookings).toEqual([]);
      expect(f.rows.vouchers).toEqual([]);
    });
  }

  it("answers logistics about an existing booking instead of sending the visitor to manage it", async () => {
    const f = webChatFixture();
    f.settings.llmAvailable = false;
    const result = await f.post(await f.session(), "Where do we meet for my booking?");
    expect(result.reply).toContain("Harbour kiosk");
    expect(result.reply).not.toContain("quickest way to manage");
  });

  it("still starts a booking on an explicit purchase request", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "I'd like to book the Sea Kayak Tour");
    expect(result.state.step).toBe("PICK_DATE");
    expect(result.calendar.length).toBeGreaterThan(0);
  });

  it("treats a request to book a named tour tomorrow as an action", async () => {
    const f = kayakFixture();
    f.settings.llmAvailable = false;
    const result = await f.post(await f.session(), "Can you book a morning tour tomorrow?");
    expect(result.state).toMatchObject({ step: "PICK_TIME", tid: f.tour.id, selectedDate: dateKey(new Date(f.slot.start_time)) });
  });

  it("routes marketing opt-out to verified account management without pretending it has already happened", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "Please unsubscribe me from marketing messages");
    expect(result.manageBookingsUrl).toBe("https://a.booking.fixture.invalid/my-bookings");
    expect(result.reply).toMatch(/verif/i);
    expect(result.reply).not.toMatch(/you(?:'|’)ve been unsubscribed/i);
  });

  it("only updates the verified customer's marketing consent for this operator", async () => {
    const f = webChatFixture();
    f.rows.customers = [
      { business_id: "a", email: "guest@fixture.invalid", marketing_consent: true },
      { business_id: "b", email: "guest@fixture.invalid", marketing_consent: true },
      { business_id: "a", email: "other@fixture.invalid", marketing_consent: true },
    ];
    const response = await f.request({ chat_session: await f.session(), customer_session: await f.verifiedCustomer(), message: "Please unsubscribe me from marketing", state: { step: "ASK_DETAILS" } });
    expect(response.status).toBe(200);
    expect((await response.json()).state.step).toBe("ASK_DETAILS");
    expect(f.rows.customers.map(customer => customer.marketing_consent)).toEqual([false, true, true]);
  });

  for (const message of ["I don't want to unsubscribe", "I don’t want to unsubscribe"]) {
    it(`does not unsubscribe a customer who explicitly declines the change: ${message}`, async () => {
      const f = webChatFixture();
      f.rows.customers = [{ business_id: "a", email: "guest@fixture.invalid", marketing_consent: true }];
      await f.request({ chat_session: await f.session(), customer_session: await f.verifiedCustomer(), message });
      expect(f.rows.customers[0].marketing_consent).toBe(true);
    });
  }
});

describe("web chat deterministic dates and availability", () => {
  it("does not mistake a booking date for the size of the party", () => {
    const quantity = sourceFunction("supabase/functions/web-chat/index.ts", "parseChatQuantity", {});
    const partySize = sourceFunction("supabase/functions/web-chat/index.ts", "requestedPartySize", { parseChatQuantity: quantity });
    expect(partySize("Book for 2026-10-12")).toBeNull();
    expect(partySize("Book for 20 November")).toBeNull();
    expect(partySize("Book for 4 people tomorrow")).toBe(4);
  });

  it("does not select a date that the customer explicitly excluded", () => {
    const parseDate = sourceFunction("supabase/functions/web-chat/index.ts", "parseChatDate", {});
    expect(parseDate("Any day except tomorrow", "2026-10-04")).not.toBe("2026-10-05");
    expect(parseDate("Not tomorrow", "2026-10-04")).not.toBe("2026-10-05");
    expect(parseDate("Tomorrow please", "2026-10-04")).toBe("2026-10-05");
  });

  it("accepts a typed ISO date while the model is unavailable", async () => {
    const f = webChatFixture();
    f.settings.llmAvailable = false;
    const result = await f.post(await f.session(), f.bookingState.selectedDate, { ...f.bookingState, step: "PICK_DATE" });
    expect(result.state.step).toBe("PICK_TIME");
    expect(result.buttons.some((button: any) => button.value === f.slot.id)).toBe(true);
  });

  it("accepts tomorrow using the operator's local calendar without a model", async () => {
    const f = webChatFixture();
    f.settings.llmAvailable = false;
    f.slot.start_time = nextDay();
    const result = await f.post(await f.session(), "tomorrow", { ...f.bookingState, step: "PICK_DATE" });
    expect(result.state).toMatchObject({ step: "PICK_TIME", selectedDate: dateKey(new Date(f.slot.start_time)) });
    expect(f.calls.filter(call => call.name === "web-date")).toEqual([]);
  });

  it("recovers gracefully when the optional date model fails", async () => {
    const f = webChatFixture();
    f.failures.llm = true;
    const result = await f.post(await f.session(), "the date after my sister arrives", { ...f.bookingState, step: "PICK_DATE" });
    expect(result.status).toBe(200);
    expect(result.state.step).toBe("PICK_DATE");
    expect(result.calendar.length).toBeGreaterThan(0);
  });

  it("does not call malformed calendar dates valid selections", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "2027-02-31", { ...f.bookingState, step: "PICK_DATE" });
    expect(result.state.step).toBe("PICK_DATE");
    expect(result.state.selectedDate).not.toBe("2027-02-31");
    expect(result.calendar.length).toBeGreaterThan(0);
  });

  it("keeps a named tour's availability separate from other tours", async () => {
    const f = webChatFixture();
    f.slot.start_time = nextDay();
    Object.assign(f.slot, { tour_name: f.tour.name });
    f.rows.tours.push({ ...f.tour, id: "tour-b", name: "Sunset Adventure" });
    f.rows.slots.push({ ...f.slot, id: "slot-b", tour_id: "tour-b", tour_name: "Sunset Adventure" });
    const result = await f.post(await f.session(), "Is Sea Kayak Tour available tomorrow?");
    expect(result.reply).toContain("Sea Kayak Tour");
    expect(result.reply).not.toContain("Sunset Adventure");
  });

  it("does not say a trip can fit a group larger than its remaining capacity", async () => {
    const f = webChatFixture();
    f.slot.start_time = nextDay();
    f.slot.available_capacity = 3;
    const result = await f.post(await f.session(), "Is there space for 4 people tomorrow?");
    expect(result.reply).not.toMatch(/^yes\b/i);
    expect(result.reply).toMatch(/4|four|group/i);
  });

  it("reports unavailable inventory honestly when the availability service fails", async () => {
    const f = webChatFixture();
    f.failures["rpc:list_available_slots"] = { message: "Database unavailable" };
    const result = await f.post(await f.session(), "btn:book");
    expect(result.reply).not.toMatch(/fully booked|sold out|new dates open/i);
    expect(result.reply).toMatch(/try|check|unavailable|couldn/i);
  });
});

describe("web chat grounded answers and handoff", () => {
  it("supplies the operator's configured logistics to the answer model", async () => {
    const f = webChatFixture();
    await f.post(await f.session(), "Where do we meet and what should I bring?");
    const model = f.calls.find(call => call.name === "web-faq");
    // Deterministic grounded answers may bypass the model entirely.
    if (model) {
      expect(model.data.system).toContain("Harbour kiosk");
      expect(model.data.system).toContain("Bring a towel and water.");
    }
  });

  it("includes the selected tour and date when answering a contextual question", async () => {
    const f = webChatFixture();
    await f.post(await f.session(), "What does this one include?", { ...f.bookingState, step: "ASK_QTY" });
    const model = f.calls.find(call => call.name === "web-faq");
    expect(model).toBeDefined();
    expect(model!.data.system).toContain(f.tour.name);
    expect(model!.data.system).toContain(f.bookingState.selectedDate);
  });

  it("does not use a legacy FAQ merely because one generic word overlaps", async () => {
    const f = webChatFixture();
    f.settings.llmAvailable = false;
    f.business.faq_json = { "What should I bring?": "Bring a towel, hat and sunscreen." };
    const result = await f.post(await f.session(), "What time should I arrive?");
    expect(result.reply).not.toContain("hat and sunscreen");
  });

  for (const message of ["Can I bring my dog?", "Can I bring my 4 year old?"]) {
    it(`does not mistake a guest eligibility question for a packing list: ${message}`, async () => {
      const f = webChatFixture();
      f.settings.llmAvailable = false;
      const result = await f.post(await f.session(), message);
      expect(result.reply).not.toBe(f.business.what_to_bring);
      expect(result.reply).toMatch(/team|human|operator|don.t|not sure/i);
    });
  }

  it("does not answer cancellation fees with unrelated tour rates", async () => {
    const f = webChatFixture();
    f.settings.llmAvailable = false;
    const result = await f.post(await f.session(), "What are your cancellation fees?");
    expect(result.reply).not.toMatch(/current rates|R400|exact price/);
    expect(result.reply).toMatch(/team|human|operator|don.t|not sure/i);
  });

  for (const message of ["Can someone help me please?", "I need customer support", "agent please"]) {
    it(`connects a common human request: ${message}`, async () => {
      const f = webChatFixture();
      const result = await f.post(await f.session(), message);
      expect(result.state.status).toBe("HUMAN");
      expect(f.rows.conversations[0].status).toBe("HUMAN");
      expect(f.calls.filter(call => call.kind === "llm")).toEqual([]);
    });
  }

  it("honours yes after explicitly offering to flag an unanswered question", async () => {
    const f = webChatFixture();
    f.settings.llmAvailable = false;
    const token = await f.session();
    const first = await f.post(token, "Does your equipment support underwater basket weaving?");
    const result = await f.post(token, "yes please", first.state, [
      { role: "user", text: "Does your equipment support underwater basket weaving?" },
      { role: "bot", text: first.reply },
    ]);
    expect(result.state.status).toBe("HUMAN");
    expect(f.rows.conversations[0].status).toBe("HUMAN");
  });

  it("clears a declined handoff offer before a later acknowledgement", async () => {
    const f = webChatFixture();
    f.settings.llmAvailable = false;
    const token = await f.session();
    const offered = await f.post(token, "Does your equipment support underwater basket weaving?");
    const declined = await f.post(token, "No thanks", offered.state);
    expect(declined.state.offered_handoff).toBeFalsy();
    const later = await f.post(token, "yes", declined.state, [{ role: "bot", text: declined.reply }]);
    expect(later.state.status).not.toBe("HUMAN");
  });

  for (const message of ["Please delete my data", "I want to take legal action", "I use a wheelchair", "I have a press enquiry", "This is an unauthorised charge"]) {
    it(`keeps handoff promises truthful: ${message}`, async () => {
      const f = webChatFixture();
      const result = await f.post(await f.session(), message);
      expect(result.state.status).toBe("HUMAN");
      expect(result.reply).not.toMatch(/within an hour|(?:send|get|receive).{0,20}confirmation email|press@bookingtours|do not cancel through your bank|last 4 digits/i);
      expect(f.rows.conversations[0].status).toBe("HUMAN");
    });
  }
});

// Sanitized public business facts from the operator's read-only configuration.
// Customer transcripts, live identifiers, credentials and payments stay out.
function kayakFixture() {
  const f = webChatFixture();
  Object.assign(f.business, {
    business_name: "Kayak", ai_system_prompt: "", faq_json: {}, terminology: {},
    what_to_bring: "Water, sunscreen, a sun hat and a small waterproof bag for valuables. Bring comfortable walking shoes for the hike.",
    meeting_point_address: null, arrival_instructions: null,
  });
  Object.assign(f.tour, {
    name: "Morning Kayak", base_price_per_person: 600, meeting_point: null,
    description: "Start the day on the water. A two-hour morning paddle with coastal views and time to enjoy Cape Town from a different perspective.",
  });
  f.slot.start_time = nextDay();
  Object.assign(f.slot, { tour_name: f.tour.name });
  f.rows.tours.push({ ...f.tour, id: "sunset", name: "Sunset Paddle", base_price_per_person: 500 });
  f.rows.tours.push({ ...f.tour, id: "hike", name: "Midday Hike", base_price_per_person: 700, description: "A two-hour Table Mountain hike. Bring comfortable walking shoes, water and a sun hat." });
  f.rows.slots.push({ ...f.slot, id: "sunset-slot", tour_id: "sunset", tour_name: "Sunset Paddle" });
  f.rows.slots.push({ ...f.slot, id: "hike-slot", tour_id: "hike", tour_name: "Midday Hike" });
  return f;
}

describe("reported Kayak conversations", () => {
  it("remembers tomorrow while the customer selects a tour", async () => {
    const f = kayakFixture();
    f.settings.llmAvailable = false;
    const token = await f.session();
    const first = await f.post(token, "I want to book for tomorrow");
    expect(first.state.step).toBe("PICK_TOUR");
    const selected = await f.post(token, "btn:" + f.tour.id, first.state);
    expect(selected.state).toMatchObject({ step: "PICK_TIME", selectedDate: dateKey(new Date(f.slot.start_time)) });
    expect(selected.buttons.some((button: any) => button.value === f.slot.id)).toBe(true);
  });

  it("answers a directions interruption instead of treating it as contact details", async () => {
    const f = kayakFixture();
    f.settings.llmAvailable = false;
    // This is explicitly synthetic test data, not an invented live address.
    f.business.meeting_point_address = "Fixture harbour kiosk";
    const result = await f.post(await f.session(), "Instead tell me how to get to the shop", { tid: f.tour.id, step: "ASK_DETAILS", qty: 2 });
    expect(result.state.step).toBe("ASK_DETAILS");
    expect(result.state.name).toBeFalsy();
    expect(result.reply).toContain("Fixture harbour kiosk");
  });

  it("understands the reported directions typo when an address is configured", async () => {
    const f = kayakFixture();
    f.settings.llmAvailable = false;
    f.business.meeting_point_address = "Fixture harbour kiosk";
    const result = await f.post(await f.session(), "How can I get to t(r shop");
    expect(result.state.step).toBe("IDLE");
    expect(result.reply).toContain("Fixture harbour kiosk");
  });

  it("makes a real handoff when the address is missing and the customer accepts help", async () => {
    const f = kayakFixture();
    f.settings.llmAvailable = false;
    const token = await f.session();
    const first = await f.post(token, "How can I get to t(r shop");
    expect(first.reply).not.toMatch(/Harbour kiosk|Fixture harbour kiosk/);
    const accepted = await f.post(token, "Yes please", first.state, [
      { role: "user", text: "How can I get to t(r shop" },
      { role: "bot", text: first.reply },
    ]);
    expect(accepted.state.status).toBe("HUMAN");
    expect(f.rows.conversations[0].status).toBe("HUMAN");
  });

  it("includes each tour's actual description in model context", async () => {
    const f = kayakFixture();
    await f.post(await f.session(), "Does the hike go up Table Mountain?");
    const model = f.calls.find(call => call.name === "web-faq");
    expect(model).toBeDefined();
    expect(model!.data.system).toContain("A two-hour Table Mountain hike");
  });
});


describe("web chat support when booking is paused", () => {
  it("delivers messages in an existing human conversation without running the model", async () => {
    const f = webChatFixture();
    const token = await f.session();
    const handoff = await f.post(token, "btn:human");
    f.settings.trading = false;
    const result = await f.post(token, "Here are the details you requested", handoff.state);
    expect(result.human).toBe(true);
    expect(f.rows.chat_messages.some(row => row.direction === "IN" && row.body === "Here are the details you requested")).toBe(true);
    expect(f.calls.filter(call => call.kind === "llm")).toEqual([]);
  });
  it("answers a known tour duration without a model", async () => {
    const f = webChatFixture();
    f.settings.llmAvailable = false;
    const result = await f.post(await f.session(), "How long is the trip?");
    expect(result.reply).toContain("2 hours");
    expect(f.calls.filter(call => call.kind === "llm")).toEqual([]);
  });
});
