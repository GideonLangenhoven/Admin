import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";
import { canManageAdmin, isPrivilegedRole } from "../../app/lib/role-utils";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(options: { callerRole?: string; callerBusiness?: string; targetRole?: string; self?: boolean; unlinked?: boolean; authFailure?: string; saveFailure?: boolean; conflict?: boolean; busy?: boolean; anonymous?: boolean } = {}) {
  const target = { id: id(1), user_id: options.unlinked ? null : id(2), business_id: id(3), role: options.targetRole || "MAIN_ADMIN", email: "owner@example.invalid", name: "Owner", phone: null as string | null,
    must_set_password: !!options.unlinked, invite_sent_at: "2026-10-01", setup_token_claim_id: options.busy ? id(8) : null, setup_token_claimed_at: new Date().toISOString() };
  const caller = options.anonymous ? null : { id: options.self ? target.id : id(4), role: options.callerRole || "MAIN_ADMIN", business_id: options.callerBusiness || id(3) };
  const audit = vi.fn(), updateAuth = vi.fn(async (_id, attrs) => {
    if (options.authFailure) return { error: { code: options.authFailure } };
    // The separate PostgreSQL suite exercises this transactional trigger.
    target.email = attrs.email;
    target.invite_sent_at = null as any;
    return { data: { user: { id: target.user_id, email: target.email } }, error: null };
  });
  const writes: unknown[] = [];
  const db = {
    from(table: string) {
      let patch: any, conflictLookup = false;
      const filters: [string, unknown][] = [];
      const execute = async () => {
        if (conflictLookup) return { data: options.conflict ? { id: id(9) } : null, error: null };
        if (patch && options.saveFailure) return { data: null, error: { code: "fixture_failure" } };
        if (!filters.every(([key, value]) => target[key as keyof typeof target] === value)) return { data: null, error: null };
        if (patch) { writes.push(patch); Object.assign(target, patch); }
        return { data: { ...target }, error: null };
      };
      const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
        ilike: () => { conflictLookup = true; return q; }, neq: () => q,
        update: (value: unknown) => { patch = value; return q; }, maybeSingle: execute,
        insert: async (value: unknown) => { audit(table, value); return { error: null }; } };
      return q;
    }, auth: { admin: { updateUserById: updateAuth } },
  };
  const handler = sourceHandler("app/api/admin/contact/route.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "../../../lib/api-auth": { getCallerAdmin: async () => caller, canManageAdmin, isPrivilegedRole },
  });
  const invoke = (overrides: Record<string, unknown> = {}) => handler(new Request("https://test.invalid", { method: "POST", body: JSON.stringify({
    admin_id: target.id, expected_email: target.email, name: "Updated Owner", email: "new@example.invalid", phone: "+27 (82) 555-0100", ...overrides,
  }) }));
  return { target, invoke, updateAuth, writes, audit };
}

describe("admin contact editing", () => {
  for (const callerRole of ["MAIN_ADMIN", "SUPER_ADMIN"]) it(`${callerRole} updates an existing main admin`, async () => {
    const f = fixture({ callerRole });
    const response = await f.invoke({ email: " NEW@Example.invalid " });
    expect(response.status).toBe(200);
    expect((await response.json()).admin).toMatchObject({ id: id(1), name: "Updated Owner", email: "new@example.invalid", phone: "+27 (82) 555-0100" });
    expect(f.updateAuth).toHaveBeenCalledWith(id(2), { email: "new@example.invalid", email_confirm: true });
    expect(f.target.role).toBe("MAIN_ADMIN");
    expect(f.audit).toHaveBeenCalledWith("audit_logs", expect.objectContaining({ action_type: "ADMIN_CONTACT_UPDATED", before_state: expect.objectContaining({ email: "owner@example.invalid" }) }));
  });
  it("allows a main admin to edit their own account", async () => {
    expect(await (await fixture({ self: true }).invoke()).json()).toMatchObject({ ok: true, self: true });
  });
  for (const options of [{ callerRole: "ADMIN" }, { callerRole: "GUIDE" }, { anonymous: true }, { callerBusiness: id(99) }, { targetRole: "SUPER_ADMIN" }, { callerRole: "SUPER_ADMIN", callerBusiness: id(99) }]) {
    it(`denies unauthorized edits ${JSON.stringify(options)}`, async () => {
      const f = fixture(options);
      expect((await f.invoke()).status).toBe(403);
      expect(f.updateAuth).not.toHaveBeenCalled(); expect(f.writes).toEqual([]);
    });
  }
  it("allows platform admins to edit a platform admin in the selected business", async () => {
    expect((await fixture({ callerRole: "SUPER_ADMIN", targetRole: "SUPER_ADMIN" }).invoke()).status).toBe(200);
  });
  it("saves an unlinked invitation without creating or taking over an Auth account", async () => {
    const f = fixture({ unlinked: true });
    expect((await f.invoke()).status).toBe(200); expect(f.updateAuth).not.toHaveBeenCalled(); expect(f.target.user_id).toBeNull();
  });
  it("clears an optional phone and saves a name without changing Auth", async () => {
    const f = fixture(); f.target.phone = "+27825550100";
    expect((await f.invoke({ email: f.target.email, phone: " " })).status).toBe(200);
    expect(f.target.phone).toBeNull(); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  for (const body of [{ name: " " }, { name: "n".repeat(121) }, { email: "bad" }, { email: "guide+test@guides.bookingtours.co.za" }, { email: {} }, { phone: {} }, { phone: "abc" }, { phone: "1234" }, { phone: "1".repeat(41) }, { admin_id: "invalid" }]) {
    it(`validates contact fields ${JSON.stringify(body)}`, async () => {
      const f = fixture(); expect((await f.invoke(body)).status).toBe(400); expect(f.updateAuth).not.toHaveBeenCalled(); expect(f.writes).toEqual([]);
    });
  }
  for (const options of [{ authFailure: "email_exists" }, { authFailure: "user_already_exists" }, { conflict: true }, { busy: true }]) {
    it(`refuses conflicting changes ${JSON.stringify(options)}`, async () => {
      const f = fixture(options); expect((await f.invoke()).status).toBe(409); expect(f.writes).toEqual([]); expect(f.target.email).toBe("owner@example.invalid");
    });
  }
  it("rejects a stale editor before changing the sign-in identity", async () => {
    const f = fixture(); expect((await f.invoke({ expected_email: "previous@example.invalid" })).status).toBe(409); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  it("does not save profile details when Auth fails", async () => {
    const f = fixture({ authFailure: "unexpected_failure" }); expect((await f.invoke()).status).toBe(502); expect(f.writes).toEqual([]);
  });
  it("returns the actual email if later profile saving fails, without rolling back over another edit", async () => {
    const f = fixture({ self: true, saveFailure: true }); const response = await f.invoke();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ self: true, admin: { email: "new@example.invalid", name: "Owner" } });
    expect(f.updateAuth).toHaveBeenCalledOnce();
  });
});
