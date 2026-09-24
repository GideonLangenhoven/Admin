import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

const serviceKey = "fixture-service-not-a-real-credential";
const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: serviceKey };

type Admin = {
  business_id: string | null;
  role: string;
  suspended?: boolean;
  read_only?: boolean;
} | null;

function processFixture(admin: Admin, options: { authError?: boolean; adminError?: boolean; runtimeEnv?: Record<string, string> } = {}) {
  const booking: any = {
    id: "booking-a",
    business_id: "tenant-a",
    status: "PAID",
    payment_status: "CAPTURED",
    total_amount: 0,
    original_total: 100,
    voucher_amount_paid: 100,
    total_captured: 0,
    total_refunded: 0,
  };
  const moneyActions: any[] = [];
  const authGetUser = vi.fn(async () => options.authError
    ? { data: { user: null }, error: { message: "auth unavailable" } }
    : { data: { user: { id: "actor-a" } }, error: null });
  const db = {
    auth: { getUser: authGetUser },
    from(table: string) {
      let patch: any;
      const execute = async () => {
        if (table === "bookings") {
          if (patch) {
            moneyActions.push({ table, patch });
            Object.assign(booking, patch);
          }
          return { data: { ...booking }, error: null };
        }
        if (table === "admin_users") {
          return options.adminError
            ? { data: null, error: { message: "admin lookup failed" } }
            : { data: admin, error: null };
        }
        throw new Error("Unexpected process-refund table: " + table);
      };
      const q: any = {
        select: () => q,
        eq: () => q,
        update: (value: any) => { patch = value; return q; },
        single: execute,
        maybeSingle: execute,
        then: (yes: any, no: any) => execute().then(yes, no),
      };
      return q;
    },
    rpc: async (name: string, args: any) => {
      moneyActions.push({ name, args });
      if (name === "cancel_booking_transaction") return { data: { ok: true }, error: null };
      return { data: true, error: null };
    },
  };
  const reissueVoucherPortion = vi.fn(async () => ({ code: "CREDIT1", amount: 100 }));
  const handler = sourceHandler("supabase/functions/process-refund/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => db,
      getTenantByBusinessId: async () => ({ credentials: {} }),
      sendWhatsappTextForTenant: async () => undefined,
      getAdminAppOrigins: () => ["https://fixture.invalid"],
      isAllowedOrigin: () => true,
    },
    "../_shared/vouchers.ts": {
      getPaidPortions: () => ({ cashPaid: 0, voucherPaid: 100, paidValue: 100 }),
      reissueVoucherPortion,
    },
    "../_shared/combo.ts": { getComboLegPolicy: async () => null },
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: any) => fn },
  }, { ...env, ...options.runtimeEnv });
  const invoke = (credential = "fixture-user-token", header = "authorization") => handler(new Request("https://fixture.invalid/refund", {
    method: "POST",
    headers: { [header]: header === "authorization" ? "Bearer " + credential : credential },
    body: JSON.stringify({ booking_id: booking.id }),
  }));
  return { invoke, moneyActions, authGetUser, reissueVoucherPortion };
}

type Authority = { userId: string; businessId: string; role: string; isServiceRole: boolean; readOnly?: boolean };
type RefundReply = Response | Error;

