import { describe, expect, it } from "vitest";
import { webChatFixture } from "../helpers/web-chat-fixture";

describe("web chat production conversation checks", () => {
  for (const step of ["PICK_TOUR", "PICK_DATE", "PICK_TIME", "ASK_QTY", "ASK_DETAILS", "ASK_CUSTOM_FIELD", "ASK_VOUCHER", "ENTER_VOUCHER", "CONFIRM", "GIFT_PICK_TOUR", "GIFT_RECIPIENT", "GIFT_MESSAGE", "GIFT_BUYER_NAME", "GIFT_BUYER_EMAIL", "GIFT_CONFIRM"]) {
    it(`answers questions without changing ${step}`, async () => {
      const f = webChatFixture();
      f.settings.llmAvailable = false;
      const result = await f.post(await f.session(), "Where do we meet?", { ...f.bookingState, step });
      expect(result.status).toBe(200);
      expect(result.reply).toContain("Harbour kiosk");
      expect(result.state.step).toBe(step);
      expect(f.rows.bookings).toEqual([]);
      expect(f.rows.vouchers).toEqual([]);
    });
    it(`can restart from ${step}`, async () => {
      const f = webChatFixture();
      const result = await f.post(await f.session(), "start over", { ...f.bookingState, step });
      expect(result.state).toMatchObject({ step: "IDLE" });
      expect(result.buttons.length).toBeGreaterThan(0);
      expect(f.rows.bookings).toEqual([]);
      expect(f.rows.vouchers).toEqual([]);
    });
  }
  for (const [text, qty] of [["2", 2], ["four of us", 4], ["just me", 1], ["a couple", 2], ["2 adults and 1 child", 3], ["two adults and three children", 5], ["we are 4 people", 4]] as const) {
    it(`reads party size: ${text}`, async () => {
      const f = webChatFixture();
      const result = await f.post(await f.session(), text, { ...f.bookingState, step: "ASK_QTY" });
      expect(result.state.qty).toBe(qty);
      expect(result.state.step).toBe("ASK_DETAILS");
    });
  }
  for (const text of ["0", "-2", "1.5", "Can my 8 year old join?", "Does the trip last 2 hours?"]) {
    it(`does not treat unrelated or invalid numbers as a party: ${text}`, async () => {
      const f = webChatFixture();
      const result = await f.post(await f.session(), text, { tid: f.tour.id, slotId: f.slot.id, tprice: 400, step: "ASK_QTY" });
      expect(result.state.step).toBe("ASK_QTY");
      expect(result.state.qty).toBeUndefined();
    });
  }
  it("uses verified Quick Answers even when the model is unavailable", async () => {
    const f = webChatFixture();
    f.settings.llmAvailable = false;
    f.rows.chat_faq_entries.push({ id: "faq-a", business_id: "a", enabled: true, match_keywords: ["bring", "packing"], question_pattern: "Packing: what should I bring?", answer: "Bring your voucher and a towel.", use_count: 0 });
    const result = await f.post(await f.session(), "Packing: what should I bring?");
    expect(result.reply).toBe("Bring your voucher and a towel.");
    expect(f.calls.filter(call => call.kind === "llm")).toEqual([]);
  });
  it("preserves follow-up history and saves both sides before handoff", async () => {
    const f = webChatFixture();
    const token = await f.session();
    const first = await f.post(token, "How long is the experience?");
    await f.post(token, "Is that suitable for beginners?", first.state, [{ role: "user", text: "How long is the experience?" }, { role: "bot", text: first.reply }]);
    expect(f.calls.filter(call => call.kind === "llm").at(-1)?.data.messages).toHaveLength(3);
    await f.post(token, "I want to speak to a human");
    expect(f.rows.chat_messages.map(row => row.direction)).toEqual(["IN", "OUT", "IN", "OUT", "IN", "OUT"]);
  });
  it("can go back from time selection to a usable date calendar", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "back", { ...f.bookingState, step: "PICK_TIME" });
    expect(result.state.step).toBe("PICK_DATE");
    expect(result.calendar.length).toBeGreaterThan(0);
  });
  it("restores the base rate when moving from a peak slot to a normal slot", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "btn:slot-a", { ...f.bookingState, step: "PICK_TIME", tprice: 600 });
    expect(result.state.tprice).toBe(400);
  });
  it("quotes the same cents-based group discount used at checkout", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "9", { ...f.bookingState, step: "ASK_QTY", tprice: 399 });
    expect(result.state).toMatchObject({ total: 3411.45, discount: 179.55 });
  });

  it("shows rand amounts with both cent digits", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "6", { ...f.bookingState, step: "ASK_QTY", tprice: 375 });
    expect(result.reply).toContain("Total: R2137.50 (5% automatic discount, R112.50 saved)");
  });
});

