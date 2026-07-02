import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// S2 — broadcast had no authentication (CODE_AUDIT_2026-07-02): anyone could
// POST a business_id and mass-message that tenant's customers. The function
// must authenticate the caller and derive the target business from the
// caller's admin row — never from the request body (except SUPER_ADMIN /
// internal service calls, which are trusted to name a tenant).
describe("broadcast caller authorization (S2)", () => {
  const fn = readFileSync("supabase/functions/broadcast/index.ts", "utf8");
  const page = readFileSync("app/broadcasts/page.tsx", "utf8");

  it("authenticates before reading the request body", () => {
    const authIdx = fn.indexOf("await requireAuth(req)");
    const bodyIdx = fn.indexOf("await req.json()");
    expect(authIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(bodyIdx);
    expect(fn).toContain('{ error: "Unauthorized" }');
  });

  it("derives business_id from the caller, not the body, for regular admins", () => {
    expect(fn).toContain('auth.isServiceRole || auth.role === "SUPER_ADMIN"');
    expect(fn).toContain(": auth.businessId");
  });

  it("admin UI sends the admin JWT, not the anon key", () => {
    expect(page).toContain("getSession()).data.session?.access_token");
  });
});