function batchFixture(options: {
  authority?: Authority;
  authError?: string;
  bookings?: Array<{ id: string; business_id: string }>;
  bookingError?: string;
  replies?: RefundReply[];
  failAuditAt?: number;
  failRecordAt?: number;
} = {}) {
  const authority = options.authority || { userId: "actor-a", businessId: "tenant-a", role: "OPERATOR", isServiceRole: false };
  const bookings = options.bookings || [{ id: "booking-a", business_id: "tenant-a" }];
  const replies = [...(options.replies || [])];
  const requests: Array<{ url: string; headers: Headers; body: any }> = [];
  const logWrites: any[] = [];
  const batches = new Map<string, any>();
  let recordCalls = 0;
  const snapshot = (value: any) => JSON.parse(JSON.stringify(value));
  const from = vi.fn((table: string) => {
    let ids: string[] = [];
    let businessId: string | undefined;
    let batchId: string | undefined;
    let write: any;
    const execute = async () => {
      if (table === "bookings") {
        if (options.bookingError) return { data: null, error: { message: options.bookingError } };
        return {
          data: bookings.filter(row => ids.includes(row.id) && (!businessId || row.business_id === businessId)),
          error: null,
        };
      }
      if (table === "logs") {
        // A database stores the JSON snapshot sent at this point; later array
        // mutations in the handler cannot retroactively fill accepted IDs.
        logWrites.push(JSON.parse(JSON.stringify(write)));
        const failed = options.failAuditAt === logWrites.length;
        return { data: failed ? null : write, error: failed ? { message: "audit unavailable" } : null };
      }
      if (table === "refund_batches") {
        if (write) {
          if (batches.has(write.id)) return { data: null, error: { code: "23505" } };
          batches.set(write.id, snapshot(write));
          return { data: snapshot(write), error: null };
        }
        const row = batchId && batches.get(batchId);
        return { data: row && row.business_id === businessId ? snapshot(row) : null, error: null };
      }
      throw new Error("Unexpected batch-refund table: " + table);
    };
    const q: any = {
      select: () => q,
      in: (_key: string, value: string[]) => { ids = value; return q; },
      eq: (key: string, value: string) => { if (key === "id") batchId = value; else if (key === "business_id") businessId = value; return q; },
      insert: (value: any) => { write = value; return q; },
      upsert: (value: any) => { write = value; return q; },
      single: execute,
      maybeSingle: execute,
      then: (yes: any, no: any) => execute().then(yes, no),
    };
    return q;
  });
  const handler = sourceHandler("supabase/functions/batch-refund/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => ({ from, rpc: async (name: string, args: any) => {
        const batch = batches.get(args.p_batch_id);
        const item = batch?.results?.[args.p_booking_id];
        if (!item) return { data: false, error: null };
        if (name === "claim_refund_batch_item" && item.status === "unprocessed") {
          batch.results[args.p_booking_id] = { booking_id: args.p_booking_id, status: "submitting", ok: false };
          return { data: true, error: null };
        }
        if (name === "record_refund_batch_item" && item.status === "submitting") {
          if (++recordCalls === options.failRecordAt) return { data: false, error: { message: "record unavailable" } };
          batch.results[args.p_booking_id] = snapshot(args.p_result);
          return { data: true, error: null };
        }
        return { data: false, error: null };
      } }),
      getAdminAppOrigins: () => ["https://fixture.invalid"],
      isAllowedOrigin: () => true,
    },
    "../_shared/auth.ts": {
      requireAuth: async () => {
        if (options.authError) throw new Error(options.authError);
        return authority;
      },
    },
  }, env, vi.fn<typeof fetch>(async (input, init) => {
    const reply = replies.shift() || Response.json({ ok: true, amount: 10, refund_status: "REFUNDED" });
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    if (reply instanceof Error) throw reply;
    return reply;
  }));
  const invoke = (bookingIds: string[], body: Record<string, unknown> = {}, headers: Record<string, string> = { authorization: "Bearer fixture-user-token" }) => handler(new Request("https://fixture.invalid/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ batch_id: "00000000-0000-4000-8000-000000000201", booking_ids: bookingIds, ...body }),
  }));
  return { invoke, from, requests, logWrites, batches, authority, bookings };
}

describe("process-refund authority", () => {
  it.each(["OPERATOR", "ADMIN", "MAIN_ADMIN"])("allows active own-tenant %s callers", async role => {
    const f = processFixture({ business_id: "tenant-a", role });
    expect(await (await f.invoke()).json()).toMatchObject({ ok: true, channel: "voucher" });
    expect(f.reissueVoucherPortion).toHaveBeenCalledOnce();
  });

  it("allows exact SUPER_ADMIN cross-tenant support", async () => {
    const f = processFixture({ business_id: null, role: "SUPER_ADMIN" });
    expect((await f.invoke()).status).toBe(200);
    expect(f.reissueVoucherPortion).toHaveBeenCalledOnce();
  });

  it.each([
    ["unknown role", { business_id: "tenant-a", role: "REFUND_AGENT" }],
    ["super substring", { business_id: "tenant-a", role: "NOT_SUPER_ADMIN_HELPER" }],
    ["suspended", { business_id: "tenant-a", role: "OPERATOR", suspended: true }],
    ["read-only demo", { business_id: "tenant-a", role: "OPERATOR", read_only: true }],
    ["foreign ordinary", { business_id: "tenant-b", role: "MAIN_ADMIN" }],
  ])("denies %s before any money action", async (_label, admin) => {
    const f = processFixture(admin);
    expect((await f.invoke()).status).toBe(403);
    expect(f.moneyActions).toEqual([]);
    expect(f.reissueVoucherPortion).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid auth", { authError: true }, 401],
    ["admin lookup error", { adminError: true }, 503],
  ])("fails closed on %s", async (_label, options, status) => {
    const f = processFixture({ business_id: "tenant-a", role: "OPERATOR" }, options);
    expect((await f.invoke()).status).toBe(status);
    expect(f.moneyActions).toEqual([]);
  });

  it.each(["authorization", "apikey"])("preserves internal service flow via %s", async header => {
    const f = processFixture(null);
    expect((await f.invoke(serviceKey, header)).status).toBe(200);
    expect(f.authGetUser).not.toHaveBeenCalled();
  });

  it.each(["authorization", "apikey"])("accepts a rotated internal service key via %s", async header => {
    const f = processFixture(null, { runtimeEnv: { SUPABASE_SECRET_KEYS: JSON.stringify({ rotated: "fixture-rotated-service-key" }) } });
    expect((await f.invoke("fixture-rotated-service-key", header)).status).toBe(200);
    expect(f.authGetUser).not.toHaveBeenCalled();
  });

  it("does not treat an empty configured service key as authority", async () => {
    const f = processFixture(null, { runtimeEnv: { SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_SECRET_KEYS: "{}" } });
    expect((await f.invoke("fixture-public-anon-key", "apikey")).status).toBe(401);
    expect(f.moneyActions).toEqual([]);
  });
});