describe("web chat payment and failure checks", () => {
  it("completes a booking through an atomic hold and payment link", async () => {
    const f = webChatFixture();
    const token = await f.session();
    let result = await f.post(token, "btn:book");
    for (const message of ["btn:" + f.tour.id, "btn:" + f.bookingState.selectedDate, "btn:" + f.slot.id, "2", "Fixture Guest, guest@fixture.invalid, +27110000000", "btn:no_voucher", "btn:confirm"]) result = await f.post(token, message, result.state);
    expect(result.paymentUrl).toBe("https://pay.fixture.invalid/checkout-a");
    expect(f.rows.bookings).toHaveLength(1);
    expect(f.rows.bookings[0]).toMatchObject({ business_id: "a", qty: 2, total_amount: 800, status: "HELD" });
    expect(f.rows.holds).toHaveLength(1);
    expect(f.calls.filter(call => call.kind === "fetch")).toHaveLength(1);
  });
  for (const text of ["Can you confirm the meeting point?", "I'm not sure", "yes, but don't book yet", "How do I confirm?", "do not confirm"]) {
    it(`requires explicit consent before checkout: ${text}`, async () => {
      const f = webChatFixture();
      const result = await f.post(await f.session(), text, f.bookingState);
      expect(result.paymentUrl).toBeFalsy();
      expect(f.rows.bookings).toEqual([]);
      expect(f.calls.filter(call => call.kind === "fetch")).toEqual([]);
    });
  }
  it("rejects fractional or negative quantities at the server pricing boundary", async () => {
    for (const qty of [1.5, -2, 0, Infinity]) {
      const f = webChatFixture();
      await f.post(await f.session(), "btn:confirm", { ...f.bookingState, qty, total: qty * 400 });
      expect(f.rows.bookings).toEqual([]);
    }
  });
  it("reconfirms stale pricing without creating a booking", async () => {
    const f = webChatFixture();
    f.slot.price_per_person_override = 500 as any;
    const result = await f.post(await f.session(), "btn:confirm", f.bookingState);
    expect(result.state.total).toBe(1000);
    expect(f.rows.bookings).toEqual([]);
  });
  it("cleans up a booking when capacity disappears", async () => {
    const f = webChatFixture();
    f.settings.holdAvailable = false;
    const result = await f.post(await f.session(), "btn:confirm", f.bookingState);
    expect(result.paymentUrl).toBeFalsy();
    expect(f.rows.bookings).toEqual([]);
    expect(f.rows.holds).toEqual([]);
  });
  it("reuses the checkout when the same confirmation is retried", async () => {
    const f = webChatFixture();
    const token = await f.session();
    const first = await f.post(token, "btn:confirm", f.bookingState);
    const retry = await f.post(token, "btn:confirm", f.bookingState);
    expect(f.rows.bookings).toHaveLength(1);
    expect(f.rows.holds).toHaveLength(1);
    expect(retry.paymentUrl).toBe(first.paymentUrl);
    expect(f.calls.filter(call => call.kind === "fetch")).toHaveLength(1);
  });
  it("creates only one booking and hold for simultaneous confirmations", async () => {
    const f = webChatFixture();
    const token = await f.session();
    await Promise.all([f.post(token, "btn:confirm", f.bookingState), f.post(token, "btn:confirm", f.bookingState)]);
    expect(f.rows.bookings).toHaveLength(1);
    expect(f.rows.holds).toHaveLength(1);
    expect(f.calls.filter(call => call.kind === "fetch")).toHaveLength(1);
  });
  it("rejects a tour or time that closed or passed during checkout", async () => {
    for (const change of ["past", "inactive", "closed"]) {
      const f = webChatFixture();
      if (change === "past") f.slot.start_time = new Date(Date.now() - 3_600_000).toISOString();
      if (change === "inactive") f.tour.active = false;
      if (change === "closed") f.slot.status = "CLOSED";
      await f.post(await f.session(), "btn:confirm", f.bookingState);
      expect(f.rows.bookings).toEqual([]);
    }
  });
  it("requires valid contact details even if the confirmation state is forged", async () => {
    const f = webChatFixture();
    await f.post(await f.session(), "btn:confirm", { ...f.bookingState, email: "invalid", name: "", phone: "" });
    expect(f.rows.bookings).toEqual([]);
  });
  for (const checkout of ["error", "non-json", "throw"]) {
    it(`releases capacity and makes a real handoff on checkout ${checkout}`, async () => {
      const f = webChatFixture();
      f.settings.checkout = checkout;
      const result = await f.post(await f.session(), "btn:confirm", f.bookingState);
      expect(result.status).toBe(200);
      expect(result.paymentUrl).toBeFalsy();
      expect(f.rows.bookings[0].status).toBe("CANCELLED");
      expect(f.rows.holds.every(row => row.status !== "ACTIVE")).toBe(true);
      expect(f.rows.conversations[0].status).toBe("HUMAN");
      expect(result.state.status).toBe("HUMAN");
    });
  }
  it("does not promise an agent when the handoff cannot be saved", async () => {
    const f = webChatFixture();
    f.failures["insert:conversations"] = { message: "Database unavailable" };
    f.failures["upsert:conversations"] = { message: "Database unavailable" };
    const result = await f.post(await f.session(), "I want to speak to a human");
    expect(result.status).toBeGreaterThanOrEqual(500);
    expect(result.state?.status).not.toBe("HUMAN");
  });
});

