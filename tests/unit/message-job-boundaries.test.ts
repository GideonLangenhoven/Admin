import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";
import * as delivery from "../../supabase/functions/_shared/marketing-delivery";
import * as calendar from "../../supabase/functions/_shared/marketing-calendar";
import * as tokens from "../../supabase/functions/_shared/marketing-tokens";
import * as batch from "../../supabase/functions/_shared/marketing-batch";
import * as emailHtml from "../../supabase/functions/_shared/marketing-email-html";
import * as subscription from "../../supabase/functions/_shared/subscription";
import * as waiver from "../../supabase/functions/_shared/waiver";
import * as giftVoucherFace from "../../supabase/functions/_shared/gift-voucher-face";
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
    marketing_contacts: ["a", "b"].map(id => ({ id: "contact-" + id, business_id: id, email: "guest-" + id + "@gmail.com", status: "active", verifiedMarketingEvidence: true, first_name: "Guest " + id })),
    marketing_automations: ["a", "b"].map(id => ({ id: "auto-" + id, business_id: id, status: "active", trigger_type: "manual", businesses: { timezone: "Africa/Johannesburg" } })),
    marketing_automation_steps: ["a", "b"].map(id => ({ id: "step-" + id, automation_id: "auto-" + id, position: 0, step_type: "send_email", config: { template_id: "template-" + id } })),
    marketing_templates: ["a", "b"].map(id => ({ id: "template-" + id, business_id: id, html_content: "<html><body>Template " + id + "</body></html>", subject_line: "Hello" })),
  };
  const writes: Array<{ table: string; value: any }> = [];
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const emails: any[] = [];
  const voucherImages: any[] = [];
  const whatsapp: any[] = [];
  let claimError = false;
  let recoveryResult: any = { ok: true };
  let emailResult: any = { ok: true };
  let customerHistory: any = { last_booking_at: null };
  let welcomeEligible = true;
  let promoFailure = false;
  let voucherImageFailure = false;
  const db = {
    auth: { getUser: async (token: string) => ({ data: { user: token === "anon" ? null : { id: token } }, error: null }) },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      queries.push({ table, filters });
      const predicates: Array<(row: any) => boolean> = [];
      let value: any, action = "select", single = false, start = 0, end = Infinity;
      const execute = async () => {
        let data = (rows[table] || []).filter(row => predicates.every(p => p(row))).slice(start, end);
        if (table === "promotions" && action === "insert" && promoFailure) return { data: null, error: { message: "Fixture promo rejected" }, count: 0 };
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
      // These fixtures explicitly represent verified evidence/approved limits.
      // Unknown/suppressed/ambiguous outcomes are covered by marketing-dispatch-safety.
      if (name === "marketing_eligibility" || name === "marketing_step_eligibility") {
        const c = rows.marketing_contacts.find(c => c.id === args.p_contact_id && c.business_id === args.p_business_id);
        return { data: c?.verifiedMarketingEvidence && c.status === "active" ? "eligible" : "permission_unknown", error: null };
      }
      if (name === "confirm_marketing_delivery") return { data: "eligible", error: null };
      if (name === "marketing_offer_allowed") return { data: true, error: null };
      if (name === "reserve_marketing_delivery") {
        const existing = (rows.marketing_deliveries || []).find(d => d.delivery_key === args.p_key);
        if (existing) return { data: { reason: "delivery_" + existing.status, id: existing.id }, error: null };
        const item = { id: "delivery-" + (rows.marketing_deliveries || []).length, business_id: args.p_business_id, contact_id: args.p_contact_id, delivery_key: args.p_key, status: "sending" };
        (rows.marketing_deliveries ||= []).push(item);
        return { data: { reason: "reserved", id: item.id }, error: null };
      }
      if (name === "customer_booking_history") return { data: customerHistory, error: null };
      if (name === "validate_welcome_back_enrollment") return { data: welcomeEligible, error: null };
      if (name === "prepare_payment_recovery") return { data: recoveryResult, error: null };
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
    if (String(_url).endsWith("/api/internal/voucher-image")) {
      voucherImages.push(body);
      if (voucherImageFailure) return Response.json({ error: "Renderer unavailable" }, { status: 503 });
      return new Response(new Uint8Array([137,80,78,71,13,10,26,10]), { headers: { "Content-Type": "image/png" } });
    }
    emails.push(body);
    if (body.type === "PAYMENT_FAILED") return Response.json(emailResult, { status: emailResult.ok ? 200 : 502 });
    return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: "sent-" + i })) } : { id: "sent", ok: true });
  });
  const invoke = (name: string, body: any = message, token = "a", method = "POST", headers: Record<string, string> = {}) => {
    const handler = sourceHandler("supabase/functions/" + name + "/index.ts", {
      "../_shared/auth.ts": auth, "../_shared/tenant.ts": tenant,
      "../_shared/sentry.ts": { withSentry: (_name: string, fn: unknown) => fn, captureCheckIn: vi.fn(async () => "fixture-checkin") },
      "../_shared/subscription.ts": subscription, "../_shared/marketing-tokens.ts": tokens,
      "../_shared/marketing-delivery.ts": delivery, "../_shared/marketing-calendar.ts": calendar,
      "../_shared/marketing-batch.ts": batch, "../_shared/marketing-email-html.ts": emailHtml,
      "../_shared/gift-voucher-face.ts": giftVoucherFace, "../_shared/waiver.ts": waiver, "../_shared/duration.ts": duration,
      "../_shared/voucher-balances.ts": voucherBalances,
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
      "https://esm.sh/pdf-lib@1.17.1": {},
      "npm:standardwebhooks": { Webhook: class { verify(_body: string, hookHeaders: any) { if (hookHeaders["webhook-signature"] !== "fixture-valid-signature") throw new Error("Invalid signature"); } } },
    }, env, fetchMock);
    return handler(new Request("https://fixture.invalid/" + name, { method, headers: { ...(token ? { authorization: "Bearer " + token } : {}), origin: "https://admin.fixture.invalid", ...headers }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
  };
  return { rows, writes, queries, rpcCalls, emails, voucherImages, whatsapp, invoke, failClaims: () => { claimError = true; }, recovery: (value: any) => { recoveryResult = value; }, emailResponse: (value: any) => { emailResult = value; }, customerHistory: (value: any) => { customerHistory = value; }, welcomeEligible: (value: boolean) => { welcomeEligible = value; }, failPromos: () => { promoFailure = true; }, failVoucherImage: () => { voucherImageFailure = true; } };
}

describe("R08 authenticated message/job entry points", () => {
  it("reports a voucher attachment failure instead of sending an email that promises a missing file", async () => {
    const f = fixture();
    f.failVoucherImage();
    const response = await f.invoke("send-email", { type: "GIFT_VOUCHER", data: {
      business_id: "a", email: "buyer@fixture.invalid", recipient_name: "Alex", buyer_name: "Sam", code: "GIFT2345", value: 750,
    } }, serviceKey);
    expect(response.status).toBe(503);
    expect(f.emails).toHaveLength(0);
  });

  it.each(["buyer_receipt", "buyer_forward", "recipient"])("sends a standalone voucher PNG and appropriate %s copy from the voucher sender", async mode => {
    const f = fixture();
    Object.assign(f.rows.businesses[0], { notification_email: "help@fixture.invalid", social_facebook: "https://facebook.com/operator", logo_url: "https://fixture.invalid/storage/v1/object/public/email-images/logo.png" });
    const response = await f.invoke("send-email", { type: "GIFT_VOUCHER", data: {
      business_id: "a", email: "buyer@fixture.invalid", gift_recipient_mode: mode,
      recipient_name: "Alex", buyer_name: "Sam", gift_message: "Enjoy <every> moment & smile!",
      code: "GIFT2345", value: 750, voucher_type: "MONETARY", gift_tour_name: "Sunset paddle",
      gift_image_url: "https://fixture.invalid/storage/v1/object/public/email-images/photo.webp", expires_at: "18 October 2029",
    } }, serviceKey);
    expect(response.status).toBe(200);
    const email = f.emails[0];
    expect(email.from).toBe("Operator a <vouchers@bookingtours.co.za>");
    expect(email.reply_to).toBe("help@fixture.invalid");
    expect(email.attachments).toEqual([{ filename: "Voucher-GIFT2345.png", content: "iVBORw0KGgo=" }]);
    expect(f.voucherImages[0]).toMatchObject({ recipientName: "Alex", buyerName: "Sam", message: "Enjoy <every> moment & smile!", value: "750", code: "GIFT2345", monetary: true });
    expect(f.voucherImages[0].logoUrl).toBe(f.rows.businesses[0].logo_url);
    expect(email.html).toContain("data-gift-voucher-face");
    expect(email.html).toContain("Enjoy &lt;every&gt; moment &amp; smile!");
    expect(email.html).toContain("Save or share the image on its own");
    expect(email.html).not.toContain("facebook.com/operator");
    expect(email.html).not.toContain("spam / promotions");
    expect(email.headers?.["List-Unsubscribe"]).toBeUndefined();
    if (mode === "recipient") {
      expect(email.subject).toContain("you've received a gift");
      expect(email.html).toContain("Redeem Your Gift");
    } else {
      expect(email.subject).toBe("Operator a — Gift voucher purchase confirmed");
      expect(email.html).toContain("Purchase confirmed");
      expect(email.html).not.toContain("View Booking Site");
      expect(email.html).not.toContain("Redeem Your Gift");
      expect(email.html).not.toContain("🎁");
    }
  });

  it.each(["SIGNED", "PENDING"])("queues a confirmation, then renders the current %s waiver status at delivery", async waiverStatus => {
    const f = fixture();
    Object.assign(f.rows.bookings[0], { waiver_status: "PENDING", waiver_token: "waiver-token" });
    const before = Date.now();
    const response = await f.invoke("send-email", { type: "BOOKING_CONFIRM", data: {
      business_id: "a", booking_id: "booking-a", email: "guest-a@fixture.invalid",
      customer_name: "Guest & Friend", tour_name: "Morning Kayak", ref: "70776283", qty: 2,
      waiver_status: "PENDING", waiver_token: "stale-token", waiver_url: "https://stale.fixture.invalid",
    } }, serviceKey);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, queued: true });
    expect(f.emails).toHaveLength(0);
    const job = f.rows.notification_jobs[0];
    expect(Date.parse(job.next_attempt_at)).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    expect(Date.parse(job.next_attempt_at)).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
    expect(job.payload.customer_name).toBe("Guest & Friend");

    f.rows.bookings[0].waiver_status = waiverStatus;
    const delivered = await f.invoke("send-email", { type: job.template_type, data: {
      ...job.payload, email: job.recipient, delivery_idempotency_key: job.dedupe_key,
    } }, serviceKey);
    expect(delivered.status).toBe(200);
    expect(f.rows.notification_jobs).toHaveLength(1);
    expect(f.emails).toHaveLength(1);
    const html = f.emails[0].html;
    expect(html).toContain("Booking Confirmed");
    expect(html).toContain("Guest &amp; Friend");
    expect(html).not.toContain("Completed for this booking");
    if (waiverStatus === "SIGNED") {
      expect(html).not.toContain("Complete your waiver");
      expect(html).not.toContain("Sign waiver");
      expect(html).not.toContain("Action required");
    } else {
      expect(html).toContain("Complete your waiver");
      expect(html).toContain("https://a.fixture.invalid/waiver?booking=booking-a&token=waiver-token");
      expect(html).not.toContain("https://stale.fixture.invalid");
    }
  });

  it("does not send a queued confirmation if the booking was cancelled or removed", async () => {
    for (const status of ["CANCELLED", "EXPIRED", "DELETED"]) {
      const f = fixture();
      f.rows.bookings[0].status = status;
      if (status === "DELETED") f.rows.bookings = [];
      const response = await f.invoke("send-email", { type: "BOOKING_CONFIRM", data: {
        business_id: "a", booking_id: "booking-a", email: "guest-a@fixture.invalid",
        waiver_status: "SIGNED", delivery_idempotency_key: "booking-confirmation/booking-a",
      } }, serviceKey);
      expect(response.status).toBe(status === "DELETED" ? 503 : 409);
      expect(f.emails).toHaveLength(0);
    }
  });

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
  it("recovery email cannot cross operators, including a forged business selector", async () => {
    const f = fixture();
    for (const business_id of ["a", "b"]) {
      const response = await f.invoke("auto-messages", { action: "payment_recovery_email", booking_id: "booking-b", business_id });
      expect(response.status).toBe(400);
    }
    expect(f.emails).toEqual([]);
    expect(f.writes).toEqual([]);
  });
  it("emails the stored Yoco link and saves sent time only after provider acceptance", async () => {
    const f = fixture();
    f.rows.bookings[0].status = "PENDING PAYMENT";
    f.rows.bookings[0].payment_failed_at = "2026-10-16T07:00:00Z";
    f.emailResponse({ ok: false });
    const body = { action: "payment_recovery_email", booking_id: "booking-a", business_id: "a", email: "attacker@fixture.invalid", payment_url: "https://wrong.invalid" };
    expect((await f.invoke("auto-messages", body)).status).toBe(400);
    expect(f.writes).toEqual([]);
    f.emailResponse({ ok: true });
    expect((await f.invoke("auto-messages", body)).status).toBe(200);
    expect(f.emails[1]).toMatchObject({ type: "PAYMENT_FAILED", data: { business_id: "a", booking_id: "booking-a", email: "guest-a@fixture.invalid", payment_url: "https://pay.fixture.invalid/a" } });
    expect(f.rows.bookings[0].payment_recovery_emailed_at).toBeTruthy();
    expect(f.whatsapp).toEqual([]);
  });
  it("does not contact email when reservation checks fail or payment has completed", async () => {
    const f = fixture();
    const body = { action: "payment_recovery_email", booking_id: "booking-a", business_id: "a" };
    f.recovery({ ok: false, error: "No capacity" });
    expect((await f.invoke("auto-messages", body)).status).toBe(400);
    f.recovery({ ok: true });
    expect((await f.invoke("auto-messages", body)).status).toBe(400);
    expect(f.emails).toEqual([]);
  });
  it.each(["PENDING", "HELD", "CONFIRMED"])("emails a %s booking without inventing a failed payment", async status => {
    const f = fixture();
    Object.assign(f.rows.bookings[0], { status, total_captured: 0, payment_failed_at: null });
    expect((await f.invoke("auto-messages", { action: "payment_recovery_email", booking_id: "booking-a", business_id: "a" })).status).toBe(200);
    expect(f.emails[0]).toMatchObject({ type: "PAYMENT_LINK", data: { booking_id: "booking-a", payment_url: "https://pay.fixture.invalid/a" } });
  });
  it("does not resend a full-amount link after part payment", async () => {
    const f = fixture();
    Object.assign(f.rows.bookings[0], { status: "CONFIRMED", total_captured: 20 });
    expect((await f.invoke("auto-messages", { action: "payment_recovery_email", booking_id: "booking-a", business_id: "a" })).status).toBe(400);
    expect(f.emails).toEqual([]);
  });
  it("renders the recovery email with rejection copy, tenant branding and Yoco link", async () => {
    const f = fixture();
    const response = await f.invoke("send-email", { type: "PAYMENT_FAILED", data: { business_id: "a", booking_id: "booking-a", email: "guest-a@fixture.invalid", customer_name: "Guest", ref: "BOOKING-A", tour_name: "Kayaking", tour_date: "Tomorrow", qty: 1, total_amount: "100.00", payment_url: "https://checkout.yoco.com/fixture" } });
    expect(response.status).toBe(200);
    expect(f.emails[0].html).toContain("payment was rejected or could not be completed");
    expect(f.emails[0].html).toContain('href="https://checkout.yoco.com/fixture"');
    expect(f.emails[0].html).toContain("Operator a");
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

  it.each([true, false])("welcomes previous customers in confirmation email only when history confirms a previous booking: %s", async returning => {
    const f = fixture();
    f.customerHistory({ last_booking_at: returning ? "2026-01-01T10:00:00Z" : null });
    f.rows.bookings[0].created_at = "2026-10-15T10:00:00Z";
    const response = await f.invoke("send-email", { type: "BOOKING_CONFIRM", data: { business_id: "a", booking_id: "booking-a", email: "guest-a@fixture.invalid", customer_name: "Guest", tour_name: "Kayaking", ref: "BOOKING-A", total_amount: "100.00", qty: 1, returning_customer: !returning } });
    expect(response.status).toBe(200);
    expect(f.emails[0].html.includes("Welcome back, Guest.")).toBe(returning);
    expect(f.rpcCalls.find(call => call.name === "customer_booking_history")?.args).toMatchObject({ p_business_id: "a", p_exclude_booking_id: "booking-a", p_before: "2026-10-15T10:00:00Z" });
  });
  it.each([[0,100],[25,75],[100,0]])("confirmation uses captured %s and due %s from the stored booking, never the caller's paid claim",async(captured,due)=>{
    const f=fixture();Object.assign(f.rows.bookings[0],{status:"CONFIRMED",total_amount:100,total_captured:captured});
    const response=await f.invoke("send-email",{type:"BOOKING_CONFIRM",data:{business_id:"a",booking_id:"booking-a",email:"guest-a@fixture.invalid",customer_name:"Guest",tour_name:"Kayaking",ref:"BOOKING-A",total_amount:999,amount_paid:999,qty:1}});
    expect(response.status).toBe(200);expect(f.emails).toHaveLength(1);
    expect(f.emails[0].html).toMatch(new RegExp("Payment received:[\\s\\S]*?R"+captured.toFixed(2)));
    expect(f.emails[0].html).toMatch(new RegExp("Balance due:[\\s\\S]*?R"+due.toFixed(2)));
    expect(f.emails[0].html).not.toContain("R999");
  });
  it("holds a confirmation when the stored payment state is unavailable",async()=>{
    const f=fixture();delete f.rows.bookings[0].status;
    const response=await f.invoke("send-email",{type:"BOOKING_CONFIRM",data:{business_id:"a",booking_id:"booking-a",email:"guest-a@fixture.invalid",customer_name:"Guest",tour_name:"Kayaking",ref:"BOOKING-A",total_amount:100,qty:1}});
    expect(response.status).toBe(503);expect(f.emails).toEqual([]);
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
      f.rows.marketing_queue = [{ id: "queue-a", business_id: "a", campaign_id: mismatch === "campaign" ? "campaign-b" : "campaign-a", contact_id: mismatch === "contact" ? "contact-b" : "contact-a", email: "guest-a@gmail.com", first_name: "Guest" }];
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
  it.each([true, false])("checks welcome-back eligibility before delivering each email: %s", async eligible => {
    const f = fixture();
    f.rows.marketing_automations[0].trigger_type = "booking_inactive";
    f.rows.marketing_automation_enrollments = [{ id: "enrollment-a", business_id: "a", automation_id: "auto-a", contact_id: "contact-a", current_step: 0 }];
    f.welcomeEligible(eligible);
    expect((await f.invoke("marketing-automation-dispatch", { business_id: "b" })).status).toBe(200);
    expect(f.rpcCalls.find(call => call.name === "enroll_welcome_back_sequences")?.args.p_business_id).toBe("a");
    expect(f.rpcCalls.find(call => call.name === "validate_welcome_back_enrollment")?.args).toEqual({ p_enrollment_id: "enrollment-a", p_business_id: "a" });
    expect(f.emails).toHaveLength(eligible ? 1 : 0);
    expect(f.whatsapp).toEqual([]);
  });
  it.each([false, true])("welcome-back promo creation advances only after a valid percentage promo exists: failure=%s", async fails => {
    const f = fixture();
    f.rows.marketing_automations[0].trigger_type = "booking_inactive";
    f.rows.marketing_automation_enrollments = [{ id: "enrollment-a", business_id: "a", automation_id: "auto-a", contact_id: "contact-a", current_step: 0, metadata: { last_booking_at: "2026-01-01T10:00:00Z" } }];
    f.rows.marketing_automation_steps = [
      { id: "promo-step", automation_id: "auto-a", position: 0, step_type: "generate_promo", config: { discount_type: "PERCENT", discount_value: 15, max_uses: 1, valid_days: 30, code_prefix: "COMEBACK" } },
      { id: "email-step", automation_id: "auto-a", position: 1, step_type: "send_email", config: { template_id: "template-a" } },
    ];
    if (fails) f.failPromos();
    const response = await f.invoke("marketing-automation-dispatch");
    expect(response.status).toBe(200);
    expect(f.rows.marketing_automation_enrollments[0].current_step).toBe(fails ? 0 : 1);
    expect(f.emails).toEqual([]);
    if (!fails) {
      expect(f.rows.promotions[0]).toMatchObject({ business_id: "a", discount_type: "PERCENT", discount_value: 15, max_uses: 1 });
      expect(f.rows.marketing_automation_enrollments[0].metadata).toMatchObject({ last_booking_at: "2026-01-01T10:00:00Z", promo_code: f.rows.promotions[0].code, promo_discount: "15%" });
    } else expect((await response.json()).errors).toBe(1);
  });
  it("an email-only welcome-back sequence suppresses the legacy WhatsApp win-back", async () => {
    const f = fixture();
    Object.assign(f.rows.marketing_automations[0], { trigger_type: "booking_inactive", status: "paused" });
    expect((await f.invoke("auto-messages", { action: "re_engage" })).status).toBe(200);
    expect(f.whatsapp).toEqual([]);
    expect(f.emails).toEqual([]);
  });
  it("checks trading status for all 2,000 operators without truncation", async () => {
    const f = fixture();
    f.rows.businesses = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), subscription_status: "ACTIVE" }));
    expect((await subscription.nonTradingBusinessIds({ from: (table: string) => ({ select: () => ({ in: async (_key: string, ids: string[]) => {
      expect(ids.length).toBeLessThanOrEqual(500);
      return { data: f.rows[table].filter(row => ids.includes(row.id)), error: null };
    } }) }) }, f.rows.businesses.map(row => row.id))).size).toBe(0);
  });
});


