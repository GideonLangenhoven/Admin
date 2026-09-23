import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

const BUSINESS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fixture(options: {
  action?: string;
  service?: boolean;
  admin?: { id: string; role: string; read_only: boolean; suspended: boolean } | null;
  subscription?: string;
  subscriptionError?: boolean;
} = {}) {
  const action = options.action ?? "token";
  const admin = options.admin === undefined
    ? { id: "admin-a", role: "OPERATOR", read_only: false, suspended: false }
    : options.admin;
  const queries: string[] = [];
  const rpc = vi.fn(async () => ({ data: [{ refresh_token: "synthetic-refresh", folder_id: "folder-a" }], error: null }));
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) },
    from(table: string) {
      let projection = "";
      const query: any = {
        select: (columns: string) => { projection = columns; return query; },
        eq: () => query,
        maybeSingle: async () => {
          queries.push(table + ":" + projection);
          if (table === "admin_users") return { data: admin, error: null };
          if (table === "businesses" && projection.includes("subscription_status")) {
            return options.subscriptionError
              ? { data: null, error: { message: "synthetic lookup failure" } }
              : { data: { subscription_status: options.subscription ?? "ACTIVE", suspension_reason: null }, error: null };
          }
          if (table === "businesses") return { data: { google_drive_refresh_token_encrypted: "synthetic", google_drive_folder_id: "folder-a", google_drive_email: "test@example.invalid" }, error: null };
          throw new Error("Unexpected table " + table);
        },
      };
      return query;
    },
    rpc,
  };
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "synthetic-token" });
    if (href === "https://www.googleapis.com/drive/v3/files") return Response.json({ id: "synthetic-folder" });
    if (href === "https://www.googleapis.com/drive/v3/files/synthetic-folder/permissions") return Response.json({ id: "synthetic-permission" });
    throw new Error("Unexpected network request: " + href);
  });
  const handler = sourceHandler("supabase/functions/google-drive/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => supabase },
  }, {
    SUPABASE_URL: "https://test.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    GOOGLE_CLIENT_ID: "synthetic-id", GOOGLE_CLIENT_SECRET: "synthetic-secret",
    SETTINGS_ENCRYPTION_KEY: "x".repeat(32),
  }, fetchImpl as typeof fetch);
  const request = new Request("https://test.invalid/functions/v1/google-drive", {
    method: "POST", headers: { Authorization: "Bearer " + (options.service ? "synthetic-service" : "synthetic-user") },
    body: JSON.stringify({ action, business_id: BUSINESS, folder_name: "Synthetic trip" }),
  });
  return { handler, request, fetchImpl, rpc, queries };
}

describe("direct Google Drive authorization", () => {
  it("allows active same-tenant staff to request a token", async () => {
    const f = fixture();
    expect((await f.handler(f.request)).status).toBe(200);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(f.queries).toContain("businesses:subscription_status, suspension_reason");
  });

  it("preserves active staff folder creation for the direct photo/video flow", async () => {
    const f = fixture({ action: "create_folder" });
    const response = await f.handler(f.request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ folder_id: "synthetic-folder" });
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each(["ADMIN", "MAIN_ADMIN"])("keeps exact legacy %s Drive token access", async role => {
    const f = fixture({ admin: { id: "admin-a", role, read_only: false, suspended: false } });
    expect((await f.handler(f.request)).status).toBe(200);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(["FUTURE_STAFF", "SUPER_PREFIX", "operator"])("denies unknown %s before Drive provider access", async role => {
    const f = fixture({ admin: { id: "admin-a", role, read_only: false, suspended: false } });
    expect((await f.handler(f.request)).status).toBe(403);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("denies an unknown role even for connection-status browsing", async () => {
    const f = fixture({ action: "status", admin: { id: "admin-a", role: "FUTURE_STAFF", read_only: false, suspended: false } });
    expect((await f.handler(f.request)).status).toBe(403);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("preserves attributable service-role token operations", async () => {
    const f = fixture({ service: true });
    expect((await f.handler(f.request)).status).toBe(200);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(f.queries).toEqual([]);
  });

  it("preserves same-tenant SUPER_ADMIN support for a paused operator", async () => {
    const f = fixture({ subscription: "PAUSED", admin: { id: "admin-a", role: "SUPER_ADMIN", read_only: false, suspended: false } });
    expect((await f.handler(f.request)).status).toBe(200);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["suspended admin", { admin: { id: "admin-a", role: "OPERATOR", read_only: false, suspended: true } }],
    ["read-only demo", { admin: { id: "admin-a", role: "OPERATOR", read_only: true, suspended: false } }],
    ["inactive tenant", { subscription: "SUSPENDED" }],
    ["failed subscription lookup", { subscriptionError: true }],
    ["foreign tenant", { admin: null }],
  ])("denies %s before provider access", async (_label, options) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture(options);
    expect((await f.handler(f.request)).status).toBe(403);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("allows a read-only demo to browse connection status", async () => {
    const f = fixture({ action: "status", admin: { id: "admin-a", role: "OPERATOR", read_only: true, suspended: false } });
    expect((await f.handler(f.request)).status).toBe(200);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("denies a suspended admin even for status browsing", async () => {
    const f = fixture({ action: "status", admin: { id: "admin-a", role: "OPERATOR", read_only: false, suspended: true } });
    expect((await f.handler(f.request)).status).toBe(403);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