describe("web chat gift checkout checks", () => {
  async function giftSummary(f: ReturnType<typeof webChatFixture>, token: string) {
    let result = await f.post(token, "buy a gift voucher");
    for (const message of ["btn:" + f.tour.id, "Nora Guest", "Enjoy the adventure!", "Gift Buyer", "buyer@fixture.invalid"]) result = await f.post(token, message, result.state);
    expect(result.state.step).toBe("GIFT_CONFIRM");
    return result.state;
  }
  it("buys a gift using the canonical price and preserves the message", async () => {
    const f = webChatFixture();
    const token = await f.session();
    const state = await giftSummary(f, token);
    const result = await f.post(token, "btn:gift_confirm", state);
    expect(result.paymentUrl).toBe("https://pay.fixture.invalid/checkout-a");
    expect(f.rows.vouchers).toHaveLength(1);
    expect(f.rows.vouchers[0]).toMatchObject({ purchase_amount: 400, gift_message: "Enjoy the adventure!", recipient_name: "Nora Guest" });
  });
  it("deduplicates gift confirmations, including parallel requests", async () => {
    const f = webChatFixture();
    const token = await f.session();
    const state = await giftSummary(f, token);
    const responses = await Promise.all([f.post(token, "btn:gift_confirm", state), f.post(token, "btn:gift_confirm", state)]);
    const retry = await f.post(token, "btn:gift_confirm", state);
    expect(f.rows.vouchers).toHaveLength(1);
    expect(f.calls.filter(call => call.kind === "fetch")).toHaveLength(1);
    expect(retry.paymentUrl).toBe(responses.find(response => response.paymentUrl)?.paymentUrl);
  });
  for (const checkout of ["error", "non-json", "throw"]) {
    it(`keeps gift checkout ${checkout} recoverable without a pending voucher`, async () => {
      const f = webChatFixture();
      const token = await f.session();
      const state = await giftSummary(f, token);
      f.settings.checkout = checkout;
      const result = await f.post(token, "btn:gift_confirm", state);
      expect(result.status).toBe(200);
      expect(result.paymentUrl).toBeFalsy();
      expect(f.rows.vouchers.every(row => row.status !== "PENDING")).toBe(true);
      expect(result.state.status).toBe("HUMAN");
    });
  }
});

