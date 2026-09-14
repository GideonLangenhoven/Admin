import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sourceFunction, sourceHandler } from "../helpers/source-handler";
import * as readiness from "../../supabase/functions/_shared/ota-readiness";

const externalFile = "supabase/functions/external-booking/index.ts";

function credentialLookup(encrypted: string | null, result: any, key = "encryption-key") {
  const select = vi.fn();
  const query: any = { select: (columns: string) => { select(columns); return query; }, eq: () => query,
    maybeSingle: async () => ({ data: { id: "credential", business_id: "operator", hmac_secret_encrypted: encrypted } }) };
  const rpc = vi.fn(async () => result);
  const find = sourceFunction(externalFile, "findCredentialByApiKey", {
    sha256Hex: async () => "hashed-key", db: { from: () => query, rpc }, SETTINGS_ENCRYPTION_KEY: key,
  });
  return { find, select, rpc };
}

describe("external booking encrypted credentials", () => {
  it("uses only the encrypted column and decrypts through the service RPC", async () => {
    const { find, select, rpc } = credentialLookup("ciphertext", { data: [{ hmac_secret: "secret" }] });
    expect((await find("PARTNER", "key")).hmac_secret).toBe("secret");
    expect(select.mock.calls[0][0].split(", ")).not.toContain("hmac_secret");
    expect(rpc).toHaveBeenCalledWith("get_external_booking_credentials", { p_credential_id: "credential", p_key: "encryption-key" });
  });

  it.each([
    [{ error: new Error("decryption failed") }, "key"],
    [{ data: [] }, "key"],
    [{ data: [{ hmac_secret: null }] }, "key"],
    [{ data: [{ hmac_secret: "secret" }] }, ""],
  ])("fails closed instead of downgrading an encrypted credential", async (result, key) => {
    const { find } = credentialLookup("ciphertext", result, key as string);
    await expect(find("PARTNER", "key")).rejects.toBeTruthy();
  });

  it("supports availability-only credentials without a secret", async () => {
    const { find, rpc } = credentialLookup(null, {}, "");
    expect((await find("PARTNER", "key")).hmac_secret).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("retires the public plaintext backfill without database access", async () => {
    const from = vi.fn(() => { throw new Error("Unexpected DB access"); });
    const handler = sourceHandler(externalFile, {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({ from }) },
    }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture" });
    const response = await handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ action: "backfill_hmac" }) }));
    expect(response.status).toBe(410);
    expect(from).not.toHaveBeenCalled();
  });
});

it.each(["viator-webhook", "getyourguide-webhook", "viator-availability-sync", "getyourguide-availability-sync", "ota-reconcile"])("blocks %s before DB work or provider traffic", async (name) => {
  const from = vi.fn(() => { throw new Error("Unexpected DB access"); });
  const fetchAllRows = vi.fn(() => { throw new Error("Unexpected DB scan"); });
  const handler = sourceHandler(`supabase/functions/${name}/index.ts`, {
    "../_shared/tenant.ts": { createServiceClient: () => ({ from }), fetchAllRows },
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: unknown) => fn },
    "../_shared/ota-readiness.ts": readiness,
    "../_shared/viator.ts": {}, "../_shared/getyourguide.ts": {},
  }, { SETTINGS_ENCRYPTION_KEY: "configured" });
  const response = await handler(new Request("https://fixture.invalid?b=operator", { method: "POST", body: "{}" }));
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe("OTA_NOT_READY");
  expect(from).not.toHaveBeenCalled();
  expect(fetchAllRows).not.toHaveBeenCalled();
});

it.each([
  { action: "toggle_enabled", enabled: true },
  { action: "toggle_test_mode", test_mode: true },
  { action: "save_credentials", api_key: "key" },
])("rejects unverified OTA activation/configuration: $action", async (body) => {
  const createClient = vi.fn(() => { throw new Error("Unexpected DB access"); });
  const handler = sourceHandler("app/api/ota/route.ts", {
    "@supabase/supabase-js": { createClient },
    "../../lib/api-auth": { getCallerAdmin: async () => ({ role: "MAIN_ADMIN", business_id: "operator" }), isPrivilegedRole: () => true },
    "../../../supabase/functions/_shared/ota-readiness": readiness,
  });
  const response = await handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ business_id: "operator", channel: "VIATOR", ...body }) }));
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe("OTA_NOT_READY");
  expect(createClient).not.toHaveBeenCalled();
});

