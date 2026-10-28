import { describe, expect, it, vi } from "vitest";
import { applicableBookingQuestions, captureQuestionFields, QUESTION_SCHEMA_KEY, validateQuestionAnswers } from "../../supabase/functions/_shared/booking-custom-fields";
import { calculateChatBookingPricing, rands, verifyChatBookingPricing } from "../../supabase/functions/_shared/chat-booking-pricing";
import { sourceFunction } from "../helpers/source-handler";

// Drives the real WhatsApp handleMsg with in-memory tables; network stays off.
const tenant = { business: { id: "tenant-a" } };
const phone = "27825550100";
const tour = { id: "20000000-0000-4000-8000-000000000001", business_id: "tenant-a", name: "Sunset Paddle", description: "Two hours on the bay.", duration_minutes: 120, base_price_per_person: 600 };

function query(result: any, filters: any[]) {
  const chain: any = {};
  for (const name of ["select", "update", "insert", "delete", "eq", "in", "not", "gt", "gte", "lt", "lte", "order", "limit"]) {
    chain[name] = (...args: any[]) => { filters.push([name, ...args]); return chain; };
  }
  chain.single = chain.maybeSingle = async () => result;
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

// The real module helpers handleMsg calls for booking questions.
const wa = "supabase/functions/wa-webhook/index.ts";
const waTermsNotice = sourceFunction(wa, "waTermsNotice", {});
const questionHelpers = (db: any, sent: string[], changes: any[]) => {
  const send = async (_t: any, _p: any, message: string) => { sent.push(message); };
  const setConvo = async (_id: string, data: any) => { changes.push(data); };
  return {
    validateQuestionAnswers, captureQuestionFields,
    getBookingCustomFields: sourceFunction(wa, "getBookingCustomFields", { supabase: db, applicableBookingQuestions }),
    needsQuestionForm: sourceFunction(wa, "needsQuestionForm", {}),
    sendQuestionFormLink: sourceFunction(wa, "sendQuestionFormLink", { sendText: send, sendButtons: send, setConvo }),
    nextCustomField: sourceFunction(wa, "nextCustomField", {}),
    promptForCustomField: sourceFunction(wa, "promptForCustomField", {}),
  };
};

function bot(state: string, stateData: any, tables: Record<string, any> = {}, extra: Record<string, unknown> = {}) {
  const sent: string[] = []; const changes: any[] = []; const filters: Record<string, any[]> = {};
  // The first step of ordinary IDLE/MENU handling; stops the run there.
  const ordinary = vi.fn(() => { throw new Error("reached ordinary handling"); });
  const db = { from: (table: string) => query({ data: tables[table] ?? (table === "outbox" ? [] : null) }, filters[table] ||= []), rpc: extra.rpc || vi.fn() };
  const handle = sourceFunction(wa, "handleMsg", {
    getConvo: async () => ({ id: "conversation-a", current_state: state, state_data: stateData }),
    supabase: db, ...questionHelpers(db, sent, changes),
    getSubscriptionState: async () => ({ trading: true }), shouldBotReply: async () => ({ active: true }),
    sendText: async (_t: any, _p: any, message: string) => { sent.push(message); },
    sendButtons: async (_t: any, _p: any, body: string) => { sent.push(body); },
    setConvo: async (_id: string, data: any) => { changes.push(data); },
    logE: async () => { throw new Error("Unexpected bot error"); }, typingDelay: async () => undefined,
    isAvailabilityQuery: ordinary, formatDuration: (m: number) => m + " min", calculateChatBookingPricing, rands, waTermsNotice, ...extra,
  });
  return { handle, sent, changes, filters, ordinary };
}

describe("WhatsApp booking flow", () => {
  it("accepts a name in any script", async () => {
    const consent = vi.fn(async () => undefined);
    const b = bot("ASK_DETAILS", { qty: 1 }, {}, { askBookingWhatsappConsent: consent });
    await b.handle(tenant, phone, "李明, li.ming@example.invalid", "text");
    expect(b.sent.join("\n")).not.toContain("need your full name");
    expect(consent).toHaveBeenCalled();
    expect(b.changes.at(-1)).toMatchObject({ current_state: "ASK_WHATSAPP_UPDATES", state_data: { customer_name: "李明", email: "li.ming@example.invalid" } });
  });

  it("a tour without a description, and a party of one, read naturally", async () => {
    const b = bot("PICK_TOUR", {}, { tours: { ...tour, description: null } });
    await b.handle(tenant, phone, "", "interactive", { list_reply: { id: "TOUR_" + tour.id } });
    expect(b.sent[0]).toMatch(/^\*Sunset Paddle\* \u{1F6F6}\n\n\u23F1 120 min/u);
    const slot = { id: "slot-a", status: "OPEN", start_time: new Date(Date.now() + 86_400_000).toISOString(), tour_id: tour.id };
    const full = bot("PICK_SLOT", { qty: 1, slot_map: { 1: "slot-a" } }, { slots: slot }, { rpc: async () => ({ data: 0, error: null }) });
    await full.handle(tenant, phone, "1", "text");
    expect(full.sent[0]).toContain("for 1 person (only 0 left)");
  });

  it("the summary shows the Terms before the guest taps Confirm", async () => {
    // A voucher-paid booking completes on that tap; the notice used to arrive afterwards.
    const slot = { id: "slot-a", status: "OPEN", start_time: new Date(Date.now() + 86_400_000).toISOString(), tour_id: tour.id };
    const b = bot("PICK_SLOT", { qty: 2, slot_map: { 1: "slot-a" } }, { slots: slot, tours: tour }, {
      rpc: async () => ({ data: 10, error: null }), getSlotPrice: async () => 600, fmtTime: () => "Sat 09:00",
      calcDiscount: async () => ({ type: "", percent: 0, label: "" }),
    });
    await b.handle({ business: { id: "tenant-a", booking_site_url: "https://a.booking.example.invalid/" } }, phone, "1", "text");
    expect(b.sent.at(-1)).toContain("you accept our Terms & Privacy Policy: https://a.booking.example.invalid/terms\n\nLook good?");
  });

  for (const [state, id] of [["PICK_TOUR", "TOUR_"], ["GV_PICK_TOUR", "GV_"]]) {
    it(`${state} only loads a tour that belongs to this tenant and is on sale`, async () => {
      const b = bot(state, {}, { tours: tour });
      await b.handle(tenant, phone, "", "interactive", { list_reply: { id: id + tour.id } });
      expect(b.filters.tours).toContainEqual(["eq", "business_id", "tenant-a"]);
      expect(b.filters.tours).toContainEqual(["eq", "active", true]);
      expect(b.filters.tours).toContainEqual(["eq", "hidden", false]);
    });
  }

  it("a redeemed voucher survives the tour pick", async () => {
    const voucher = { voucher_code: "ABCD2345", voucher_id: "v-1", voucher_value: 600, voucher_type: "FREE_TRIP", voucher_pax_limit: 1, voucher_purchase_value: 600 };
    const b = bot("PICK_TOUR", voucher, { tours: tour });
    await b.handle(tenant, phone, "", "interactive", { list_reply: { id: "TOUR_" + tour.id } });
    expect(b.changes).toEqual([{ current_state: "ASK_QTY", state_data: { ...voucher, tour_id: tour.id } }]);
  });

  for (const input of ["do you supply waterproof bags?", "which trip is most popular", "can i get a receipt"]) {
    it(`"${input}" is answered, not handed to a human`, async () => {
      const b = bot("IDLE", {});
      await b.handle(tenant, phone, input, "text");
      expect(b.ordinary).toHaveBeenCalled();
      expect(b.changes.some(c => c.status === "HUMAN")).toBe(false);
    });
  }

  for (const input of ["I just paid, here is my POP", "sent proof of payment", "I paid it already"]) {
    it(`"${input}" goes to the team`, async () => {
      const b = bot("IDLE", {});
      await b.handle(tenant, phone, input, "text");
      expect(b.changes).toEqual([{ status: "HUMAN", current_state: "IDLE", state_data: {} }]);
    });
  }

  it("a typed yes at the booking summary continues to the details step", async () => {
    const b = bot("CONFIRM_BOOKING", { tour_id: tour.id, qty: 2, total: 1200 });
    await b.handle(tenant, phone, "Yes please", "text");
    expect(b.changes).toEqual([{ current_state: "ASK_DETAILS", state_data: { tour_id: tour.id, qty: 2, total: 1200 } }]);
  });

  it("a typed yes at the gift voucher summary creates the voucher and payment link", async () => {
    const insertVoucherWithRetry = vi.fn(async () => ({ data: { id: "v-1" }, error: null }));
    const b = bot("GV_CONFIRM", { tour_id: tour.id, tour_name: tour.name, value: 600, buyer_email: "buyer@example.invalid" }, {}, {
      genVoucherCode: () => "ABCD2345", insertVoucherWithRetry,
      requestCheckout: async () => ({ id: "checkout-1", redirectUrl: "https://pay.example.invalid/1" }),
    });
    await b.handle(tenant, phone, "ok", "text");
    expect(insertVoucherWithRetry).toHaveBeenCalledWith(expect.objectContaining({ business_id: "tenant-a", value: 600 }));
    expect(b.changes.at(-1)).toMatchObject({ current_state: "GV_AWAITING_PAYMENT" });
  });

  for (const [state, prompt] of [["CONFIRM_BOOKING", "Reply *yes* to continue, or *no* to cancel."], ["GV_CONFIRM", "Reply *yes* to pay, or *no* to cancel."]]) {
    it(`${state} answers anything else with how to continue, instead of silence`, async () => {
      const b = bot(state, { tour_id: tour.id, value: 600 });
      await b.handle(tenant, phone, "can I bring my dog?", "text");
      expect(b.sent).toEqual([prompt]); expect(b.changes).toEqual([]);
    });

    it(`${state} cancels on a typed "no thanks"`, async () => {
      const b = bot(state, { tour_id: tour.id, value: 600 });
      await b.handle(tenant, phone, "no thanks", "text");
      expect(b.changes).toEqual([{ current_state: "IDLE", state_data: {} }]);
    });
  }

  const summary = { tour_id: tour.id, slot_id: "slot-1", qty: 2, unit_price: 600, base_total: 1200, total: 1200, discount_percent: 0, voucher_deduction: 0 };
  const extraVoucher = { id: "v-2", code: "WXYZ2345", status: "ACTIVE", current_balance: 500, business_id: "tenant-a" };

  it("Add Voucher at the summary funds the booking with that voucher", async () => {
    const b = bot("ADD_EXTRA_VOUCHER", summary, { vouchers: extraVoucher });
    await b.handle(tenant, phone, "wxyz 2345", "text");
    expect(b.sent[0]).toContain("Voucher applied!"); expect(b.sent[0]).toContain("R700");
    expect(b.changes.at(-1)).toEqual({ current_state: "CONFIRM_BOOKING", state_data: {
      ...summary, voucher_id: "v-2", voucher_code: "WXYZ2345", voucher_value: 500, voucher_codes: ["WXYZ2345"], voucher_ids: ["v-2"], voucher_deduction: 500, total: 700,
    } });
    // FINALIZE_BOOKING re-prices with the same inputs and must agree (no false "price changed").
    const next = b.changes.at(-1).state_data;
    expect(verifyChatBookingPricing({ quotedTotal: next.total, tolerance: 0.005, qty: 2, unitPrice: 600, voucherDeduction: next.voucher_deduction, groupDiscountPercent: 0, groupDiscountMinQty: 1 }).ok).toBe(true);
  });

  it("the same voucher can't be added twice", async () => {
    const b = bot("ADD_EXTRA_VOUCHER", { ...summary, voucher_id: "v-2", voucher_code: "WXYZ2345", voucher_deduction: 500, total: 700 }, { vouchers: extraVoucher });
    await b.handle(tenant, phone, "WXYZ2345", "text");
    expect(b.sent).toEqual(["That voucher is already on this booking."]);
    expect(b.changes).toEqual([{ current_state: "CONFIRM_BOOKING" }]);
  });

  it("a checkout the vouchers fully cover confirms the booking instead of saying the link is unavailable", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    const b = bot("FINALIZE_BOOKING", { ...summary, customer_name: "Synthetic Guest", email: "guest@example.invalid", whatsapp_booking_updates_opt_in: false }, {
      slots: { id: "slot-1", start_time: "2099-01-01T08:00:00Z", status: "OPEN", tour_id: tour.id, price_per_person_override: null, business_id: "tenant-a" },
      tours: tour, bookings: { id: "30000000-0000-4000-8000-000000000001", waiver_token: "token-1" },
    }, {
      fetch, SUPABASE_URL: "https://test.invalid", SUPABASE_KEY: "service-key", verifyChatBookingPricing, rands, waTermsNotice,
      calcDiscount: async () => ({ type: "NONE", percent: 0, label: "" }), logE: async () => undefined,
      rpc: async () => ({ data: { success: true } }), requestCheckout: async () => ({ fully_covered: true, redirectUrl: "https://example.invalid/success", amount: 0 }),
    });
    await b.handle({ business: { id: "tenant-a", booking_site_url: "" } }, phone, "internal_proceed", "text");
    expect(fetch).toHaveBeenCalledWith("https://test.invalid/functions/v1/confirm-booking", expect.objectContaining({
      body: JSON.stringify({ booking_id: "30000000-0000-4000-8000-000000000001", booking_token: "token-1" }),
    }));
    expect(b.sent.at(-1)).toContain("You\u2019re all set!");
    expect(b.sent.join("\n")).not.toContain("Payment link unavailable");
    expect(b.changes.at(-1)).toMatchObject({ current_state: "IDLE", state_data: {} });
  });

  const voucherOnly = (bookingStatus: string, confirmation: any) => bot("FINALIZE_BOOKING", {
    ...summary, voucher_id: "v-2", voucher_ids: ["v-2"], voucher_codes: ["WXYZ2345"], voucher_deduction: 1200, total: 0,
    customer_name: "Synthetic Guest", email: "guest@example.invalid", whatsapp_booking_updates_opt_in: false,
  }, {
    slots: { id: "slot-1", start_time: "2099-01-01T08:00:00Z", status: "OPEN", tour_id: tour.id, price_per_person_override: null, business_id: "tenant-a" },
    tours: tour, bookings: { id: "30000000-0000-4000-8000-000000000001", waiver_token: "token-1", status: bookingStatus },
  }, {
    verifyChatBookingPricing, rands, waTermsNotice, calcDiscount: async () => ({ type: "NONE", percent: 0, label: "" }), logE: async () => undefined,
    rpc: async (name: string) => name === "confirm_voucher_booking" ? confirmation : { data: { success: true } },
    getBookableTours: async () => [], resolveWaiverLink: () => "", fmtTime: () => "Fri 1 Jan, 10:00", businessName: () => "Fixture Kayak", fetch: vi.fn(async () => new Response("{}")),
  });

  it("a voucher-only booking that can't be confirmed is removed, not left pending", async () => {
    const b = voucherOnly("PENDING", { data: { ok: false, error: "VOUCHER_INSUFFICIENT" }, error: null });
    await b.handle(tenant, phone, "internal_proceed", "text");
    expect(b.filters.bookings).toContainEqual(["delete"]);
    expect(b.filters.bookings).toContainEqual(["eq", "status", "PENDING"]);
    expect(b.sent.at(-1)).toContain("We couldn't confirm that booking");
  });

  it("a voucher confirmation that committed before a network error is reported as booked", async () => {
    const b = voucherOnly("PAID", { data: null, error: { message: "upstream connect error" } });
    await b.handle(tenant, phone, "internal_proceed", "text");
    expect(b.filters.bookings).not.toContainEqual(["delete"]);
    expect(b.sent.join("\n")).toContain("You\u2019re all set!");
  });

  const ageQuestion = { key: "age", label: "Youngest guest's age", type: "number", required: true };
  const notesQuestion = { key: "notes", label: "Anything we should know?", type: "text" };

  it("ASK_DETAILS asks only the questions for this tour", async () => {
    const b = bot("ASK_DETAILS", { tour_id: tour.id, slot_id: "slot-1", qty: 2 }, { businesses: { booking_custom_fields: [{ ...ageQuestion, tour_ids: ["another-tour"] }, notesQuestion] } });
    await b.handle(tenant, phone, "Synthetic Guest, guest@example.invalid", "text");
    expect(b.sent.at(-1)).toBe("Almost done.\n\nAnything we should know? (optional, reply *skip* to leave it out)");
    expect(b.changes.at(-1).state_data.custom_field_defs.map((q: any) => q.key)).toEqual(["notes"]);
  });

  it("ASK_DETAILS sends choice and per-guest questions to the booking form", async () => {
    const b = bot("ASK_DETAILS", { tour_id: tour.id, slot_id: "slot-1", qty: 2 }, { businesses: { booking_custom_fields: [{ key: "size", label: "Wetsuit size", type: "select", options: ["S", "M"], scope: "participant" }] } });
    await b.handle({ business: { id: "tenant-a", booking_site_url: "https://book.example.invalid/" } }, phone, "Synthetic Guest, guest@example.invalid", "text");
    expect(b.sent.at(-1)).toContain("https://book.example.invalid/book?tour=" + tour.id + "&slot=slot-1");
    expect(b.changes.at(-1)).toEqual({ current_state: "MENU", state_data: {} });
  });

  it("an answer the checkout would reject is asked again", async () => {
    const defs = applicableBookingQuestions([ageQuestion], tour.id, "tenant-a");
    const b = bot("ASK_CUSTOM_FIELDS", { tour_id: tour.id, qty: 2, custom_field_defs: defs, custom_fields: {} });
    await b.handle(tenant, phone, "about ten", "text");
    expect(b.sent).toEqual(["Enter a valid number.\n\nYoungest guest's age *"]);
    expect(b.changes).toEqual([]);
  });

  it("an optional question can be skipped", async () => {
    const defs = applicableBookingQuestions([notesQuestion], tour.id, "tenant-a");
    const askBookingWhatsappConsent = vi.fn(async () => undefined);
    const b = bot("ASK_CUSTOM_FIELDS", { tour_id: tour.id, qty: 2, custom_field_defs: defs, custom_fields: {} }, {}, { askBookingWhatsappConsent });
    await b.handle(tenant, phone, "skip", "text");
    expect(b.changes).toEqual([{ current_state: "ASK_WHATSAPP_UPDATES", state_data: expect.objectContaining({ custom_fields: { notes: "" } }) }]);
    expect(askBookingWhatsappConsent).toHaveBeenCalled();
  });

  const finalize = (config: unknown[], answers: Record<string, unknown>) => bot("FINALIZE_BOOKING", { ...summary, customer_name: "Synthetic Guest", email: "guest@example.invalid", whatsapp_booking_updates_opt_in: false, custom_fields: answers }, {
    slots: { id: "slot-1", start_time: "2099-01-01T08:00:00Z", status: "OPEN", tour_id: tour.id, price_per_person_override: null, business_id: "tenant-a" },
    tours: tour, bookings: { id: "30000000-0000-4000-8000-000000000001", waiver_token: "token-1" }, businesses: { booking_custom_fields: config },
  }, {
    verifyChatBookingPricing, rands, waTermsNotice, calcDiscount: async () => ({ type: "NONE", percent: 0, label: "" }), logE: async () => undefined,
    rpc: async () => ({ data: { success: true } }), requestCheckout: async () => ({ id: "checkout-1", redirectUrl: "https://pay.example.invalid/1" }),
  });

  it("FINALIZE_BOOKING asks for a missing answer instead of creating a booking checkout would reject", async () => {
    const b = finalize([ageQuestion], {});
    await b.handle(tenant, phone, "internal_proceed", "text");
    expect(b.sent).toEqual(["Please complete the trip details first.\n\nYoungest guest's age *"]);
    expect(b.changes.at(-1)).toMatchObject({ current_state: "ASK_CUSTOM_FIELDS", state_data: { custom_fields: {} } });
    expect((b.filters.bookings || []).some(f => f[0] === "insert")).toBe(false);
  });

  it("FINALIZE_BOOKING saves the validated answers with the question snapshot", async () => {
    const b = finalize([ageQuestion], { age: "9" });
    await b.handle(tenant, phone, "internal_proceed", "text");
    const inserted = b.filters.bookings.find(f => f[0] === "insert")[1];
    expect(inserted.custom_fields.age).toBe("9");
    expect(inserted.custom_fields[QUESTION_SCHEMA_KEY]).toMatchObject({ format: 1, business_id: "tenant-a", tour_id: tour.id });
    expect(b.changes.at(-1)).toMatchObject({ current_state: "AWAITING_PAYMENT" });
  });
});