describe("web chat voucher redemption checks", () => {
  for (const step of ["ASK_VOUCHER", "ENTER_VOUCHER"]) {
    it(`removes previous voucher credit when skipping from ${step}`, async () => {
      const f = webChatFixture();
      const result = await f.post(await f.session(), "skip", { ...f.bookingState, step, vid: "voucher-a", vded: 100, total: 700 });
      expect(result.state).toMatchObject({ vid: null, vded: 0, total: 800 });
    });
    it(`redeems codes containing 'no' from ${step} without skipping them`, async () => {
      const f = webChatFixture();
      f.rows.vouchers.push({ id: "voucher-a", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 100, value: 100 });
      const result = await f.post(await f.session(), "CANOE888", { ...f.bookingState, step });
      expect(result.state).toMatchObject({ step: "CONFIRM", vid: "voucher-a", vded: 100, total: 700 });
    });
    it(`does not revive an exhausted voucher balance from ${step}`, async () => {
      const f = webChatFixture();
      f.rows.vouchers.push({ id: "voucher-a", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 0, value: 800 });
      const result = await f.post(await f.session(), "CANOE888", { ...f.bookingState, step });
      expect(result.state.total).toBe(800);
      expect(result.state.vded).toBe(0);
    });
  }
  it("completes a fully covered voucher booking once without a payment link", async () => {
    const f = webChatFixture();
    f.rows.vouchers.push({ id: "voucher-a", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 800, value: 800 });
    const token = await f.session();
    const summary = await f.post(token, "CANOE888", { ...f.bookingState, step: "ASK_VOUCHER" });
    const result = await f.post(token, "btn:confirm", summary.state);
    const retry = await f.post(token, "btn:confirm", summary.state);
    expect(retry.reply).toContain("already confirmed");
    expect(result.paymentUrl).toBeFalsy();
    expect(f.rows.bookings).toHaveLength(1);
    expect(f.rows.bookings[0].status).toBe("PAID");
    expect(f.calls.filter(call => call.name === "confirm_voucher_booking")).toHaveLength(1);
    expect(f.calls.filter(call => call.kind === "fetch")).toHaveLength(1);
  });
  it("confirms the tour and time from the database, not the browser's state", async () => {
    const f = webChatFixture();
    f.rows.vouchers.push({ id: "voucher-a", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 800, value: 800 });
    const token = await f.session();
    const summary = await f.post(token, "CANOE888", { ...f.bookingState, step: "ASK_VOUCHER" });
    await f.post(token, "btn:confirm", { ...summary.state, tname: "Free champagne cruise", slotTime: "2030-01-01T09:00:00Z" });
    const email = f.calls.find(call => call.name.endsWith("/send-email"))!.data.data;
    expect(email.tour_name).toBe("Sea Kayak Tour");
    expect(email.start_time).not.toContain("2030");
  });
  it("rejects a voucher that expires before confirmation", async () => {
    const f = webChatFixture();
    const voucher = { id: "voucher-a", business_id: "a", code: "CANOE888", status: "ACTIVE", type: "MONETARY", current_balance: 100, value: 100, expires_at: new Date(Date.now() + 100_000).toISOString() };
    f.rows.vouchers.push(voucher);
    const token = await f.session();
    const summary = await f.post(token, "CANOE888", { ...f.bookingState, step: "ASK_VOUCHER" });
    voucher.expires_at = new Date(Date.now() - 1000).toISOString();
    const result = await f.post(token, "btn:confirm", summary.state);
    expect(result.state.step).toBe("ASK_VOUCHER");
    expect(f.rows.bookings).toHaveLength(0);
  });
});

