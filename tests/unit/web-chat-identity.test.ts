import { describe, expect, it } from "vitest";
import { sourceExports, sourceFunction, sourceHandler } from "../helpers/source-handler";

const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", CUSTOMER_SESSION_SECRET: "fixture-session-secret" };
const customerSessions = sourceExports("supabase/functions/_shared/customer-session.ts", {}, env) as any;
const chatSessions = sourceExports("supabase/functions/_shared/web-chat-session.ts", { "./customer-session.ts": customerSessions }, env) as any;

function fixture() {
  const rows: Record<string, any[]> = { conversations: [], chat_messages: [], bookings: [], tours: [], slots: [], customers: [], vouchers: [] };
  const reads: string[] = [];
  const writes: any[] = [];
  const invocations: any[] = [];
  let intent = "OTHER";
  let changeResult: any = { ok: true, diff: 600, payment_url: "https://pay.fixture.invalid/add-guests" };
  const db = {
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      let mutation: { method: string; value: any } | null = null;
      const execute = async (single = false) => {
        const matched = (rows[table] || []).filter(row => filters.every(filter => filter(row)));
        if (mutation) {
          writes.push({ table, ...mutation, matched });
          if (mutation.method === "update") matched.forEach(row => Object.assign(row, mutation!.value));
          else rows[table]?.push(...(Array.isArray(mutation.value) ? mutation.value : [mutation.value]));
        } else reads.push(table);
        return { data: single ? matched[0] || null : matched, error: null };
      };
      const q: any = {
        select: () => q,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
        neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return q; },
        in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; },
        gt: (key: string, value: string) => { filters.push(row => row[key] > value); return q; },
        gte: (key: string, value: string) => { filters.push(row => row[key] >= value); return q; },
        lte: (key: string, value: string) => { filters.push(row => row[key] <= value); return q; },
        order: () => q, limit: () => q,
        update: (value: any) => { mutation = { method: "update", value }; return q; },
        insert: (value: any) => { mutation = { method: "insert", value }; return q; },
        upsert: (value: any) => { mutation = { method: "upsert", value }; return q; },
        maybeSingle: () => execute(true), single: () => execute(true), then: (resolve: any) => execute().then(resolve),
      };
      return q;
    },
    rpc: async () => ({ data: 10, error: null }),
    functions: { invoke: async (name: string, options: any) => {
      invocations.push({ name, ...options });
      return { data: changeResult, error: null };
    } },
  };
  const handler = sourceHandler("supabase/functions/web-chat/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: any) => fn },
    "../_shared/duration.ts": {},
    "../_shared/tenant.ts": {
      getTenantByBusinessId: async (_db: any, id: string) => ["a", "b"].includes(id)
        ? { business: { id, timezone: "UTC", booking_site_url: `https://${id}.booking.fixture.invalid` } } : null,
      resolveManageBookingsUrl: (business: any) => business.booking_site_url + "/my-bookings",
      getBusinessDisplayName: () => "Fixture operator",
    },
    "../_shared/bot-guards.ts": {}, "../_shared/intent.ts": {
      classifyIntent: async () => ({ intent, confidence: 1 }), priorityForIntent: () => "NORMAL",
    },
    "../_shared/subscription.ts": { getSubscriptionState: async () => ({ trading: true }) },
    "../_shared/chat-booking-pricing.ts": {}, "../_shared/platform-invariants.ts": {},
    "../_shared/llm.ts": {}, "../_shared/kb.ts": {},
    "../_shared/customer-session.ts": customerSessions,
    "../_shared/web-chat-session.ts": chatSessions,
  }, env);
  const post = (body: object) => handler(new Request("https://fixture.invalid/web-chat", {
    method: "POST", body: JSON.stringify({ business_id: "a", ...body }),
  }));
  const session = async (businessId = "a") => (await (await post({ action: "session", business_id: businessId })).json()).chat_session as string;
  const verifiedCustomer = async (email = "owner@fixture.invalid", businessId = "a") =>
    (await customerSessions.issueCustomerSession({ email, businessId })).token as string;
  return { rows, reads, writes, invocations, post, session, verifiedCustomer,
    setIntent: (value: string) => { intent = value; }, setChangeResult: (value: any) => { changeResult = value; } };
}

