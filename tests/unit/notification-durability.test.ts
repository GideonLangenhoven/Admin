import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { sourceFunction, sourceHandler } from "../helpers/source-handler";

function workerFixture(response: Response | Error | "hang", finishFails = false, jobOverrides: Record<string, unknown> = {}, eligibility = "ELIGIBLE") {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const job = {
    id: "job-a",
    business_id: "business-a",
    template_type: "PAYMENT_LINK",
    recipient: "guest@example.invalid",
    dedupe_key: "hold-payment-link/hold-a",
    payload: { business_id: "business-a", booking_id: "booking-a" },
    ...jobOverrides,
  };
  const supabase = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "claim_notification_jobs") return { data: [job], error: null };
      if (name === "validate_notification_job") return { data: eligibility, error: null };
      if (name === "finish_notification_job") {
        if (finishFails) return { data: null, error: { message: "database unavailable" } };
        return { data: args.p_accepted ? "ACCEPTED" : args.p_retryable ? "QUEUED" : "FAILED", error: null };
      }
      throw new Error("Unexpected RPC " + name);
    }),
  };
  const fetch = vi.fn(async (_url?: unknown, init?: RequestInit) => {
    if (response === "hang") {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason || new Error("aborted")), { once: true });
      });
    }
    if (response instanceof Error) throw response;
    return response.clone();
  });
  const run = sourceFunction("supabase/functions/cron-tasks/index.ts", "processNotificationJobs", {
    crypto: { randomUUID: () => "claim-a" },
    supabase,
    fetch,
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_KEY: "fixture-service-key",
    NOTIFICATION_JOB_LIMIT: 50,
    NOTIFICATION_CONCURRENCY: 10,
    SEND_EMAIL_TIMEOUT_MS: 5,
    AbortSignal,
    getTenantByBusinessId: vi.fn(),
    formatTenantDateTime: vi.fn(),
  });
  return { run, calls, fetch, recoverDatabase: () => { finishFails = false; } };
}

describe("durable transactional notification worker", () => {
  it("records provider acceptance only from a validated successful response", async () => {
    const f = workerFixture(Response.json({ ok: true, id: "provider-a" }));
    await expect(f.run()).resolves.toMatchObject({ claimed: 1, accepted: 1, retrying: 0, failed: 0 });
    const finish = f.calls.find(call => call.name === "finish_notification_job");
    expect(finish?.args).toMatchObject({ p_job_id: "job-a", p_claim_id: "claim-a", p_accepted: true, p_provider_message_id: "provider-a" });
    const sent = JSON.parse(String(f.fetch.mock.calls[0][1]?.body));
    expect(sent.data.delivery_idempotency_key).toBe("hold-payment-link/hold-a");
  });

  it.each([
    ["missing ID", Response.json({ ok: true })],
    ["empty ID", Response.json({ ok: true, id: "   " })],
    ["malformed JSON", new Response("not-json", { status: 200 })],
  ])("retries an ambiguous 2xx response with %s", async (_label, response) => {
    const f = workerFixture(response);
    await expect(f.run()).resolves.toMatchObject({ accepted: 0, retrying: 1 });
    const finish = f.calls.find(call => call.name === "finish_notification_job");
    expect(finish?.args).toMatchObject({
      p_accepted: false,
      p_provider_message_id: null,
      p_retryable: true,
      p_acceptance_uncertain: true,
    });
  });

  it.each([
    ["unauthorized", new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }), false],
    ["rate limited", new Response(JSON.stringify({ error: "slow down" }), { status: 429 }), true],
    ["provider unavailable", new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }), true],
    ["rejected", new Response(JSON.stringify({ error: "invalid recipient" }), { status: 400 }), false],
    ["wrapped provider unauthorized", Response.json({ ok: false, error: "unauthorized", status: 401 }, { status: 502 }), false],
    ["wrapped provider rate limit", Response.json({ ok: false, error: "rate_limit", status: 429 }, { status: 502 }), true],
    ["network timeout", new Error("timeout"), true],
  ])("keeps %s outcomes truthful and retryable only when appropriate", async (_label, response, retryable) => {
    const f = workerFixture(response);
    const result = await f.run();
    expect(result).toMatchObject(retryable ? { retrying: 1 } : { failed: 1 });
    const finish = f.calls.find(call => call.name === "finish_notification_job");
    expect(finish?.args).toMatchObject({ p_accepted: false, p_retryable: retryable });
  });

  it("retries provider acceptance after a database crash with the identical provider key", async () => {
    const f = workerFixture(Response.json({ ok: true, id: "provider-a" }), true);
    await expect(f.run()).rejects.toThrow("database unavailable");
    f.recoverDatabase();
    await expect(f.run()).resolves.toMatchObject({ accepted: 1 });
    const keys = f.fetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)).data.delivery_idempotency_key);
    expect(keys).toEqual(["hold-payment-link/hold-a", "hold-payment-link/hold-a"]);
  });

  it("stops automatic retries before the provider idempotency window can lapse", async () => {
    const f = workerFixture(Response.json({ ok: true, id: "provider-a" }), false, {
      attempts: 2,
      first_attempt_at: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    });
    await expect(f.run()).resolves.toMatchObject({ failed: 1, accepted: 0 });
    expect(f.fetch).not.toHaveBeenCalled();
    const finish = f.calls.find(call => call.name === "finish_notification_job");
    expect(finish?.args).toMatchObject({ p_accepted: false, p_retryable: false });
  });

  it("cancels an ineligible payment reminder before contacting the provider", async () => {
    const f = workerFixture(Response.json({ ok: true, id: "provider-a" }), false, {}, "CANCELLED");
    await expect(f.run()).resolves.toMatchObject({ cancelled: 1, accepted: 0, failed: 0 });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("aborts a hanging send and records a retry without blocking the batch", async () => {
    const f = workerFixture("hang");
    await expect(f.run()).resolves.toMatchObject({ claimed: 1, retrying: 1 });
    const finish = f.calls.find(call => call.name === "finish_notification_job");
    expect(finish?.args).toMatchObject({ p_accepted: false, p_retryable: true, p_acceptance_uncertain: true });
  });

  it("passes a stable idempotency key to Resend", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "provider-a" }));
    const send = sourceFunction("supabase/functions/send-email/index.ts", "sendResend", {
      fetch,
      isValidEmail: () => true,
      RESEND_API_KEY: "fixture-resend-key",
      FROM_EMAIL: "from@example.invalid",
      RESEND_TIMEOUT_MS: 5,
      AbortSignal,
    });
    await expect(send("to@example.invalid", "from@example.invalid", "Subject", "<p>Body</p>", undefined, undefined, undefined, undefined, "hold-payment-link/hold-a"))
      .resolves.toMatchObject({ ok: true, id: "provider-a" });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ "Idempotency-Key": "hold-payment-link/hold-a" });
  });

  it.each([
    ["missing ID", Response.json({})],
    ["empty ID", Response.json({ id: "  " })],
    ["malformed JSON", new Response("not-json", { status: 200 })],
  ])("rejects a Resend 2xx response with %s as ambiguous", async (_label, providerResponse) => {
    const send = sourceFunction("supabase/functions/send-email/index.ts", "sendResend", {
      fetch: vi.fn(async () => providerResponse.clone()),
      isValidEmail: () => true,
      RESEND_API_KEY: "fixture-resend-key",
      FROM_EMAIL: "from@example.invalid",
      RESEND_TIMEOUT_MS: 5,
      AbortSignal,
    });
    await expect(send("to@example.invalid", "from@example.invalid", "Subject", "<p>Body</p>"))
      .resolves.toMatchObject({ ok: false, status: 502, error: "invalid_provider_response" });
  });

  it("schedules a service-authenticated minute worker with 50-job capacity", () => {
    const migration = readFileSync("supabase/migrations/20260921140000_durable_notification_jobs.sql", "utf8");
    const worker = readFileSync("supabase/functions/cron-tasks/index.ts", "utf8");
    expect(migration).toContain("'notification-jobs-every-minute'");
    expect(migration).toContain("body := '{\"action\":\"notification_jobs\"}'::jsonb");
    expect(migration).toContain("edge_jobs_service_role_key");
    expect(worker).toContain("const NOTIFICATION_JOB_LIMIT = 50");
    expect(worker).toContain("const NOTIFICATION_CONCURRENCY = 10");
    expect(worker).toContain('body?.action === "notification_jobs"');
    expect(readFileSync("supabase/functions/send-email/index.ts", "utf8")).toContain("const RESEND_TIMEOUT_MS = 7_000");
  });
});