describe("web chat request boundaries", () => {
  it("keeps operator timezones isolated across overlapping requests", async () => {
    const f = webChatFixture();
    f.business.timezone = "Asia/Tokyo";
    f.slot.start_time = new Date(Date.now() + 72 * 3_600_000).toISOString().slice(0, 10) + "T23:30:00.000Z";
    f.rows.businesses.push({ ...f.business, id: "b", timezone: "America/Los_Angeles" });
    f.rows.tours.push({ ...f.tour, id: "tour-b", business_id: "b" });
    f.rows.slots.push({ ...f.slot, id: "slot-b", tour_id: "tour-b", business_id: "b" });
    const tokenA = await f.session();
    const tokenB = (await (await f.request({ action: "session", business_id: "b" })).json()).chat_session;
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const rpc = f.db.rpc;
    f.db.rpc = async (name, args) => {
      if (name === "list_available_slots" && args.p_business_id === "a") { entered(); await gate; }
      return rpc(name, args);
    };
    const first = f.post(tokenA, "btn:tour-a", { step: "PICK_TOUR" });
    await paused;
    await f.request({ chat_session: tokenB, business_id: "b", message: "btn:tour-b", state: { step: "PICK_TOUR" } });
    release();
    const result = await first;
    expect(result.calendar[0].date).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(f.slot.start_time)));
  });
  it("does not disconnect a human thread when polling storage is unavailable", async () => {
    const f = webChatFixture();
    const token = await f.session();
    f.failures["select:conversations"] = { message: "Storage unavailable" };
    const response = await f.request({ action: "poll", chat_session: token });
    expect(response.status).toBe(503);
    expect((await response.json()).status).not.toBe("BOT");
  });
  it("does not answer over an agent when conversation storage is unavailable", async () => {
    const f = webChatFixture();
    const token = await f.session();
    f.failures["select:conversations"] = { message: "Storage unavailable" };
    const result = await f.post(token, "What should I bring?");
    expect(result.status).toBe(503);
    expect(f.calls.filter(call => call.kind === "llm")).toHaveLength(0);
  });
  it("does not acknowledge handoff messages that could not be saved", async () => {
    const f = webChatFixture();
    f.failures["insert:chat_messages"] = { message: "Storage unavailable" };
    const result = await f.post(await f.session(), "I want to speak to a human");
    expect(result.status).toBe(500);
  });
  it("keeps stale buttons silent during a human handoff", async () => {
    const f = webChatFixture();
    const token = await f.session();
    await f.post(token, "I want to speak to a human");
    const result = await f.post(token, "btn:book");
    expect(result.human).toBe(true);
    expect(result.reply).toBe("");
    expect(f.calls.filter(call => call.kind === "llm")).toEqual([]);
  });
  it("keeps human polling separate from the visitor's message budget", async () => {
    const f = webChatFixture();
    const token = await f.session();
    for (let i = 0; i < 18; i++) expect((await f.request({ action: "poll", chat_session: token })).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await f.post(token, "What should I bring?")).status).toBe(200);
  });
  it("rate limits on the client IP the platform sets, not a spoofable forwarded-for", async () => {
    const f = webChatFixture();
    const token = await f.session();
    for (let i = 0; i < 25; i++) await f.request({ chat_session: token, message: "hello", state: { step: "IDLE" } }, { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113." + i });
    const keys = f.calls.filter(call => call.kind === "rpc" && call.name === "check_rate_limit").map(call => call.data.p_ip);
    expect(keys.slice(1).every(ip => ip === "198.51.100.7")).toBe(true);
    expect((await f.request({ chat_session: token, message: "hello" }, { "cf-connecting-ip": "198.51.100.7" })).status).toBe(429);
  });
  it("still rate limits repeated messages", async () => {
    const f = webChatFixture();
    const token = await f.session();
    const statuses = [];
    for (let i = 0; i < 25; i++) statuses.push((await f.post(token, "hello")).status);
    expect(statuses).toContain(429);
  });
  for (const body of [{ message: {} }, { messages: {} }, { state: [] }, { message: "x".repeat(4001) }]) {
    it(`rejects malformed input before calling a model: ${JSON.stringify(body).slice(0, 60)}`, async () => {
      const f = webChatFixture();
      const response = await f.request({ chat_session: await f.session(), ...body });
      expect(response.status).toBe(400);
      expect(f.calls.filter(call => call.kind === "llm")).toEqual([]);
    });
  }
  it("rejects an unrelated website origin", async () => {
    const f = webChatFixture();
    const response = await f.request({ chat_session: await f.session(), message: "hello" }, { origin: "https://unrelated.invalid" });
    expect(response.status).toBe(403);
    expect(f.rows.chat_messages).toEqual([]);
  });
});