describe("operator waiver and payment deadline emails", () => {
  it("sends the waiver to the stored guest email with its own booking link", async () => {
    const f=fixture();Object.assign(f.rows.bookings[0],{status:"CONFIRMED",waiver_status:"PENDING",waiver_token:"waiver-secret",customer_name:"Alex",qty:2,tours:{name:"Harbour paddle"},slots:{start_time:"2099-10-25T09:00:00Z"}});
    Object.assign(f.rows.businesses[0],{booking_site_url:"https://a.booking.fixture.invalid"});
    const res=await f.invoke("send-email",{type:"WAIVER_REQUEST",data:{business_id:"a",booking_id:"booking-a",email:"wrong@example.invalid",waiver_url:"https://wrong.invalid"}});
    expect(res.status).toBe(200);expect(f.emails).toHaveLength(1);
    expect(f.emails[0].to).toContain("guest-a@fixture.invalid");expect(f.emails[0].html).toContain("waiver-secret");
    expect(f.emails[0].html).not.toContain("https://wrong.invalid");expect(f.emails[0].html).not.toContain("tomorrow");
  });
  it("rejects cross-tenant, already-signed and missing-email waiver sends", async () => {
    const f=fixture();const body={type:"WAIVER_REQUEST",data:{business_id:"a",booking_id:"booking-a"}};
    expect((await f.invoke("send-email",body,"b")).status).toBe(403);
    Object.assign(f.rows.bookings[0],{status:"CONFIRMED",waiver_status:"SIGNED"});
    expect((await f.invoke("send-email",body)).status).toBe(409);
    Object.assign(f.rows.bookings[0],{waiver_status:"PENDING",waiver_token:"waiver-secret",email:null});
    Object.assign(f.rows.businesses[0],{booking_site_url:"https://a.booking.fixture.invalid"});
    const missing=await f.invoke("send-email",body);expect((await missing.json()).ok).toBe(false);expect(f.emails).toEqual([]);
  });
  it("renders deadline reminders from the saved booking and blocks paid bookings", async () => {
    const f=fixture();const deadline="2099-10-25T09:00:00.000Z";
    Object.assign(f.rows.bookings[0],{source:"ADMIN",status:"PENDING",total_amount:100,total_captured:0,payment_deadline:deadline,payment_url:"https://checkout.yoco.com/fixture"});
    const body={type:"PAYMENT_EXPIRING",data:{business_id:"a",booking_id:"booking-a",email:"guest-a@fixture.invalid",payment_deadline:deadline,ref:"BOOKING-A",tour_name:"Harbour paddle"}};
    const res=await f.invoke("send-email",body);expect(res.status).toBe(200);
    expect(f.emails[0].html).toContain(deadline);expect(f.emails[0].html).toContain("/functions/v1/booking-payment?");expect(f.emails[0].html).toContain("This payment link will expire");
    Object.assign(f.rows.bookings[0],{status:"PAID",total_captured:100});
    expect((await f.invoke("send-email",body)).status).toBe(409);expect(f.emails).toHaveLength(1);
  });
});
