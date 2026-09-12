import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";
import * as tokens from "../../supabase/functions/_shared/marketing-tokens";
import * as batch from "../../supabase/functions/_shared/marketing-batch";
import * as emailHtml from "../../supabase/functions/_shared/marketing-email-html";
import * as subscription from "../../supabase/functions/_shared/subscription";
import * as waiver from "../../supabase/functions/_shared/waiver";
import * as duration from "../../supabase/functions/_shared/duration";
import * as voucherBalances from "../../supabase/functions/_shared/voucher-balances";

const serviceKey = "fixture-service-credential-not-real";
const secretKey = "sb_secret_fixture-not-a-real-key";
const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: serviceKey, SUPABASE_SECRET_KEYS: JSON.stringify({ default: secretKey }), RESEND_API_KEY: "fixture-resend", SEND_EMAIL_HOOK_SECRET: "fixture-hook" };
const endpoints = ["send-email", "send-whatsapp-text", "auto-messages", "cron-tasks", "marketing-dispatch", "marketing-automation-dispatch"];
const message = { business_id: "a", to: "fixture-phone", message: "Reminder", type: "MARKETING_TEST", data: { business_id: "a", email: "guest@fixture.invalid", html_content: "<p>Hello</p>" } };

// The real handlers and authentication helper run offline. This tiny query
// double enforces tenant filters; native SQL claims are tested against Postgres.
function fixture() {
  const rows: Record<string, any[]> = {
    admin_users: [
      { user_id: "a", business_id: "a", role: "ADMIN", suspended: false },
      { user_id: "b", business_id: "b", role: "MAIN_ADMIN", suspended: false },
      { user_id: "platform", business_id: "a", role: "SUPER_ADMIN", suspended: false },
      { user_id: "suspended", business_id: "a", role: "SUPER_ADMIN", suspended: true },
      { user_id: "orphan", business_id: null, role: "ADMIN", suspended: false },
    ],
    businesses: ["a", "b"].map(id => ({ id, name: "Operator " + id, business_name: "Operator " + id, subscription_status: "ACTIVE", booking_site_url: "https://" + id + ".fixture.invalid" })),
    bookings: ["a", "b"].map(id => ({ id: "booking-" + id, business_id: id, status: "PAID", customer_name: "Guest " + id, email: "guest-" + id + "@fixture.invalid", phone: "phone-" + id, payment_url: "https://pay.fixture.invalid/" + id, total_amount: 100, qty: 1, tours: { name: "Tour " + id }, slots: { start_time: "2027-01-01T10:00:00Z" } })),
    marketing_campaigns: ["a", "b"].map(id => ({ id: "campaign-" + id, business_id: id, status: "scheduled", scheduled_at: "2020-01-01T00:00:00Z", template_id: "template-" + id, total_recipients: 1, marketing_templates: { business_id: id, html_content: "<html><body>Hello {{first_name}}</body></html>", subject_line: "Hello" } })),
    marketing_contacts: ["a", "b"].map(id => ({ id: "contact-" + id, business_id: id, email: "guest-" + id + "@gmail.com", status: "active", first_name: "Guest " + id })),
    marketing_automations: ["a", "b"].map(id => ({ id: "auto-" + id, business_id: id, status: "active", trigger_type: "manual" })),
    marketing_automation_steps: ["a", "b"].map(id => ({ id: "step-" + id, automation_id: "auto-" + id, position: 0, step_type: "send_email", config: { template_id: "template-" + id } })),
    marketing_templates: ["a", "b"].map(id => ({ id: "template-" + id, business_id: id, html_content: "<html><body>Template " + id + "</body></html>", subject_line: "Hello" })),
  };
  const writes: Array<{ table: string; value: any }> = [];
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const emails: any[] = [];
  const whatsapp: any[] = [];
  let claimError = false;
  const db = {
    auth: { getUser: async (token: string) => ({ data: { user: token === "anon" ? null : { id: token } }, error: null }) },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      queries.push({ table, filters });
      const predicates: Array<(row: any) => boolean> = [];
      let value: any, action = "select", single = false, start = 0, end = Infinity;
      const execute = async () => {
        let data = (rows[table] || []).filter(row => predicates.every(p => p(row))).slice(start, end);
        if (action === "insert" || action === "upsert") {
          data = (Array.isArray(value) ? value : [value]).map(v => ({ id: "inserted-" + table, ...v }));
          (rows[table] ||= []).push(...data);
          writes.push({ table, value });
        } else if (action === "update" || action === "delete") {
          if (data.length) writes.push({ table, value });
          if (action === "update") data.forEach(row => Object.assign(row, value));
        }
        return { data: single ? data[0] || null : data, error: null, count: data.length };
      };
      const q: any = {
        select: () => q, order: () => q,
        eq: (key: string, val: unknown) => { filters.push([key, val]); predicates.push(row => row[key] === val); return q; },
        neq: (key: string, val: unknown) => { predicates.push(row => row[key] !== val); return q; },
        in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return q; },
        lt: (key: string, val: any) => { predicates.push(row => row[key] < val); return q; },
        lte: (key: string, val: any) => { predicates.push(row => row[key] <= val); return q; },
        gt: (key: string, val: any) => { predicates.push(row => row[key] > val); return q; },
        not: (key: string, _op: string, val: unknown) => { predicates.push(row => row[key] != val); return q; },
        is: (key: string, val: unknown) => { predicates.push(row => row[key] == val); return q; },
        or: () => q,
        range: (from: number, to: number) => { start = from; end = to + 1; return q; },
        limit: (n: number) => { end = n; return q; },
        update: (patch: any) => { action = "update"; value = patch; return q; },
        insert: (patch: any) => { action = "insert"; value = patch; return q; },
        upsert: (patch: any) => { action = "upsert"; value = patch; return q; },
        delete: () => { action = "delete"; return q; },
        single: () => { single = true; return execute(); },
        maybeSingle: () => { single = true; return execute(); },
        then: (resolve: any, reject: any) => execute().then(resolve, reject),
      };
      return q;
    },
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      const table = name === "claim_marketing_queue" ? "marketing_queue" : name === "claim_marketing_automation_enrollments" ? "marketing_automation_enrollments" : "";
      return { data: table ? (rows[table] || []).filter(row => !args.p_business_id || row.business_id === args.p_business_id) : null, error: table && claimError ? { message: "fixture unavailable" } : null };
    },
    functions: { invoke: async (name: string, body: any) => { emails.push({ name, ...body }); return { data: { ok: true }, error: null }; } },
  };
  const auth = sourceExports("supabase/functions/_shared/auth.ts", { "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db } }, env);
  const tenant = {
    createServiceClient: () => db,
    getAdminAppOrigins: () => ["https://admin.fixture.invalid"],
    isAllowedOrigin: (origin: string, allowed: string[]) => allowed.includes(origin),
    getTenantByBusinessId: async (_db: unknown, id: string) => ({ business: rows.businesses.find(row => row.id === id) }),
    sendWhatsappTextForTenant: async (...args: any[]) => { whatsapp.push(args); return { channel: "template" }; },
    getBusinessDisplayName: (business: any) => business.business_name,
    formatTenantDate: (_business: any, value: string) => value,
    formatTenantDateTime: (_business: any, value: string) => value,
    resolveManageBookingsUrl: (business: any) => business.booking_site_url + "/my-bookings",
    fetchAllRows: async (build: any) => {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await build(from, from + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) return all;
      }
    },
  };
  const fetchMock = vi.fn(async (_url: any, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    emails.push(body);
    return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: "sent-" + i })) } : { id: "sent", ok: true });
  });
  const invoke = (name: string, body: any = message, token = "a", method = "POST", headers: Record<string, string> = {}) => {
    const handler = sourceHandler("supabase/functions/" + name + "/index.ts", {
      "../_shared/auth.ts": auth, "../_shared/tenant.ts": tenant,
      "../_shared/sentry.ts": { withSentry: (_name: string, fn: unknown) => fn },
      "../_shared/subscription.ts": subscription, "../_shared/marketing-tokens.ts": tokens,
      "../_shared/marketing-batch.ts": batch, "../_shared/marketing-email-html.ts": emailHtml,
      "../_shared/waiver.ts": waiver, "../_shared/duration.ts": duration,
      "../_shared/voucher-balances.ts": voucherBalances,
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
      "https://esm.sh/pdf-lib@1.17.1": {},
      "npm:standardwebhooks": { Webhook: class { verify(_body: string, hookHeaders: any) { if (hookHeaders["webhook-signature"] !== "fixture-valid-signature") throw new Error("Invalid signature"); } } },
    }, env, fetchMock);
    return handler(new Request("https://fixture.invalid/" + name, { method, headers: { ...(token ? { authorization: "Bearer " + token } : {}), origin: "https://admin.fixture.invalid", ...headers }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
  };
  return { rows, writes, queries, rpcCalls, emails, whatsapp, invoke, failClaims: () => { claimError = true; } };
}

describe("R08 authenticated message/job entry points", () => {
  for (const name of endpoints.filter(name => name !== "send-email")) {
    it(`${name} accepts the project's configured secret API key`, async () => {
      const f = fixture();
      expect((await f.invoke(name, message, "", "POST", { apikey: secretKey })).status).toBe(200);
    });
  }
  for (const headers of [{ authorization: "Bearer " + secretKey }, { apikey: secretKey }, { apikey: serviceKey }]) {
    it(`accepts configured server keys for reset emails via ${Object.keys(headers)[0]}`, async () => {
      const f = fixture();
      const res = await f.invoke("send-email", { type: "ADMIN_WELCOME", data: { email: "staff@fixture.invalid", business_id: "a", reason: "RESET", change_password_url: "https://admin.fixture.invalid/change-password?token=fixture" } }, "", "POST", headers);
      expect(res.status).toBe(200);
      expect(f.emails).toHaveLength(1);
    });
  }
  it("does not accept an unconfigured API key for reset emails", async () => {
    const f = fixture();
    const res = await f.invoke("send-email", message, "", "POST", { apikey: "sb_secret_unconfigured" });
    expect(res.status).toBe(401);
    expect(f.emails).toEqual([]);
  });
  for (const name of endpoints) {
    for (const token of ["", "anon", "customer", "suspended", "orphan"]) {
      it(`${name} rejects ${token || "missing"} authorization without sending or writing`, async () => {
        const f = fixture();
        expect((await f.invoke(name, message, token)).status).toBe(401);
        expect(f.writes).toEqual([]); expect(f.rpcCalls).toEqual([]);
        expect(f.emails).toEqual([]); expect(f.whatsapp).toEqual([]);
      });
    }
  }
  for (const name of endpoints.filter(name => name !== "cron-tasks")) {
    it(`${name} keeps authenticated browser preflight working`, async () => {
      const f = fixture();
      const response = await f.invoke(name, {}, "", "OPTIONS");
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://admin.fixture.invalid");
      expect(f.writes).toEqual([]);
    });
  }
  it("ordinary and platform admins cannot invoke the global cleanup sweep", async () => {
    for (const token of ["a", "platform"]) {
      const f = fixture();
      expect((await f.invoke("cron-tasks", {}, token)).status).toBe(403);
      expect(f.writes).toEqual([]); expect(f.emails).toEqual([]);
    }
  });
  it("the service scheduler retains access to the cleanup sweep", async () => {
    const f = fixture();
    for (const key of Object.keys(f.rows)) f.rows[key] = [];
    expect((await f.invoke("cron-tasks", {}, serviceKey)).status).toBe(200);
    expect(f.rpcCalls.some(call => call.name === "apply_last_minute_deals")).toBe(true);
  });
});

describe("R08 message tenant boundaries and legitimate user flows", () => {
  for (const name of ["send-email", "send-whatsapp-text"]) {
    it(`${name} rejects a foreign business`, async () => {
      const f = fixture();
      const body = { ...message, business_id: "b", data: { ...message.data, business_id: "b" } };
      expect((await f.invoke(name, body)).status).toBe(403);
      expect(f.emails).toEqual([]); expect(f.whatsapp).toEqual([]);
    });
    it(`${name} rejects a foreign booking disguised with the caller's business`, async () => {
      const f = fixture();
      const body = { ...message, booking_id: "booking-b", data: { ...message.data, booking_id: "booking-b" } };
      expect((await f.invoke(name, body)).status).toBe(403);
      expect(f.emails).toEqual([]); expect(f.whatsapp).toEqual([]);
    });
  }
  for (const token of ["a", "platform", serviceKey]) {
    it(`keeps authorized WhatsApp sends and template fallback for ${token}`, async () => {
      const f = fixture();
      const response = await f.invoke("send-whatsapp-text", message, token);
      expect(await response.json()).toMatchObject({ ok: true, channel: "template" });
      expect(f.whatsapp[0][0].business.id).toBe("a");
    });
  }
  it("keeps marketing previews branded for the caller's business", async () => {
    const f = fixture();
    expect((await f.invoke("send-email")).status).toBe(200);
    expect(f.emails[0].from).toBe("Operator a <noreply@bookingtours.co.za>");
    expect(f.emails[0].to).toEqual([message.data.email]);
  });
  it("keeps ordinary booking-update emails", async () => {
    const f = fixture();
    expect((await f.invoke("send-email", { type: "BOOKING_UPDATED", data: { ...message.data, booking_id: "booking-a", ref: "A", tour_name: "Tour a" } })).status).toBe(200);
    expect(f.emails).toHaveLength(1);
  });
  it("prevents admins forging authentication or platform-billing messages", async () => {
    for (const type of ["ADMIN_WELCOME", "MY_BOOKINGS_OTP", "MAGIC_LINK", "PLATFORM_INVOICE_OUTSTANDING", "POPIA_EXPORT_READY"]) {
      const f = fixture();
      expect((await f.invoke("send-email", { type, data: message.data })).status).toBe(403);
      expect(f.emails).toEqual([]);
    }
  });
  it("preserves signed Auth hooks and rejects unsigned hook-shaped requests", async () => {
    const f = fixture();
    const body = { user: { email: "customer@fixture.invalid" }, email_data: { email_action_type: "magiclink", token_hash: "fixture-hash", site_url: "https://fixture.invalid" } };
    expect((await f.invoke("send-email", body, "")).status).toBe(401);
    expect(f.emails).toEqual([]);
    expect((await f.invoke("send-email", body, "", "POST", { "webhook-signature": "fixture-valid-signature" })).status).toBe(200);
    expect(f.emails).toHaveLength(1);
  });
  it("manual payment reminders stay scoped to the authenticated operator", async () => {
    const f = fixture();
    expect((await f.invoke("auto-messages", { action: "payment_reminder_one", booking_id: "booking-b", business_id: "b" })).status).toBe(400);
    expect(f.emails).toEqual([]); expect(f.whatsapp).toEqual([]);
    expect((await f.invoke("auto-messages", { action: "payment_reminder_one", booking_id: "booking-a" })).status).toBe(200);
    expect(f.whatsapp[0][0].business.id).toBe("a");
    expect(f.emails[0].data.business_id).toBe("a");
  });
  it("voucher-only checkout still sends stored balance and confirmation emails server-side", async () => {
    const f = fixture();
    Object.assign(f.rows.bookings[0], { total_amount: 0, voucher_amount_paid: 100, waiver_token: "independent-proof" });
    const voucher = { business_id: "a", code: "SAFE", value: 1000, current_balance: 300 };
    f.rows.voucher_reservations = [
      { business_id: "a", booking_id: "booking-a", status: "settled", amount: 100, vouchers: voucher },
      { business_id: "a", booking_id: "older-booking", status: "settled", amount: 600, vouchers: voucher },
      { business_id: "b", booking_id: "booking-a", status: "settled", amount: 100, vouchers: { business_id: "b", code: "FOREIGN", current_balance: 400 } },
    ];
    expect((await f.invoke("confirm-booking", { booking_id: "booking-a", booking_token: "independent-proof", email: "attacker@fixture.invalid", remaining_balance: 999 }, "", "POST", { "x-tenant-business-id": "a" })).status).toBe(200);
    expect(f.emails).toHaveLength(2);
    expect(f.emails[0].body).toMatchObject({ type: "VOUCHER_BALANCE", data: { email: "guest-a@fixture.invalid", voucher_code: "SAFE", remaining_balance: 300, amount_used: 100 } });
    expect(f.emails[1].body.type).toBe("BOOKING_CONFIRM");
  });

  it("does not send confirmations using a reference, wrong proof or another operator's header", async () => {
    const f = fixture();
    f.rows.bookings[0].waiver_token = "independent-proof";
    for (const [proof, business] of [["", "a"], ["booking-a", "a"], ["independent-proof", "b"]]) {
      expect((await f.invoke("confirm-booking", { booking_id: "booking-a", booking_token: proof }, "", "POST", { "x-tenant-business-id": business })).status).toBe(403);
    }
    expect(f.emails).toEqual([]); expect(f.whatsapp).toEqual([]); expect(f.writes).toEqual([]);
  });

  it("preserves the operator's chosen location phrase in the delivered photo email", async () => {
    const f = fixture();
    Object.assign(f.rows.businesses[0], { activity_verb_past: "paddling", location_phrase: "on the water" });
    expect((await f.invoke("send-email", { type: "TRIP_PHOTOS", data: { business_id: "a", email: "guest@fixture.invalid", customer_name: "Guest", photo_urls: ["https://photos.fixture.invalid/one?a=1&b=2", "https://photos.fixture.invalid/two"] } })).status).toBe(200);
    expect(f.emails[0].html).toContain("We hope you had an incredible time on the water");
    expect(f.emails[0].html).toContain('href="https://photos.fixture.invalid/one?a=1&amp;b=2"');
    expect(f.emails[0].html).toContain('href="https://photos.fixture.invalid/two"');
  });
});

describe("R08/R09/R17 marketing dispatch boundaries", () => {
  for (const endpoint of ["marketing-dispatch", "marketing-automation-dispatch"]) {
    it(`${endpoint} derives claim scope from the caller, not the body`, async () => {
      const f = fixture();
      expect((await f.invoke(endpoint, { business_id: "b" })).status).toBe(200);
      expect(f.rpcCalls.find(call => call.name.startsWith("claim_marketing_"))?.args.p_business_id).toBe("a");
      if (endpoint === "marketing-dispatch") expect(f.rows.marketing_campaigns[1].status).toBe("scheduled");
    });
    it(`${endpoint} keeps service-wide scheduled dispatch`, async () => {
      const f = fixture();
      expect((await f.invoke(endpoint, {}, serviceKey)).status).toBe(200);
      expect(f.rpcCalls.find(call => call.name.startsWith("claim_marketing_"))?.args.p_business_id).toBeNull();
    });
    it(`${endpoint} does not fall back to unsafe work if the database claim fails`, async () => {
      const f = fixture(); f.failClaims();
      expect((await f.invoke(endpoint)).status).toBe(500);
      expect(f.emails).toEqual([]);
      expect(f.queries.some(q => q.table === "marketing_queue")).toBe(false);
    });
  }
  for (const mismatch of ["none", "campaign", "template", "contact", "unsubscribed"]) {
    it(`campaign dispatch handles ${mismatch} relationships without cross-tenant sends`, async () => {
      const f = fixture();
      f.rows.marketing_queue = [{ id: "queue-a", business_id: "a", campaign_id: mismatch === "campaign" ? "campaign-b" : "campaign-a", contact_id: mismatch === "contact" ? "contact-b" : "contact-a", email: "guest@gmail.com", first_name: "Guest" }];
      if (mismatch === "template") f.rows.marketing_campaigns[0].marketing_templates.business_id = "b";
      if (mismatch === "unsubscribed") f.rows.marketing_contacts[0].status = "unsubscribed";
      expect((await f.invoke("marketing-dispatch")).status).toBe(200);
      expect(f.emails).toHaveLength(mismatch === "none" ? 1 : 0);
      expect(f.rpcCalls.some(call => call.name === "increment_campaign_counter" && call.args.p_campaign_id === "campaign-b")).toBe(false);
    });
  }
  for (const mismatch of ["none", "automation", "template", "contact", "unsubscribed"]) {
    it(`automation dispatch handles ${mismatch} relationships without cross-tenant sends`, async () => {
      const f = fixture();
      f.rows.marketing_automation_enrollments = [{ id: "enrollment-a", business_id: "a", automation_id: mismatch === "automation" ? "auto-b" : "auto-a", contact_id: mismatch === "contact" ? "contact-b" : "contact-a", current_step: 0 }];
      if (mismatch === "template") f.rows.marketing_automation_steps[0].config.template_id = "template-b";
      if (mismatch === "unsubscribed") f.rows.marketing_contacts[0].status = "unsubscribed";
      expect((await f.invoke("marketing-automation-dispatch")).status).toBe(200);
      expect(f.emails).toHaveLength(mismatch === "none" ? 1 : 0);
    });
  }
  it("checks trading status for all 2,000 operators without truncation", async () => {
    const f = fixture();
    f.rows.businesses = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), subscription_status: "ACTIVE" }));
    expect((await subscription.nonTradingBusinessIds({ from: (table: string) => ({ select: () => ({ in: async (_key: string, ids: string[]) => {
      expect(ids.length).toBeLessThanOrEqual(500);
      return { data: f.rows[table].filter(row => ids.includes(row.id)), error: null };
    } }) }) }, f.rows.businesses.map(row => row.id))).size).toBe(0);
  });
});
