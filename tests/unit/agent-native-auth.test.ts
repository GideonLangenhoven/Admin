import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { operatorIdentity } from "../../app/lib/agent-oauth";

// REAL local native Supabase Auth; SYNTHETIC account; actual application identity function.
// No business schema, capacity, consent UI, HTTPS gateway or provider connection is tested here.
const statusPath = process.env.AGENT_NATIVE_AUTH_TEST_STATUS || "";
if (statusPath && !/^\/private\/tmp\/bookingtours-mcp-practice-\d{8}\/native\/status\.private\.json$/.test(statusPath))
  throw new Error("Native Auth rehearsal requires an explicitly labelled temporary practice status file");
let settings: Record<string,string>;
function loadPractice() {
  settings = JSON.parse(readFileSync(statusPath,"utf8"));
  const report = JSON.parse(readFileSync(statusPath.replace(/status\.private\.json$/, "setup-status.json"),"utf8"));
  const api = new URL(settings.API_URL);
  const database = new URL(settings.DB_URL);
  if (api.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(api.hostname) || api.port !== "54871"
    || !["127.0.0.1", "localhost"].includes(database.hostname) || database.port !== "54872"
    || report.loopback_only !== true || report.production_link !== false || report.application_schema_loaded !== false)
    throw new Error("Refusing to test outside the verified isolated practice environment");
}

let admin: SupabaseClient;
let publicClient: SupabaseClient;
let userId = "";
let token = "";
let deleted = false;
const email = "mcp-practice-" + randomBytes(12).toString("hex") + "@example.invalid";
const password = "Practice-" + randomBytes(24).toString("base64url");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const request = (value?: string) => new Request("http://127.0.0.1:3223/__synthetic_identity_test", {
  headers: value ? { authorization: "Bearer " + value } : {},
});
const forged = () => {
  const parts = token.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  return parts.join(".");
};

describe.skipIf(!statusPath).sequential("actual operator identity with real local native Supabase Auth", () => {
  beforeAll(async () => {
    loadPractice();
    for (const name of ["AGENT_CHATGPT_ENABLED", "AGENT_MUSE_ENABLED", "AGENT_DATABASE_URL", "AGENT_PUBLIC_ORIGIN"])
      vi.stubEnv(name, "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", settings.API_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", settings.ANON_KEY);
    // Service key is used ONLY to create/delete this random, labelled local Auth fixture.
    // The application's operatorIdentity uses the public key and real native getUser validation.
    admin = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, options);
    publicClient = createClient(settings.API_URL, settings.ANON_KEY, options);
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
      app_metadata: { fixture: "synthetic-local-mcp-practice-20261004" } });
    if (created.error || !created.data.user?.id) throw new Error("Synthetic local Auth fixture creation failed; details redacted");
    userId = created.data.user.id;
    const signedIn = await publicClient.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session?.access_token) throw new Error("Synthetic native sign-in failed; details redacted");
    token = signedIn.data.session.access_token;
  });

  afterAll(async () => {
    if (admin && userId && !deleted) {
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) throw new Error("Synthetic local fixture cleanup failed; details redacted");
    }
    vi.unstubAllEnvs();
  });

  it("accepts the real native sign-in JWT for the synthetic account", async () => {
    expect(await operatorIdentity(request(token)) === userId).toBe(true);
  });

  it("rejects a missing login credential", async () => {
    await expect(operatorIdentity(request())).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("rejects an opaque fixture agent token as a native login credential", async () => {
    const opaqueFixture = "bta_" + randomBytes(32).toString("base64url");
    await expect(operatorIdentity(request(opaqueFixture))).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    const native = await publicClient.auth.getUser(opaqueFixture);
    expect(Boolean(native.error) && !native.data.user).toBe(true);
  });

  it("uses native Auth to reject a forged signature on a genuine JWT", async () => {
    await expect(operatorIdentity(request(forged()))).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("fails closed if the native public-key configuration is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    try {
      await expect(operatorIdentity(request(token))).rejects.toMatchObject({ code: "INTEGRATION_DISABLED", status: 503 });
    } finally {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", settings.ANON_KEY);
    }
  });

  it("does not log private account fields, native JWTs or development keys", async () => {
    const spies = [vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
    try {
      await operatorIdentity(request(token));
      await expect(operatorIdentity(request(forged()))).rejects.toMatchObject({ status: 401 });
      const messages = JSON.stringify(spies.flatMap(spy => spy.mock.calls));
      expect([email, password, token, settings.ANON_KEY, settings.SERVICE_ROLE_KEY]
        .some(value => messages.includes(value))).toBe(false);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("rejects a previously valid JWT after its synthetic identity is deleted", async () => {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw new Error("Synthetic local identity deletion failed; details redacted");
    deleted = true;
    await expect(operatorIdentity(request(token))).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });
});
