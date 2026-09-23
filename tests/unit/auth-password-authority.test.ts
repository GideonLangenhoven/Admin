import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { sourceFunction, sourceHandler } from "../helpers/source-handler";

const ADMIN = {
  id: "admin-a",
  email: "staff@example.invalid",
  name: "Staff",
  role: "OPERATOR",
  business_id: "business-a",
  user_id: "auth-a",
  must_set_password: false,
  suspended: false,
  settings_permissions: {},
  read_only: false,
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function loginFixture(user: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const authWrites: unknown[] = [];
  const filters: Record<string, unknown> = {};
  const db = {
    from() {
      let patch: Record<string, unknown> | undefined;
      const query: any = {
        select: () => query,
        update: (value: Record<string, unknown>) => { patch = value; return query; },
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        maybeSingle: async () => {
          const matches = (!filters.email || filters.email === user.email)
            && (!filters.user_id || filters.user_id === user.user_id);
          if (matches && patch) { updates.push(patch); Object.assign(user, patch); }
          return { data: matches ? user : null, error: null };
        },
      };
      query.then = (resolve: (value: unknown) => unknown) => query.maybeSingle().then(resolve);
      return query;
    },
    auth: {
      getUser: vi.fn(async (token: string) => token === "linked-session"
        ? { data: { user: { id: "auth-a", email: user.email } }, error: null }
        : { data: { user: null }, error: { message: "invalid" } }),
      admin: {
        createUser: vi.fn(async () => { authWrites.push("create"); return { data: { user: { id: "auth-new" } }, error: null }; }),
        updateUserById: vi.fn(async () => { authWrites.push("update"); return { error: null }; }),
      },
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
  const handler = sourceHandler("app/api/admin/login/route.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "../../../lib/admin-password": {
      setAdminAuthPassword: async () => { authWrites.push("migrate"); return "auth-new"; },
    },
  });
  const invoke = (body: object, token?: string) => handler(new Request("https://admin.example.invalid/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { invoke, updates, authWrites };
}

describe("Supabase Auth is authoritative after legacy migration", () => {
  it("reauthenticates through an isolated client without replacing the shared browser session", async () => {
    const signInWithPassword = vi.fn(async () => ({
      data: { session: { access_token: "fresh-password-token" } },
      error: null,
    }));
    const createClient = vi.fn(() => ({ auth: { signInWithPassword } }));
    const reauthenticate = sourceFunction("app/lib/admin-auth.ts", "reauthenticateAdminPassword", {
      createClient,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon" } },
    });

    await expect(reauthenticate(" Staff@Example.Invalid ", "current-password")).resolves.toBe("fresh-password-token");
    expect(createClient).toHaveBeenCalledWith("https://fixture.invalid", "fixture-anon", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "staff@example.invalid", password: "current-password" });
    expect(readFileSync("app/change-password/page.tsx", "utf8")).not.toContain('from "../lib/supabase"');
  });

  it("accepts a linked account from its verified Auth session without reading the password hash", async () => {
    const f = loginFixture({ ...ADMIN, password_hash: hash("unrelated-password") });
    const response = await f.invoke({}, "linked-session");
    expect(response.status).toBe(200);
    expect((await response.json()).admin.email).toBe(ADMIN.email);
    expect(f.authWrites).toEqual([]);
  });

  it("requires browser Auth for a linked account instead of accepting its duplicate SHA-256 hash", async () => {
    const f = loginFixture({ ...ADMIN, password_hash: hash("legacy-copy") });
    const response = await f.invoke({ email: ADMIN.email, password: "legacy-copy" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid credentials" });
    expect(f.authWrites).toEqual([]);
  });

  it("does not disclose account state before a password or Auth identity is verified", async () => {
    for (const user of [
      { ...ADMIN, email: "someone-else@example.invalid" },
      { ...ADMIN, suspended: true, must_set_password: true },
      { ...ADMIN, user_id: null, password_hash: hash("real-password"), suspended: true, must_set_password: true },
    ]) {
      const f = loginFixture(user);
      const response = await f.invoke({ email: ADMIN.email, password: "wrong-password" });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Invalid credentials" });
      expect(f.authWrites).toEqual([]);
    }
  });

  it("reveals setup and suspension state only after verified credentials", async () => {
    const setup = loginFixture({ ...ADMIN, user_id: null, password_hash: hash("legacy-password"), must_set_password: true });
    const setupResponse = await setup.invoke({ email: ADMIN.email, password: "legacy-password" });
    expect(setupResponse.status).toBe(403);
    expect(await setupResponse.json()).toMatchObject({ code: "MUST_SET_PASSWORD" });

    const suspended = loginFixture({ ...ADMIN, suspended: true });
    const suspendedResponse = await suspended.invoke({}, "linked-session");
    expect(suspendedResponse.status).toBe(403);
    expect(await suspendedResponse.json()).toEqual({ error: "Account is suspended. Contact support." });
  });

  it("uses a genuine legacy hash once, links Auth, and clears the duplicate hash", async () => {
    const f = loginFixture({ ...ADMIN, user_id: null, password_hash: hash("legacy-password") });
    const response = await f.invoke({ email: ADMIN.email, password: "legacy-password" });
    expect(response.status).toBe(200);
    expect(f.authWrites).toEqual(["migrate"]);
    expect(f.updates).toContainEqual(expect.objectContaining({ user_id: "auth-new", password_hash: null }));
  });
});

function setupFixture(options: { authFails?: boolean; completeFails?: boolean; claimStatus?: "INVALID" | "COMPLETED" } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let claimed = false;
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "claim_admin_setup_token") {
        if (options.claimStatus) return { data: { status: options.claimStatus, admin: { ...ADMIN } }, error: null };
        if (claimed) return { data: { status: "BUSY" }, error: null };
        claimed = true;
        return { data: { status: "CLAIMED", admin: { ...ADMIN } }, error: null };
      }
      if (name === "complete_admin_setup_token") {
        return options.completeFails ? { data: null, error: { message: "completion unavailable" } } : { data: true, error: null };
      }
      if (name === "release_admin_setup_token_claim") {
        claimed = false;
        return { data: true, error: null };
      }
      return { data: null, error: null };
    }),
    auth: { admin: {} },
  };
  let releaseAuth: (() => void) | undefined;
  const authWait = new Promise<void>((resolve) => { releaseAuth = resolve; });
  const setPassword = vi.fn(async () => {
    await authWait;
    if (options.authFails) throw new Error("Auth unavailable");
    return "auth-a";
  });
  const handler = sourceHandler("app/api/admin/setup-link/route.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "../../../lib/api-auth": {},
    "../../../lib/admin-password": { setAdminAuthPassword: setPassword },
  });
  const invoke = () => handler(Object.assign(new Request("https://admin.example.invalid/api/admin/setup-link", {
    method: "POST",
    body: JSON.stringify({ action: "complete", email: ADMIN.email, token: "setup-token", password: "Replacement-password" }),
  }), { nextUrl: new URL("https://admin.example.invalid") }));
  return { invoke, calls, setPassword, releaseAuth: () => releaseAuth?.() };
}

