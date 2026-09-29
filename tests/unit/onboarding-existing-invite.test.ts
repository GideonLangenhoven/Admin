import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

describe("invite for a manually created client", () => {
  function fixture(ownerMatches = true) {
    const writes: Array<{ table: string; operation: string; value: unknown }> = [];
    const from = vi.fn((table: string) => {
      let operation = "select";
      let value: unknown;
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, item: unknown) => { filters[key] = item; return query; },
        ilike: (key: string, item: unknown) => { filters[key] = item; return query; },
        is: () => query,
        gt: () => query,
        limit: () => query,
        update: (item: unknown) => { operation = "update"; value = item; writes.push({ table, operation, value }); return query; },
        insert: (item: unknown) => { operation = "insert"; value = item; writes.push({ table, operation, value }); return query; },
        maybeSingle: async () => {
          if (table === "admin_users" && filters.user_id) return { data: { id: "platform", role: "SUPER_ADMIN", suspended: false, read_only: false }, error: null };
          if (table === "admin_users") return { data: ownerMatches ? { id: "owner" } : null, error: null };
          if (table === "businesses" && operation === "update") return { data: { id: "existing" }, error: null };
          if (table === "businesses") return { data: { id: "existing", business_name: "Cape Kayak", subdomain: "kayak", subscription_status: "ACTIVE", onboarding_request_id: "request-id" }, error: null };
          if (table === "invite_tokens") return { data: null, error: null };
          throw new Error(`Unexpected query: ${table}`);
        },
        single: async () => {
          if (table === "invite_tokens" && operation === "insert") return { data: { id: "invite", token: "token", expires_at: "tomorrow", created_at: "today" }, error: null };
          throw new Error(`Unexpected insert: ${table}`);
        },
        then: (resolve: (result: unknown) => unknown) => resolve({ count: 0, error: null }),
      };
      return query;
    });
    const handler = sourceHandler("supabase/functions/generate-invite-token/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({ from }) },
      "../_shared/auth.ts": { requireAuth: async () => ({ role: "SUPER_ADMIN", userId: "platform-user", isServiceRole: false }) },
    });
    const invoke = () => handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({
      action: "generate", business_id: "existing", client_name: "Owner", client_email: "owner@example.invalid", subdomain: "kayak",
    }) }));
    return { from, writes, invoke };
  }

  it("attaches the invite and fences the existing business without inserting another one", async () => {
    const f = fixture();
    const response = await f.invoke();
    expect(response.status).toBe(200);
    expect((await response.json()).business_id).toBe("existing");
    expect(f.writes).toEqual([
      { table: "invite_tokens", operation: "insert", value: expect.objectContaining({ business_id: "existing", client_email: "owner@example.invalid" }) },
      { table: "businesses", operation: "update", value: { subscription_status: "ONBOARDING" } },
    ]);
  });

  it("rejects an email that is not the existing Main Admin", async () => {
    const f = fixture(false);
    const response = await f.invoke();
    expect(response.status).toBe(409);
    expect(f.writes).toEqual([]);
  });

  it("keeps and reopens a manually created business when its invite is revoked", async () => {
    const deletedFilters: Record<string, unknown> = {};
    const updates: unknown[] = [];
    const from = (table: string) => {
      let operation = "select";
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        is: (key: string, value: unknown) => { filters[key] = value; return query; },
        not: (key: string, _operator: string, value: unknown) => { filters[key] = value; return query; },
        gt: () => query,
        delete: () => { operation = "delete"; return query; },
        update: (value: unknown) => { operation = "update"; updates.push(value); return query; },
        maybeSingle: async () => {
          if (table === "admin_users") return { data: { id: "platform", role: "SUPER_ADMIN", suspended: false, read_only: false }, error: null };
          if (table === "invite_tokens") return { data: { id: "invite", business_id: "existing" }, error: null };
          if (table === "businesses" && operation === "delete") {
            Object.assign(deletedFilters, filters);
            return { data: null, error: null };
          }
          if (table === "businesses" && operation === "update") return { data: { id: "existing" }, error: null };
          throw new Error(`Unexpected query: ${table}`);
        },
        then: (resolve: (result: unknown) => unknown) => resolve({ count: 0, error: null }),
      };
      return query;
    };
    const handler = sourceHandler("supabase/functions/generate-invite-token/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({ from }) },
      "../_shared/auth.ts": { requireAuth: async () => ({ role: "SUPER_ADMIN", userId: "platform-user", isServiceRole: false }) },
    });
    const response = await handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ action: "revoke", token_id: "invite" }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).business_restored).toBe(true);
    expect(deletedFilters).toMatchObject({ subscription_status: "ONBOARDING", onboarding_request_id: null });
    expect(updates).toEqual([{ subscription_status: "ACTIVE" }]);
  });
});