describe("batch-refund authority and accounting", () => {
  it("persists every accepted target and actor before contacting the refund handler", async () => {
    const f = batchFixture({ bookings: [
      { id: "booking-a", business_id: "tenant-a" },
      { id: "booking-b", business_id: "tenant-a" },
    ] });
    await f.invoke(["booking-a", "booking-b"]);
    expect(f.logWrites[0]).toMatchObject({
      business_id: "tenant-a",
      payload: {
        actor_user_id: "actor-a",
        results: [
          { booking_id: "booking-a", status: "unprocessed" },
          { booking_id: "booking-b", status: "unprocessed" },
        ],
      },
    });
    expect(f.requests).toHaveLength(2);
  });

  it("appends tenant-scoped audit events without using the caller's batch ID as a log key", async () => {
    const f = batchFixture();
    const chosenBatchId = "00000000-0000-4000-8000-000000000987";
    expect((await f.invoke(["booking-a"], { batch_id: chosenBatchId })).status).toBe(200);
    expect(f.logWrites).toHaveLength(3);
    expect(f.logWrites.every(log => !Object.hasOwn(log, "id"))).toBe(true);
    expect(f.logWrites.every(log => log.business_id === "tenant-a" && log.payload.batch_id === chosenBatchId)).toBe(true);
    expect(f.logWrites.map(log => log.event)).toEqual([
      "batch_refund_started", "batch_refund_progress", "batch_refund_complete",
    ]);
  });
  it.each(["OPERATOR", "ADMIN", "MAIN_ADMIN"])("allows own-tenant %s and forwards the caller JWT", async role => {
    const f = batchFixture({ authority: { userId: "actor-a", businessId: "tenant-a", role, isServiceRole: false } });
    const response = await f.invoke(["booking-a"], { actor_user_id: "forged-actor" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ completed: 1, pending: 0, manual_action: 0, failed: 0, unknown: 0, unprocessed: 0 });
    expect(f.requests[0].headers.get("authorization")).toBe("Bearer fixture-user-token");
    expect(f.logWrites.every(log => log.business_id === "tenant-a")).toBe(true);
    expect(f.logWrites.every(log => log.payload.actor_user_id === "actor-a")).toBe(true);
    expect(f.logWrites[0].payload.processed).toBe(0);
    expect(f.logWrites.at(-1).payload.processed).toBe(1);
  });

  it("allows exact SUPER_ADMIN support for one foreign tenant", async () => {
    const f = batchFixture({
      authority: { userId: "platform-a", businessId: "", role: "SUPER_ADMIN", isServiceRole: false },
      bookings: [{ id: "booking-a", business_id: "tenant-z" }],
    });
    expect((await f.invoke(["booking-a"])).status).toBe(200);
    expect(f.logWrites[0]).toMatchObject({ business_id: "tenant-z", payload: { actor_user_id: "platform-a" } });
  });

  it.each(["REFUND_AGENT", "NOT_SUPER_ADMIN_HELPER", "super_admin"])("denies unknown role %s", async role => {
    const f = batchFixture({ authority: { userId: "actor-a", businessId: "tenant-a", role, isServiceRole: false } });
    expect((await f.invoke(["booking-a"])).status).toBe(403);
    expect(f.requests).toEqual([]);
    expect(f.logWrites).toEqual([]);
  });

  it("denies cross-tenant ordinary callers", async () => {
    const f = batchFixture({ bookings: [{ id: "booking-a", business_id: "tenant-b" }] });
    expect((await f.invoke(["booking-a"])).status).toBe(403);
    expect(f.requests).toEqual([]);

    const mixed = batchFixture({ bookings: [{ id: "booking-a", business_id: "tenant-a" }, { id: "booking-b", business_id: "tenant-b" }] });
    expect((await mixed.invoke(["booking-a", "booking-b"])).status).toBe(403);
    expect(mixed.requests).toEqual([]);
  });

  it("rejects mixed-tenant and duplicate batches before audit or submission", async () => {
    const mixed = batchFixture({
      authority: { userId: "platform-a", businessId: "", role: "SUPER_ADMIN", isServiceRole: false },
      bookings: [{ id: "booking-a", business_id: "tenant-a" }, { id: "booking-b", business_id: "tenant-b" }],
    });
    expect((await mixed.invoke(["booking-a", "booking-b"])).status).toBe(400);
    expect(mixed.requests).toEqual([]);
    expect(mixed.logWrites).toEqual([]);

    const duplicate = batchFixture();
    expect((await duplicate.invoke(["booking-a", "booking-a"])).status).toBe(400);
    expect(duplicate.from).not.toHaveBeenCalled();
    expect(duplicate.requests).toEqual([]);
  });

  it("fails closed on auth and booking lookup errors", async () => {
    const denied = batchFixture({ authError: "This demonstration account is read-only" });
    expect((await denied.invoke(["booking-a"])).status).toBe(401);
    expect(denied.from).not.toHaveBeenCalled();

    const dbError = batchFixture({ bookingError: "database unavailable" });
    expect((await dbError.invoke(["booking-a"])).status).toBe(503);
    expect(dbError.requests).toEqual([]);
    expect(dbError.logWrites).toEqual([]);
  });

  it("preserves an apikey-authenticated service wrapper downstream", async () => {
    const f = batchFixture({ authority: { userId: "service_role", businessId: "", role: "service_role", isServiceRole: true } });
    expect((await f.invoke(["booking-a"], {}, { apikey: serviceKey })).status).toBe(200);
    expect(f.requests[0].headers.get("apikey")).toBe(serviceKey);
    expect(f.requests[0].headers.has("authorization")).toBe(false);
  });

  it("reports completed, pending, manual, failed, malformed and exceptional outcomes truthfully", async () => {
    const bookings = Array.from({ length: 7 }, (_, i) => ({ id: "booking-" + i, business_id: "tenant-a" }));
    const f = batchFixture({ bookings, replies: [
      Response.json({ ok: true, refund_status: "REFUNDED", amount: 10 }),
      Response.json({ ok: true, pending: true, refund_status: "REFUND_PENDING", amount: 20 }, { status: 202 }),
      Response.json({ ok: true, pending: true, refund_status: "MANUAL_EFT_REQUIRED", amount: 30 }),
      Response.json({ ok: false, refund_status: "FAILED", error: "declined" }, { status: 502 }),
      new Response("not-json", { status: 200 }),
      new Error("response lost"),
      Response.json({ ok: true, pending: true, amount: 40 }),
    ] });
    const response = await f.invoke(bookings.map(row => row.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, succeeded: 1, completed: 1, pending: 2, manual_action: 1, failed: 1, unknown: 2, unprocessed: 0 });
    expect(body.results.map((result: any) => result.status)).toEqual([
      "completed", "pending", "manual_action", "failed", "unknown", "unknown", "pending",
    ]);
    expect(f.from.mock.calls.filter(call => call[0] === "bookings")).toHaveLength(1);
  });

  it.each([401, 403])("leaves the untouched tail unprocessed after downstream %i", async status => {
    const f = batchFixture({
      bookings: ["booking-a", "booking-b", "booking-c"].map(id => ({ id, business_id: "tenant-a" })),
      replies: [
        Response.json({ ok: true, refund_status: "REFUNDED" }),
        Response.json({ error: "Admin session required" }, { status }),
      ],
    });
    const first = await f.invoke(["booking-a", "booking-b", "booking-c"]);
    expect(first.status).toBe(status);
    expect(await first.json()).toMatchObject({ completed: 1, failed: 1, unprocessed: 1 });
    expect(f.requests.map(request => request.body.booking_id)).toEqual(["booking-a", "booking-b"]);
    expect(f.logWrites.map(log => log.event)).toEqual([
      "batch_refund_started", "batch_refund_progress", "batch_refund_progress",
    ]);
    expect((await (await f.invoke([], { action: "status", business_id: "tenant-a" })).json()).unprocessed).toBe(1);
    const resumed = await f.invoke([], { action: "resume", business_id: "tenant-a" });
    expect(await resumed.json()).toMatchObject({ completed: 2, failed: 1, unprocessed: 0 });
    expect(f.requests.map(request => request.body.booking_id)).toEqual(["booking-a", "booking-b", "booking-c"]);
  });

  it("stops before submission when the initial audit cannot be persisted", async () => {
    const f = batchFixture({ failAuditAt: 1 });
    const response = await f.invoke(["booking-a"]);
    expect(response.status).toBe(503);
    expect(f.requests).toEqual([]);
  });

  it("retains actual outcomes and marks the remainder unprocessed after a later audit failure", async () => {
    const f = batchFixture({
      bookings: [{ id: "booking-a", business_id: "tenant-a" }, { id: "booking-b", business_id: "tenant-a" }, { id: "booking-c", business_id: "tenant-a" }],
      failAuditAt: 2,
    });
    const response = await f.invoke(["booking-a", "booking-b", "booking-c"]);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, completed: 1, failed: 0, unknown: 0, unprocessed: 2 });
    expect(body.results.map((result: any) => result.status)).toEqual(["completed", "unprocessed", "unprocessed"]);
    expect(f.requests).toHaveLength(1);
  });

  it("returns completed outcomes when only the final audit write fails", async () => {
    const f = batchFixture({ failAuditAt: 3 });
    const response = await f.invoke(["booking-a"]);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, completed: 1, failed: 0, unknown: 0, unprocessed: 0 });
    expect(f.requests).toHaveLength(1);
  });

  it("returns the accepted record after a lost response without submitting money again", async () => {
    const f = batchFixture();
    expect((await f.invoke(["booking-a"])).status).toBe(200);
    expect((await f.invoke(["booking-a"])).status).toBe(200);
    const status = await f.invoke([], { action: "status", business_id: "tenant-a" });
    expect(await status.json()).toMatchObject({ completed: 1, unprocessed: 0 });
    expect(f.requests).toHaveLength(1);
    expect(f.batches.size).toBe(1);
  });

  it("resumes only unsubmitted items after an interrupted foreground batch", async () => {
    const f = batchFixture({
      bookings: ["booking-a", "booking-b"].map(id => ({ id, business_id: "tenant-a" })),
      failAuditAt: 2,
    });
    expect((await f.invoke(["booking-a", "booking-b"])).status).toBe(503);
    const status = await f.invoke([], { action: "status", business_id: "tenant-a" });
    expect(await status.json()).toMatchObject({ completed: 1, unprocessed: 1 });
    const resumed = await f.invoke([], { action: "resume", business_id: "tenant-a" });
    expect(await resumed.json()).toMatchObject({ completed: 2, unprocessed: 0 });
    expect(f.requests.map(request => request.body.booking_id)).toEqual(["booking-a", "booking-b"]);
  });

  it("keeps an uncertain item out of later resume and binds status to the original actor", async () => {
    const f = batchFixture({ replies: [new Error("response lost")] });
    expect((await f.invoke(["booking-a"])).status).toBe(200);
    expect(await (await f.invoke([], { action: "resume", business_id: "tenant-a" })).json()).toMatchObject({ unknown: 1 });
    expect(f.requests).toHaveLength(1);
    f.authority.userId = "other-actor";
    expect((await f.invoke([], { action: "status", business_id: "tenant-a" })).status).toBe(403);
    f.authority.userId = "actor-a";
    f.authority.businessId = "tenant-b";
    expect((await f.invoke([], { action: "status", business_id: "tenant-a" })).status).toBe(403);
  });

  it("reconciles a persisted pending refund when the batch result write was lost", async () => {
    const f = batchFixture({ failRecordAt: 1 });
    expect((await f.invoke(["booking-a"])).status).toBe(503);
    expect(f.requests).toHaveLength(1);
    Object.assign(f.bookings[0], { refund_status: "REFUND_PENDING", refund_request_id: "existing-server-request" });
    const recovered = await f.invoke([], { action: "status", business_id: "tenant-a" });
    expect(await recovered.json()).toMatchObject({ pending: 1, unknown: 0, unprocessed: 0 });
    expect(f.requests).toHaveLength(1);
    expect((await (await f.invoke([], { action: "resume", business_id: "tenant-a" })).json()).pending).toBe(1);
    expect(f.requests).toHaveLength(1);
  });
});
