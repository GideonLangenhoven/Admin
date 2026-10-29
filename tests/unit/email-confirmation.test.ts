import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";

// S2 (security test F): an email match only proves ownership when the address is confirmed.
// If email confirmation were ever switched off, anyone could register with a guest's address.

const BOOKING = { id: "booking-1", business_id: "biz-a", email: "guest@example.invalid", status: "PAID", qty: 2, slot_id: "slot-1", total_amount: 100 };

// Any query-builder call returns the same thenable that resolves to `result`.
function chain(result: unknown): any {
  const p: any = new Proxy(() => p, {
    get: (_t, prop) => (prop === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) : () => p),
    apply: () => p,
  });
  return p;
}

const users: Record<string, { id: string; email: string; email_confirmed_at: string | null }> = {
  "token-confirmed-owner": { id: "u1", email: "Guest@Example.invalid", email_confirmed_at: "2026-01-01T00:00:00Z" },
  "token-unconfirmed-owner": { id: "u2", email: "guest@example.invalid", email_confirmed_at: null },
  "token-confirmed-other": { id: "u3", email: "someone-else@example.invalid", email_confirmed_at: "2026-01-01T00:00:00Z" },
};
const auth = {
  getUser: async (token: string) => (users[token] ? { data: { user: users[token] }, error: null } : { data: { user: null }, error: { message: "invalid" } }),
};
const post = (token: string, body: Record<string, unknown>) =>
  new Request("https://fn.invalid/", { method: "POST", headers: { authorization: "Bearer " + token, origin: "https://acme.booking.bookingtours.co.za" }, body: JSON.stringify(body) });

describe("rebook-booking: authenticated non-admin callers (S2)", () => {
  const db = { auth, from: (table: string) => chain(table === "bookings" ? { data: BOOKING, error: null } : { data: null, error: null }) };
  const handler = sourceHandler(
    "supabase/functions/rebook-booking/index.ts",
    {
      "../_shared/tenant.ts": {
        createServiceClient: () => db, formatTenantDateTime: () => "", getAdminAppOrigins: () => [], getBusinessDisplayName: () => "",
        getTenantByBusinessId: async () => null, normalizePhone: (p: string) => p, sendWhatsappTextForTenant: async () => ({}),
      },
      "../_shared/customer-session.ts": { verifyCustomerSession: async () => ({ valid: false }) },
      "../_shared/vouchers.ts": { getPaidPortions: () => ({}) },
      "../_shared/combo.ts": { getComboLegPolicy: async () => null, validateComboDates: () => null },
      "../_shared/auth.ts": sourceExports("supabase/functions/_shared/auth.ts", { "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db } }, { SUPABASE_URL: "https://fn.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key-fixture" }),
    },
    { SUPABASE_URL: "https://fn.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key-fixture" },
  );
  // RESCHEDULE without new_slot_id is rejected with 400 right after authorization, so a 400 means "authorized".
  const call = (token: string) => handler(post(token, { booking_id: BOOKING.id, action: "RESCHEDULE" }));

  it("rejects a user whose email matches the booking but is NOT confirmed", async () => {
    const r = await call("token-unconfirmed-owner");
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "This booking does not belong to your account." });
  });

  it("still accepts the confirmed owner (case-insensitive email match)", async () => {
    expect((await call("token-confirmed-owner")).status).toBe(400);
  });

  it("still rejects a confirmed user with a different email", async () => {
    expect((await call("token-confirmed-other")).status).toBe(403);
  });
});

describe("my-bookings-lookup: authenticated email identity (S2)", () => {
  const db = { auth, from: () => chain({ data: [], error: null, count: 0 }) };
  const handler = sourceHandler(
    "supabase/functions/my-bookings-lookup/index.ts",
    {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
      "../_shared/my-bookings-lookup.ts": {
        filterBookingsForLookup: (rows: unknown[]) => rows, normalizePhoneTail: (v: string) => v,
        resolveBusinessFromOrigin: () => ({ id: "biz-a", subdomain: "acme", booking_site_url: "", manage_bookings_url: "" }),
      },
      "../_shared/tenant.ts": { fetchAllRows: async () => [] },
      "../_shared/otp-attempts.ts": { normalizeOtpCode: (v: string) => v, verifyTrackedOtp: async () => ({ ok: false }) },
      "../_shared/customer-session.ts": { issueCustomerSession: async () => "session", verifyCustomerSession: async () => ({ valid: false }) },
    },
    { SUPABASE_URL: "https://fn.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key-fixture" },
  );
  const call = (token: string) => handler(post(token, {}));

  it("does not treat an unconfirmed email as a verified identity", async () => {
    const r = await call("token-unconfirmed-owner");
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe("Verification is required.");
  });

  it("still treats a confirmed email as a verified identity", async () => {
    expect([401, 403]).not.toContain((await call("token-confirmed-owner")).status);
  });
});

describe("SQL functions that match auth users to rows by email (S2)", () => {
  const bodyOf = (fn: string) =>
    readFileSync("supabase/migrations/20261029090000_require_confirmed_email_matching.sql", "utf8")
      .split(/CREATE OR REPLACE FUNCTION public\./)
      .find((s) => s.startsWith(fn + "("))!;

  it.each(["link_customer_user", "get_my_admin_onboarding", "complete_my_admin_onboarding", "set_my_help_chat_hidden"])(
    "%s requires email_confirmed_at before matching on email",
    (fn) => {
      const body = bodyOf(fn);
      expect(body, `${fn} must be redefined in the migration`).toBeTruthy();
      expect(body).toContain("email_confirmed_at IS NOT NULL");
    },
  );
});