describe("notification retry audit", () => {
  it("reports an audit failure instead of silently succeeding", async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "audit unavailable" } })),
      from(table: string) {
        let operation = "";
        const query: any = {
          select: () => { operation = "select"; return query; },
          update: () => { operation = "update"; return query; },
          eq: () => query,
          maybeSingle: async () => ({
            data: table === "notification_jobs" ? { id: "job-a", status: "FAILED", business_id: "business-a" } : null,
            error: null,
          }),
          insert: async () => ({ error: null }),
          then: (resolve: (value: unknown) => void) => resolve({ error: operation === "update" ? null : null }),
        };
        return query;
      },
    };
    const route = sourceHandler("app/api/admin/notifications/[id]/retry/route.ts", {
      "@/app/lib/api-auth": {
        getCallerAdmin: async () => ({ id: "admin-a", role: "MAIN_ADMIN", business_id: "business-a" }),
        isPrivilegedRole: () => true,
      },
      "@supabase/supabase-js": { createClient: () => db },
    });
    const response = await (route as any)(new Request("https://fixture.invalid/api/admin/notifications/job-a/retry", { method: "POST" }), {
      params: Promise.resolve({ id: "job-a" }),
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("audit unavailable") });
  });

  it("returns 409 when the provider retry window has expired", async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: { ok: false, status: "RETRY_WINDOW_EXPIRED" }, error: null })),
      from(table: string) {
        const query: any = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: table === "notification_jobs" ? { id: "job-a", status: "FAILED", business_id: "business-a" } : null,
            error: null,
          }),
        };
        return query;
      },
    };
    const route = sourceHandler("app/api/admin/notifications/[id]/retry/route.ts", {
      "@/app/lib/api-auth": {
        getCallerAdmin: async () => ({ id: "admin-a", role: "MAIN_ADMIN", business_id: "business-a" }),
        isPrivilegedRole: () => true,
      },
      "@supabase/supabase-js": { createClient: () => db },
    });
    const response = await (route as any)(new Request("https://fixture.invalid/api/admin/notifications/job-a/retry", { method: "POST" }), {
      params: Promise.resolve({ id: "job-a" }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("idempotency window expired") });
  });
});
