import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// S4 — subscription suspension (A8) was never enforced server-side
// (CODE_AUDIT_2026-07-02): requireActiveSubscription existed but was never
// called, so a suspended (non-paying) tenant kept full API access. The shared
// getCallerAdmin boundary now fails closed for suspended tenants, with billing
// routes exempted so they can still reactivate.
describe("subscription suspension gate (S4)", () => {
  const auth = readFileSync("app/lib/api-auth.ts", "utf8");

  it("getCallerAdmin enforces active subscription by default", () => {
    expect(auth).toContain("skipSubscriptionCheck");
    expect(auth).toContain("const sub = await requireActiveSubscription(adminRow.business_id)");
    expect(auth).toContain("if (!sub.active) return null");
  });

  it("SUPER_ADMIN is exempt from the subscription gate", () => {
    expect(auth).toContain('adminRow.role !== "SUPER_ADMIN"');
  });

  it("the gate is opt-out, not opt-in (fail closed)", () => {
    expect(auth).toContain("if (!opts?.skipSubscriptionCheck && adminRow.role !== \"SUPER_ADMIN\")");
  });

  const billingRoutes = [
    "app/api/billing/subscription/route.ts",
    "app/api/billing/resume/route.ts",
    "app/api/billing/pause/route.ts",
    "app/api/billing/seats/route.ts",
    "app/api/billing/history/route.ts",
  ];
  it.each(billingRoutes)("billing route %s stays reachable when suspended", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).toContain("getCallerAdmin(req, { skipSubscriptionCheck: true })");
  });
});