describe("web chat automatic discount settings", () => {
  it("uses the configured group offer instead of a fixed five percent", async () => {
    const f = webChatFixture();
    Object.assign(f.discount, { percent: 12, minQty: 4, label: "Family offer" });
    const result = await f.post(await f.session(), "4", { ...f.bookingState, step: "ASK_QTY", phone: "" });
    expect(result.state).toMatchObject({ qty: 4, baseTotal: 1600, discount: 192, total: 1408 });
    expect(result.reply).toContain("12% automatic discount");
    expect(f.calls.find(call => call.name === "resolve_booking_discount")?.data).toEqual({ p_business_id: "a", p_phone: null, p_qty: 4, p_email: null });
  });

  it("respects disabled offers even for six or more guests", async () => {
    const f = webChatFixture();
    f.discount.percent = 0;
    const result = await f.post(await f.session(), "6", { ...f.bookingState, step: "ASK_QTY" });
    expect(result.state).toMatchObject({ discount: 0, total: 2400 });
    expect(result.reply).not.toContain("discount");
  });

  it("a typed phone number doesn't unlock (or reveal) a returning guest's offer", async () => {
    const f = webChatFixture();
    Object.assign(f.discount, { type: "RETURNING", percent: 15, minQty: 1, phone: "+27110000000", label: "Welcome back" });
    const token = await f.session();
    const quote = await f.post(token, "2", { ...f.bookingState, step: "ASK_QTY", name: "", email: "", phone: "" });
    const details = await f.post(token, "Fixture Guest, guest@fixture.invalid, +27110000000", quote.state);
    expect(details.state).toMatchObject({ step: "ASK_VOUCHER", total: 800, discount: 0 });
    expect(details.reply).not.toContain("discount");
    await f.post(token, "btn:confirm", { ...details.state, step: "CONFIRM" });
    expect(f.rows.bookings[0]).toMatchObject({ total_amount: 800, discount_amount: 0, discount_notes: null });
    expect(f.calls.filter(call => call.name === "resolve_booking_discount").map(call => call.data.p_phone)).toEqual([null, null, null]);
  });

  it("rechecks rules at confirmation and requires acceptance of a changed total", async () => {
    const f = webChatFixture();
    Object.assign(f.discount, { type: "RETURNING", percent: 15, minQty: 1, label: "Welcome back" });
    const token = await f.session();
    const revised = await f.post(token, "btn:confirm", { ...f.bookingState, bid: "other-tenant" });
    expect(revised.state.total).toBe(680);
    expect(revised.reply).toContain("review and confirm again");
    expect(f.rows.bookings).toEqual([]);
    await f.post(token, "btn:confirm", revised.state);
    expect(f.rows.bookings).toHaveLength(1);
    expect(f.rows.bookings[0]).toMatchObject({ business_id: "a", total_amount: 680, discount_type: "PERCENT", discount_percent: 15, discount_amount: 120, discount_notes: "Welcome back" });
    expect(f.calls.filter(call => call.name === "resolve_booking_discount").every(call => call.data.p_business_id === "a")).toBe(true);
  });

  it("does not quote or create a booking when discount rules cannot be checked", async () => {
    for (const step of ["ASK_QTY", "CONFIRM"]) {
      const f = webChatFixture();
      f.failures["rpc:resolve_booking_discount"] = { message: "Unavailable" };
      const result = await f.post(await f.session(), step === "ASK_QTY" ? "2" : "btn:confirm", { ...f.bookingState, step });
      expect(result.status).toBe(500);
      expect(f.rows.bookings).toEqual([]);
      expect(f.calls.filter(call => call.kind === "fetch")).toEqual([]);
    }
  });
});