it("still allows an operator to disable a legacy connection without an encryption key", async () => {
  const update = vi.fn();
  const query: any = { update: (value: unknown) => { update(value); return query; }, eq: () => query, then: (resolve: any) => Promise.resolve({ error: null }).then(resolve) };
  const handler = sourceHandler("app/api/ota/route.ts", {
    "@supabase/supabase-js": { createClient: () => ({ from: () => query }) },
    "../../lib/api-auth": { getCallerAdmin: async () => ({ role: "MAIN_ADMIN", business_id: "operator" }), isPrivilegedRole: () => true },
    "../../../supabase/functions/_shared/ota-readiness": readiness,
  });
  const response = await handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ business_id: "operator", channel: "VIATOR", action: "toggle_enabled", enabled: false }) }));
  expect(response.status).toBe(200);
  expect(update.mock.calls[0][0].enabled).toBe(false);
});

it.each([{ error: new Error("HMAC save failed") }, { data: { success: false } }, "network failure"])("does not announce success or display an unsaved HMAC secret", async (result) => {
  const setCredentialMessage = vi.fn();
  const setGeneratedSecrets = vi.fn();
  const setSavingCredential = vi.fn();
  const setEditingCredentialId = vi.fn();
  const loadCredentials = vi.fn();
  const query: any = { insert: () => query, select: () => query, single: async () => ({ data: { id: "new-credential" } }) };
  const save = sourceFunction("components/ExternalBookingSettings.tsx", "handleSaveCredential", {
    credentialForm: { source: "PARTNER", active: true, hmacEnabled: true }, editingCredentialId: null, businessId: "operator",
    setCredentialMessage, setGeneratedSecrets, setSavingCredential, setEditingCredentialId, setCredentialForm: vi.fn(),
    randomHex: () => "generated-secret", sha256Hex: async () => "hash",
    supabase: { from: () => query, functions: { invoke: async () => { if (result === "network failure") throw new Error(result); return result; } } },
    loadCredentials, resetCredentialForm: vi.fn(),
  });
  await save({ preventDefault() {} });
  expect(setCredentialMessage.mock.calls.at(-1)?.[0].type).toBe("error");
  expect(setGeneratedSecrets.mock.calls.at(-1)?.[0]).toMatchObject({ apiKey: "ckext_generated-secret", hmacSecret: null });
  expect(setEditingCredentialId).toHaveBeenCalledWith("new-credential");
  expect(setSavingCredential).toHaveBeenLastCalledWith(false);
  expect(loadCredentials).not.toHaveBeenCalled();
});

it.each([
  ["MAIN_ADMIN", "operator", 200],
  ["SUPER_ADMIN", "other", 200],
  ["MAIN_ADMIN", "other", 403],
  ["OPS", "operator", 403],
  ["SUPER_IMPOSTOR", "operator", 403],
  ["MAIN_ADMIN", "operator", 403, true],
  ["SUPER_ADMIN", "other", 403, true],
])("restricts HMAC administration to active authorised roles (%s, %s)", async (role, businessId, status, suspended = false) => {
  const rpc = vi.fn(async () => ({ error: null }));
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, rpc,
    from: (table: string) => {
      const data = table === "admin_users" ? [{ business_id: businessId, role, suspended }] : { business_id: "operator" };
      const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data }),
        then: (resolve: any) => Promise.resolve({ data }).then(resolve) };
      return query;
    },
  };
  const handler = sourceHandler(externalFile, {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
  }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture", SETTINGS_ENCRYPTION_KEY: "key" });
  const response = await handler(new Request("https://fixture.invalid", {
    method: "POST", headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ action: "admin_set_hmac", credential_id: "credential", hmac_secret: "secret" }),
  }));
  expect(response.status).toBe(status);
  expect(rpc).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
});

it("does not read the retired plaintext secret in the operator UI", () => {
  const source = readFileSync("components/ExternalBookingSettings.tsx", "utf8");
  expect(source).not.toContain("row.hmac_secret)");
  expect(source).not.toContain("api_key_last4, hmac_secret,");
});
