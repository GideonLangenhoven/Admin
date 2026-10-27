import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { driveCallbackUrl, isAllowedDriveReturnOrigin } from "../../supabase/functions/_shared/google-drive-oauth";
import { sourceHandler } from "../helpers/source-handler";

describe("Google Drive operator callback", () => {
  it("relays the authorization code to the operator's admin origin", () => {
    const url = new URL(driveCallbackUrl("https://ocean.admin.bookingtours.co.za", "opaque-state", "auth-code", null));
    expect(url.origin).toBe("https://ocean.admin.bookingtours.co.za");
    expect(url.pathname).toBe("/google-callback");
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("code")).toBe("auth-code");
  });

  it.each([
    "https://evil.example",
    "https://ocean.admin.bookingtours.co.za.evil.example",
    "http://ocean.admin.bookingtours.co.za",
    "https://ocean.admin.bookingtours.co.za/extra",
    "https://ocean.admin.bookingtours.co.za@evil.example",
  ])("rejects an untrusted return address: %s", (origin) => {
    expect(isAllowedDriveReturnOrigin(origin)).toBe(false);
    expect(() => driveCallbackUrl(origin, "state", "code", null)).toThrow("Invalid operator return address");
  });
});

describe("Google Drive connection authorization", () => {
  const origin = "https://aonyx.admin.bookingtours.co.za";
  const nonce = "11111111-1111-4111-8111-111111111111";

  function fixture({ role = "MAIN_ADMIN", businessId = "aonyx", suspended = false, readOnly = false, validSession = true } = {}) {
    const filters: Record<string, unknown> = {};
    const getUser = vi.fn(async () => ({
      data: { user: validSession ? { id: "operator" } : null },
      error: validSession ? null : new Error("Invalid session"),
    }));
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      maybeSingle: async () => ({ data: (filters.business_id === undefined || filters.business_id === businessId) && filters.user_id === "operator"
        ? { id: "admin", business_id: businessId, role, suspended, read_only: readOnly } : null }),
    };
    const from = vi.fn((table: string) => {
      if (table !== "admin_users") throw new Error("Unexpected database access: " + table);
      return query;
    });
    const rpc = vi.fn(async () => ({ error: null }));
    const provider = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture-access", refresh_token: "fixture-refresh" });
      if (url === "https://www.googleapis.com/oauth2/v2/userinfo") return Response.json({ email: "owner@example.test" });
      if (url === "https://www.googleapis.com/drive/v3/files") return Response.json({ id: "fixture-folder" });
      throw new Error("Unexpected provider call: " + url);
    });
    const handler = sourceHandler("supabase/functions/google-drive/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({ auth: { getUser }, from, rpc }) },
      "../_shared/google-drive-oauth.ts": { isAllowedDriveReturnOrigin },
    }, {
      SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
      GOOGLE_CLIENT_ID: "fixture-client-id", GOOGLE_CLIENT_SECRET: "fixture-client-secret",
      SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-32-characters",
    }, provider);
    return {
      getUser, from, filters, rpc, provider,
      invoke: (token = "operator-session", returnOrigin = origin, action = "auth_url") => handler(new Request("https://fixture.invalid", {
        method: "POST", headers: { ...(token ? { Authorization: "Bearer " + token } : {}), Origin: origin },
        body: JSON.stringify({ action, business_id: "aonyx", return_origin: returnOrigin, nonce, ...(action === "exchange" ? { code: "fixture-code" } : {}) }),
      })),
    };
  }

  it("uses in-function authorization instead of the incompatible legacy gateway", () => {
    expect(readFileSync("supabase/config.toml", "utf8")).toMatch(/\[functions\.google-drive\]\s*\nverify_jwt = false/);
  });

  it("validates the operator session and business before returning the Google authorization URL", async () => {
    const f = fixture();
    const response = await f.invoke();
    expect(response.status).toBe(200);
    expect(f.getUser).toHaveBeenCalledWith("operator-session");
    expect(f.filters).toEqual({ user_id: "operator" });
    const url = new URL((await response.json()).url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(JSON.parse(atob(url.searchParams.get("state")!))).toEqual({ business_id: "aonyx", return_origin: origin, nonce });
  });

  it("rejects missing authorization before accessing the database", async () => {
    const f = fixture();
    expect((await f.invoke("")).status).toBe(401);
    expect(f.from).not.toHaveBeenCalled();
  });

  it("rejects invalid sessions before accessing the database", async () => {
    const f = fixture({ validSession: false });
    expect((await f.invoke()).status).toBe(401);
    expect(f.from).not.toHaveBeenCalled();
  });

  it.each([
    { role: "ADMIN" },
    { role: "GUIDE" },
    { businessId: "another-operator" },
    { suspended: true },
    { readOnly: true },
  ])("rejects callers without permission to connect this business: %j", async options => {
    expect((await fixture(options).invoke()).status).toBe(403);
  });

  it("rejects an OAuth return origin that differs from the operator's browser origin", async () => {
    expect((await fixture().invoke("operator-session", "https://other.admin.bookingtours.co.za")).status).toBe(403);
  });

  it.each([
    ["MAIN_ADMIN", "aonyx", "auth_url"],
    ["MAIN_ADMIN", "aonyx", "exchange"],
    ["SUPER_ADMIN", "platform", "auth_url"],
    ["SUPER_ADMIN", "platform", "exchange"],
  ])("allows %s from %s to complete %s for the selected operator", async (role, businessId, action) => {
    const f = fixture({ role, businessId });
    expect((await f.invoke("operator-session", origin, action)).status).toBe(200);
    expect(f.getUser).toHaveBeenCalledWith("operator-session");
    if (action === "exchange") {
      expect(f.rpc).toHaveBeenCalledWith("set_gdrive_credentials", expect.objectContaining({
        p_business_id: "aonyx", p_refresh_token: "fixture-refresh", p_folder_id: "fixture-folder",
      }));
    }
  });

  it.each([
    { role: "MAIN_ADMIN", businessId: "another-operator" },
    { role: "SUPER_ADMIN", businessId: "platform", suspended: true },
    { role: "SUPER_ADMIN", businessId: "platform", readOnly: true },
  ])("rejects an unauthorized callback before contacting Google or saving credentials: %j", async options => {
    const f = fixture(options);
    expect((await f.invoke("operator-session", origin, "exchange")).status).toBe(403);
    expect(f.provider).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
