import { describe, expect, it } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

// Section 5 re-verify: a failing cron step turns the run red (HTTP 500 and an
// "error" monitor check-in) instead of passing silently.
function run(dbError: { message: string } | null, autoMessagesStatus = 200) {
  const checkIns: string[] = [];
  const result = { data: null, error: dbError };
  // Every query, in any chain shape, resolves to the same result.
  const db: any = new Proxy(() => {}, { get: (_t, key) => key === "then" ? (resolve: any) => resolve(result) : db, apply: () => db });
  const handler = sourceHandler("supabase/functions/cron-tasks/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => db, fetchAllRows: async () => { if (dbError) throw dbError; return []; },
      formatTenantDateTime: () => "", getTenantByBusinessId: async () => ({ business: {} }), sendWhatsappTextForTenant: async () => ({}),
    },
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: unknown) => fn, captureCheckIn: async (_name: string, status: string) => { checkIns.push(status); return "check-in"; } },
    "../_shared/auth.ts": { requireAuth: async () => ({ isServiceRole: true }) },
  }, { SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" },
  async () => Response.json({ ok: autoMessagesStatus === 200 }, { status: autoMessagesStatus }));
  return { checkIns, response: handler(new Request("https://synthetic.invalid/cron-tasks", { method: "POST", body: "{}" })) };
}

describe("cron failure reporting", () => {
  it("a healthy run reports ok", async () => {
    const f = run(null);
    const response = await f.response;
    expect(await response.json()).toMatchObject({ errors: [] });
    expect(response.status).toBe(200);
    expect(f.checkIns).toEqual(["in_progress", "ok"]);
  });

  it("a failed scheduled-message run turns the sweep red", async () => {
    const f = run(null, 502);
    const response = await f.response;
    expect(response.status).toBe(500);
    expect((await response.json()).errors).toEqual(["Scheduled notifications did not complete successfully"]);
    expect(f.checkIns).toEqual(["in_progress", "error"]);
  });

  it("a database outage is reported by every database step, not swallowed", async () => {
    const f = run({ message: "fixture outage" });
    const response = await f.response;
    expect(response.status).toBe(500);
    // 13 steps read or write the database; only the scheduled-message call does not.
    expect((await response.json()).errors).toEqual(Array(13).fill("fixture outage"));
    expect(f.checkIns).toEqual(["in_progress", "error"]);
  });
});