describe("web chat visitor capabilities", () => {
  for (const action of ["poll", "rate"]) {
    it(`rejects a caller-selected WhatsApp phone for ${action}`, async () => {
      const f = fixture();
      const response = await f.post({ action, rating: 5, phone: "27110000000", state: { phone: "27110000000", vid: "known-visitor" } });
      expect(response.status).toBe(401);
      expect(f.reads).toEqual([]);
      expect(f.writes).toEqual([]);
    });
  }
  it("does not accept another tenant's session or a forged token", async () => {
    const f = fixture();
    const token = await f.session("b");
    for (const chat_session of [token, token + "forged"]) {
      expect((await f.post({ action: "poll", chat_session })).status).toBe(401);
    }
    expect(f.reads).toEqual([]);
  });
  it("does not accept an ordinary verified-customer token as a chat capability", async () => {
    const f = fixture();
    expect((await f.post({ action: "poll", chat_session: await f.verifiedCustomer() })).status).toBe(401);
  });
  it("rejects expired visitor capabilities", async () => {
    const f = fixture();
    const expired = await customerSessions.issueCustomerSession({ email: "web-chat:83171313-eceb-49fc-ae6c-d3f6c9dd5ae3", businessId: "a", ttlMs: -1 });
    expect((await f.post({ action: "poll", chat_session: expired.token })).status).toBe(401);
    expect(f.reads).toEqual([]);
  });
  it("preserves session reloads and reads only the signed visitor's replies", async () => {
    const f = fixture();
    const token = await f.session();
    const vid = await chatSessions.verifyWebChatSession(token, "a");
    const other = await chatSessions.verifyWebChatSession(await f.session(), "a");
    for (const [business_id, phone, body] of [["a", "web:" + vid, "Your reply"], ["a", "web:" + other, "Other visitor"], ["a", "27110000000", "Private WhatsApp"], ["b", "web:" + vid, "Other operator"]]) {
      f.rows.chat_messages.push({ business_id, phone, body, direction: "OUT", sender: "Admin", created_at: "2026-09-11T00:00:00Z" });
    }
    const reloaded = await (await f.post({ action: "session", chat_session: token })).json();
    expect(reloaded.chat_session).toBe(token);
    const response = await f.post({ action: "poll", chat_session: token, state: { phone: "27110000000", vid: other } });
    expect((await response.json()).messages.map((message: any) => message.text)).toEqual(["Your reply"]);
  });
  it("ratings use the signed visitor identity even when state names another conversation", async () => {
    const f = fixture();
    const token = await f.session();
    const vid = await chatSessions.verifyWebChatSession(token, "a");
    expect((await f.post({ action: "rate", rating: 4, chat_session: token, state: { phone: "27110000000" } })).status).toBe(200);
    expect(f.writes[0].value).toMatchObject({ business_id: "a", phone: "web:" + vid, rating: 4 });
  });
  it("human handoff remains tenant/visitor scoped without requiring booking verification", async () => {
    const f = fixture();
    const token = await f.session();
    const vid = await chatSessions.verifyWebChatSession(token, "a");
    f.rows.conversations.push({ id: "own-thread", business_id: "a", phone: "web:" + vid, status: "BOT" });
    const response = await f.post({ chat_session: token, message: "btn:human", state: { step: "LOOKUP", phone: "27110000000", conversation_id: "foreign-thread" } });
    expect((await response.json()).state.status).toBe("HUMAN");
    expect(f.writes.find(write => write.table === "conversations").matched.map((row: any) => row.id)).toEqual(["own-thread"]);
    expect(f.writes.find(write => write.table === "chat_messages").value.every((row: any) => row.business_id === "a" && row.phone === "web:" + vid)).toBe(true);
    expect(f.reads).not.toContain("bookings");
    const followup = await f.post({ chat_session: token, message: "Please help", state: { step: "LOOKUP", phone: "27110000000" } });
    expect((await followup.json()).human).toBe(true);
  });
});