describe("web chat booking copy", () => {
  it("a new chat needs a passed Turnstile check once the secret is set", async () => {
    const open = webChatFixture();
    expect(await open.session()).toBeTruthy(); // no key yet: not enforced
    const f = webChatFixture(undefined, { TURNSTILE_SECRET_KEY: "fixture-turnstile-secret" });
    for (const token of [undefined, "bad-token"]) {
      const res = await f.request({ action: "session", turnstile_token: token });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("TURNSTILE_REQUIRED");
    }
    const res = await f.request({ action: "session", turnstile_token: "good-token" });
    const chat = (await res.json()).chat_session;
    expect(chat).toBeTruthy();
    const verify = f.calls.filter((c: any) => c.name.includes("siteverify")).at(-1);
    expect(verify.data).toMatchObject({ secret: "fixture-turnstile-secret", response: "good-token", remoteip: "fixture-client" });
    // Checked once per chat: a live session is reused without another check.
    const calls = f.calls.length;
    expect((await (await f.request({ action: "session", chat_session: chat })).json()).chat_session).toBe(chat);
    expect(f.calls.slice(calls).some((c: any) => c.name.includes("siteverify"))).toBe(false);
  });

  it("takes a promo code in chat, priced like checkout and passed to it", async () => {
    // Owner decision 2026-10-28: promo codes are accepted in chat. A promo replaces the automatic discount.
    const f = webChatFixture();
    f.settings.promos = { SPRING10: { code: "SPRING10", business_id: "a", discount_type: "PERCENT", discount_value: 10 } };
    const token = await f.session();
    const details = await f.post(token, "Fixture Guest, guest@fixture.invalid, +27110000000", { ...f.bookingState, step: "ASK_DETAILS" });
    expect(details.reply).toContain("Do you have a voucher or promo code?");
    const missing = await f.post(token, "NOPE-123", details.state);
    expect(missing.state.step).toBe("ASK_VOUCHER");
    expect(missing.reply).toBe("Can't find that code. Double-check it?");
    const summary = await f.post(token, "spring10", details.state);
    expect(summary.state).toMatchObject({ step: "CONFIRM", total: 720, discount: 80, promo: { code: "SPRING10" } });
    expect(summary.reply).toContain("Promo SPRING10 applied: R80 off.");
    // A tampered state can't change the promo's value: CONFIRM prices it from the server's answer.
    const tampered = { ...summary.state, promo: { code: "SPRING10", discountType: "PERCENT", discountValue: 100 } };
    const paid = await f.post(token, "btn:confirm", tampered);
    expect(paid.paymentUrl).toBe("https://pay.fixture.invalid/checkout-a");
    const checkout = f.calls.find((c: any) => c.kind === "fetch" && c.name.endsWith("/create-checkout"));
    expect(checkout.data).toMatchObject({ amount: 720, promo_code: "SPRING10" });
    expect(f.calls.some((c: any) => c.kind === "rpc" && c.name === "confirm_voucher_booking")).toBe(false);
  });

  it("drops a promo this guest already used before anything is booked", async () => {
    const f = webChatFixture();
    f.settings.promos = { SPRING10: { code: "SPRING10", business_id: "a", discount_type: "PERCENT", discount_value: 10, usedBy: ["guest@fixture.invalid"] } };
    const token = await f.session();
    const state = { ...f.bookingState, total: 720, baseTotal: 800, discount: 80, promo: { code: "SPRING10", discountType: "PERCENT", discountValue: 10 } };
    const reply = await f.post(token, "btn:confirm", state);
    expect(reply.reply).toBe("You have already used this promo code. I've taken the promo code off. Do you have another voucher or promo code?");
    expect(reply.state).toMatchObject({ step: "ASK_VOUCHER", promo: null, total: 800, discount: 0 });
    expect(f.rows.bookings).toHaveLength(0);
  });

  it("a promo that covers the whole trip books through checkout, which records its use", async () => {
    const f = webChatFixture();
    f.settings.promos = { FREEDAY: { code: "FREEDAY", business_id: "a", discount_type: "PERCENT", discount_value: 100 } };
    f.settings.checkout = "fully-covered";
    const token = await f.session();
    const summary = await f.post(token, "FREEDAY", { ...f.bookingState, step: "ASK_VOUCHER", baseTotal: 800, discount: 0 });
    expect(summary.state.total).toBe(0);
    const booked = await f.post(token, "btn:confirm", summary.state);
    expect(booked.reply).toContain("You're booked!");
    expect(f.calls.some((c: any) => c.kind === "rpc" && c.name === "confirm_voucher_booking")).toBe(false);
    expect(f.calls.some((c: any) => c.kind === "fetch" && c.name.endsWith("/confirm-booking"))).toBe(true);
  });

  it("shows the Terms on the summary, before the guest taps Confirm", async () => {
    // A voucher-paid booking completes on that tap; the notice used to arrive afterwards.
    const f = webChatFixture();
    f.rows.vouchers.push({ id: "v-a", code: "GIFT2345", business_id: "a", status: "ACTIVE", type: "CREDIT", current_balance: 2000 });
    const token = await f.session();
    for (const [step, message] of [["ASK_VOUCHER", "btn:no_voucher"], ["ENTER_VOUCHER", "btn:no_voucher"], ["ASK_VOUCHER", "GIFT2345"], ["ENTER_VOUCHER", "GIFT2345"]]) {
      const summary = await f.post(token, message, { ...f.bookingState, step, baseTotal: 800, discount: 0 });
      expect(summary.state.step).toBe("CONFIRM");
      expect(summary.reply).toContain("you accept our Terms & Privacy Policy: https://a.booking.fixture.invalid/terms");
    }
  });

  it("a free-trip voucher is credit up to its value, whatever the group size", async () => {
    // Owner decision 2026-10-28: a R800 free trip can pay for two R400 seats.
    const f = webChatFixture();
    f.rows.vouchers.push({ id: "v-a", code: "FREE2345", business_id: "a", status: "ACTIVE", type: "FREE_TRIP", pax_limit: 1, value: 800, purchase_value: 800, current_balance: 800 });
    const token = await f.session();
    for (const step of ["ASK_VOUCHER", "ENTER_VOUCHER"]) {
      const summary = await f.post(token, "FREE2345", { ...f.bookingState, step, baseTotal: 800, discount: 0 });
      expect(summary.state).toMatchObject({ step: "CONFIRM", vded: 800, total: 0 });
    }
  });

  it("a one-guest booking reads 1 person, with no em dashes", async () => {
    const f = webChatFixture();
    const token = await f.session();
    const quote = await f.post(token, "1", { ...f.bookingState, step: "ASK_QTY", name: "", email: "", phone: "" });
    const details = await f.post(token, "Fixture Guest, guest@fixture.invalid, +27110000000", quote.state);
    const summary = await f.post(token, "btn:no_voucher", details.state);
    const seen = [quote, details, summary].map(r => r.reply + JSON.stringify(r.buttons || [])).join("\n");
    expect(summary.reply).toContain("1 person");
    expect(seen).not.toMatch(/people|—/);
  });
});