describe("password setup token claim", () => {
  it("rejects expired claims and treats completed-token replay as idempotent", async () => {
    const expired = setupFixture({ claimStatus: "INVALID" });
    expect((await expired.invoke()).status).toBe(401);
    expect(expired.setPassword).not.toHaveBeenCalled();

    const replay = setupFixture({ claimStatus: "COMPLETED" });
    const response = await replay.invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, idempotent: true, id: ADMIN.id });
    expect(replay.setPassword).not.toHaveBeenCalled();
  });

  it("allows only one simultaneous completion to reach Auth", async () => {
    const f = setupFixture();
    const first = f.invoke();
    await vi.waitFor(() => expect(f.setPassword).toHaveBeenCalledOnce());
    const second = await f.invoke();
    expect(second.status).toBe(409);
    f.releaseAuth();
    expect((await first).status).toBe(200);
    expect(f.setPassword).toHaveBeenCalledOnce();
  });

  it("releases the token claim when Auth or final database completion fails", async () => {
    for (const options of [{ authFails: true }, { completeFails: true }]) {
      const f = setupFixture(options);
      const response = f.invoke();
      f.releaseAuth();
      expect((await response).status).toBe(502);
      expect(f.calls.some((call) => call.name === "release_admin_setup_token_claim")).toBe(true);
    }
  });

  it("finalizes through the claim RPC without writing another password hash", async () => {
    const f = setupFixture();
    const response = f.invoke();
    f.releaseAuth();
    expect((await response).status).toBe(200);
    const complete = f.calls.find((call) => call.name === "complete_admin_setup_token");
    expect(complete?.args).toMatchObject({ p_user_id: "auth-a" });
    expect(Object.keys(complete?.args || {})).not.toContain("p_password_hash");
  });
});