describe("web chat catalog and marketing boundaries", () => {
  it("reconfirms gift pricing from the active tenant tour before creating a voucher", async () => {
    const f = fixture();
    f.rows.tours.push({ id: "tour-a", business_id: "a", name: "Operator A tour", base_price_per_person: 300, active: true, hidden: false });
    const response = await f.post({ chat_session: await f.session(), message: "btn:gift_confirm",
      state: { step: "GIFT_CONFIRM", gtid: "tour-a", gtname: "Forged tour", gtprice: 1 } });
    expect((await response.json()).state).toMatchObject({ step: "GIFT_CONFIRM", gtname: "Operator A tour", gtprice: 300 });
    expect(f.writes).toEqual([]);
  });
  it("does not create a gift voucher for another operator's tour", async () => {
    const f = fixture();
    f.rows.tours.push({ id: "tour-b", business_id: "b", name: "Operator B tour", base_price_per_person: 300, active: true, hidden: false });
    const response = await f.post({ chat_session: await f.session(), message: "btn:gift_confirm",
      state: { step: "GIFT_CONFIRM", gtid: "tour-b", gtname: "Operator B tour", gtprice: 300 } });
    expect((await response.json()).state.step).toBe("GIFT_PICK_TOUR");
    expect(f.writes).toEqual([]);
  });
  it("availability never derives operator identity from the supplied tour", async () => {
    const calls: any[] = [];
    const getSlots = sourceFunction("supabase/functions/web-chat/index.ts", "getSlots", {
      db: { rpc: async (...args: any[]) => { calls.push(args); return { data: [] }; } },
    });
    await getSlots("a", "tour-b", new Date());
    expect(calls[0][1]).toMatchObject({ p_business_id: "a", p_tour_id: "tour-b" });
  });
  it("anonymous marketing opt-out cannot use an email wildcard to change customers", async () => {
    const f = fixture();
    f.setIntent("MARKETING_OPTOUT");
    const response = await f.post({ chat_session: await f.session(), email: "%", message: "unsubscribe", state: { step: "QUESTION" } });
    expect((await response.json()).manageBookingsUrl).toContain("/my-bookings");
    expect(f.writes.filter(write => write.table === "customers")).toEqual([]);
  });
  it("marketing opt-out affects only the verified email within its tenant", async () => {
    const f = fixture();
    f.setIntent("MARKETING_OPTOUT");
    f.rows.customers.push(
      { business_id: "a", email: "owner@fixture.invalid", marketing_consent: true },
      { business_id: "a", email: "other@fixture.invalid", marketing_consent: true },
      { business_id: "b", email: "owner@fixture.invalid", marketing_consent: true },
    );
    const response = await f.post({ chat_session: await f.session(), customer_session: await f.verifiedCustomer(), email: "%", message: "unsubscribe", state: { step: "QUESTION" } });
    expect(response.status).toBe(200);
    expect(f.rows.customers.map(row => row.marketing_consent)).toEqual([false, true, true]);
  });
});

