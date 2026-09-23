import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

const TARGET = {
  id: "admin-a",
  email: "staff@example.invalid",
  name: "Staff",
  role: "ADMIN",
  business_id: "business-a",
};

function resetFixture(options: {
  found?: boolean;
  issueStatus?: string;
  issueError?: boolean;
  lookupError?: boolean;
  deliveryError?: boolean;
  origin?: string | null;
  serviceConfigured?: boolean;
  privileged?: boolean;
} = {}) {
  const jobs: Array<() => void | Promise<void>> = [];
  const calls: string[] = [];
  const emails: any[] = [];
  const db = {
    from: () => {
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
          calls.push("lookup");
          return {
            data: options.found === false ? null : TARGET,
            error: options.lookupError ? { message: "private lookup detail" } : null,
          };
        },
      };
      return query;
    },
    rpc: vi.fn(async () => {
      calls.push("issue");
      return {
        data: { status: options.issueStatus || "ISSUED" },
        error: options.issueError ? { message: "private database detail" } : null,
      };
    }),
    functions: {
      invoke: vi.fn(async (_name: string, payload: unknown) => {
        calls.push("email");
        emails.push(payload);
        return {
          error: options.deliveryError ? {
            message: "private provider detail",
            context: { json: async () => ({ providerResponse: { sandboxNote: "private sandbox note" } }) },
          } : null,
        };
      }),
    },
  };
  const handler = sourceHandler("app/api/admin/setup-link/route.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "../../../lib/api-auth": {
      getCallerAdmin: async () => options.privileged ? { id: "owner", role: "MAIN_ADMIN", business_id: TARGET.business_id } : null,
      isPrivilegedRole: () => true,
      canManageAdmin: () => true,
    },
    "../../../lib/admin-password": {},
    "next/server": {
      NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
      after: (job: () => void | Promise<void>) => { jobs.push(job); },
    },
  }, {
    ...(options.origin === null ? {} : { ADMIN_RECOVERY_ORIGIN: options.origin || "https://trusted.example.invalid" }),
    ...(options.serviceConfigured === false ? { SUPABASE_SERVICE_ROLE_KEY: "missing" } : {}),
  });
  const invoke = (payload?: unknown) => handler(Object.assign(new Request("https://attacker.example.invalid/api/admin/setup-link", {
    method: "POST",
    headers: { Host: "attacker.example.invalid", Origin: "https://evil.example.invalid" },
    body: JSON.stringify(payload ?? (options.privileged
      ? { action: "send", reason: "ADMIN_INVITE", admin_id: TARGET.id }
      : { action: "send", reason: "RESET", email: TARGET.email })),
  }), { nextUrl: new URL("https://attacker.example.invalid/api/admin/setup-link") }));
  return { invoke, jobs, calls, emails, db, flush: async () => { for (const job of jobs) await job(); } };
}

describe("public administrator recovery", () => {
  it("rejects coerced action and reason values before scheduling recovery", async () => {
    for (const payload of [
      { action: ["send"], reason: "RESET", email: TARGET.email },
      { action: "send", reason: ["RESET"], email: TARGET.email },
    ]) {
      const f = resetFixture();
      expect((await f.invoke(payload)).status).toBe(400);
      expect(f.jobs).toEqual([]);
      expect(f.calls).toEqual([]);
    }
  });

  it("returns one immediate contract across known, missing, busy, and provider failures", async () => {
    let body: unknown;
    const logs: string[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((message: string) => { logs.push(message); });
    try {
      for (const options of [
        {},
        { found: false },
        { issueStatus: "BUSY" },
        { issueError: true },
        { lookupError: true },
        { deliveryError: true },
      ]) {
        const f = resetFixture(options);
        const response = await f.invoke();
        expect(response.status).toBe(200);
        expect(f.calls).toEqual([]);
        expect(f.jobs).toHaveLength(1);
        const result = await response.json();
        body ??= result;
        expect(result).toEqual(body);
        expect(JSON.stringify(result)).not.toMatch(/token|provider|sandbox|expires_at/i);
        await f.flush();
      }
    } finally {
      consoleError.mockRestore();
    }
    expect(logs).toContain("ADMIN_RESET_DELIVERY_ERR");
    expect(logs.join(" ")).not.toMatch(/private|provider|sandbox|token/i);
  });

  it("uses only the configured HTTPS origin despite hostile request headers", async () => {
    const f = resetFixture();
    await f.invoke();
    await f.flush();
    expect(f.emails).toHaveLength(1);
    const url = new URL(f.emails[0].body.data.change_password_url);
    expect(url.origin).toBe("https://trusted.example.invalid");
    expect(url.searchParams.get("email")).toBe(TARGET.email);
    expect(url.searchParams.get("token")).toMatch(/^[0-9a-f]{48}$/);
  });

  it("rejects an insecure configured origin before issuing a token", async () => {
    const f = resetFixture({ origin: "http://trusted.example.invalid" });
    const response = await f.invoke();
    expect(response.status).toBe(200);
    await f.flush();
    expect(f.db.rpc).not.toHaveBeenCalled();
    expect(f.emails).toEqual([]);
  });

  it("fails closed when no recovery origin is configured", async () => {
    const f = resetFixture({ origin: null });
    expect((await f.invoke()).status).toBe(200);
    await f.flush();
    expect(f.db.rpc).not.toHaveBeenCalled();
    expect(f.emails).toEqual([]);
  });

  it("keeps the public response generic during service configuration failure", async () => {
    const f = resetFixture({ serviceConfigured: false });
    expect(await (await f.invoke()).json()).toEqual({ ok: true, message: "If an admin account exists, a reset link will be emailed." });
    expect(f.jobs).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it("retains useful provider diagnostics for authorized invitations", async () => {
    const f = resetFixture({ privileged: true, deliveryError: true });
    const response = await f.invoke();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "private sandbox note" });
    expect(f.jobs).toEqual([]);
  });
});