describe("web chat booking ownership and guest changes", () => {
  const booking = { id: "booking-a", business_id: "a", email: "owner@fixture.invalid", customer_name: "Owner", phone: "27110000000",
    qty: 2, unit_price: 300, total_amount: 600, status: "PAID", slot_id: "slot-a", tour_id: "tour-a",
    slots: { start_time: new Date(Date.now() + 72 * 3_600_000).toISOString() }, tours: { name: "Operator A tour" } };
  for (const step of ["LOOKUP", "CONFIRM_CANCEL", "UPDATE_NAME", "MODIFY_QTY", "RESCH_DATE", "REVIEW_REQUEST", "RESEND_CONFIRM"]) {
    it(`requires verified customer identity before ${step}`, async () => {
      const f = fixture();
      const response = await f.post({ chat_session: await f.session(), message: "owner@fixture.invalid", state: { step, booking_id: booking.id } });
      expect((await response.json()).manageBookingsUrl).toBe("https://a.booking.fixture.invalid/my-bookings");
      expect(f.reads).not.toContain("bookings");
      expect(f.writes).toEqual([]);
      expect(f.invocations).toEqual([]);
    });
  }
  it("a typed email does not override verified customer ownership", async () => {
    const f = fixture();
    f.rows.bookings.push({ ...booking }, { ...booking, id: "other", email: "other@fixture.invalid" });
    const response = await f.post({ chat_session: await f.session(), customer_session: await f.verifiedCustomer(), message: "other@fixture.invalid", state: { step: "LOOKUP" } });
    expect((await response.json()).state.bookings.map((row: any) => row.id)).toEqual([booking.id]);
  });
  for (const target of [{ ...booking, business_id: "b" }, { ...booking, email: "other@fixture.invalid" }]) {
    it(`rejects a forged booking target ${target.business_id}/${target.email}`, async () => {
      const f = fixture();
      f.rows.bookings.push(target);
      const response = await f.post({ chat_session: await f.session(), customer_session: await f.verifiedCustomer(), message: "New name", state: { step: "UPDATE_NAME", booking_id: target.id } });
      expect(response.status).toBe(403);
      expect(f.writes).toEqual([]);
      expect(f.invocations).toEqual([]);
    });
  }
  it("adds guests through the existing hold/payment workflow without prepayment writes", async () => {
    const f = fixture();
    f.rows.bookings.push({ ...booking });
    const response = await f.post({ chat_session: await f.session(), customer_session: await f.verifiedCustomer(), message: "4",
      state: { step: "MODIFY_QTY", booking_id: booking.id, current_qty: 999, unit_price: 0, slot_id: "foreign-slot", hours_before: 999 } });
    const result = await response.json();
    expect(f.invocations).toEqual([{ name: "rebook-booking", body: { booking_id: booking.id, action: "ADD_GUESTS", new_qty: 4 } }]);
    expect(f.writes).toEqual([]);
    expect(result.paymentUrl).toBe("https://pay.fixture.invalid/add-guests");
    expect(result.reply).toContain("unchanged until payment");
    expect(f.rows.bookings[0].qty).toBe(2);
  });
  it("a failed guest-payment link never claims the quantity has changed", async () => {
    const f = fixture();
    f.rows.bookings.push({ ...booking });
    f.setChangeResult({ ok: true, diff: 600 });
    const result = await (await f.post({ chat_session: await f.session(), customer_session: await f.verifiedCustomer(), message: "4", state: { step: "MODIFY_QTY", booking_id: booking.id } })).json();
    expect(result.reply).toContain("unchanged");
    expect(result.paymentUrl).toBeNull();
    expect(f.writes).toEqual([]);
  });
  it("customer cancellation forwards no client-supplied refund or slot values", async () => {
    const f = fixture();
    f.rows.bookings.push({ ...booking });
    f.setChangeResult({ ok: true, refund_amount: 600 });
    await f.post({ chat_session: await f.session(), customer_session: await f.verifiedCustomer(), message: "yes", state: { step: "CONFIRM_CANCEL", booking_id: booking.id, refund: 999999, slot_id: "foreign-slot", qty: 999 } });
    expect(f.invocations).toEqual([{ name: "rebook-booking", body: { booking_id: booking.id, action: "CANCEL_REFUND" } }]);
    expect(f.writes).toEqual([]);
  });
});

it("the widget sends its active operator and separate chat/customer capabilities", async () => {
  const calls: any[] = [];
  const invoke = sourceFunction("booking/app/components/ChatWidget.tsx", "invokeChat", {
    businessId: "a", chatSession: "signed-chat-a",
    browserChatStorage: { getItem: () => "verified-customer-a" },
    invokeAuthenticatedChat: sourceFunction("booking/app/lib/web-chat-client.ts", "invokeAuthenticatedChat", {}),
    supabase: { functions: { invoke: async (...args: any[]) => { calls.push(args); return { data: {}, error: null }; } } },
  });
  await invoke({ action: "poll", business_id: "forged-b", chat_session: "forged" });
  expect(calls[0][1].body).toEqual({ action: "poll", business_id: "a", chat_session: "signed-chat-a", customer_session: "verified-customer-a" });
});
