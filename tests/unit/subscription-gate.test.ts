import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isTradingStatus } from "../../app/lib/api-auth";

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

// The gate was enforced (above) but read the wrong column: subscriptions.status,
// defaulting a missing row to "ACTIVE". 12 of 13 tenants had no subscriptions
// row, so it granted full access to nearly every tenant. It now reads
// businesses.subscription_status, which is NOT NULL and populated for all.
describe("subscription gate — which statuses trade", () => {
  it("lets paying and trialling tenants through", () => {
    expect(isTradingStatus("ACTIVE")).toBe(true);
    expect(isTradingStatus("TRIAL")).toBe(true);
  });

  it("treats PAST_DUE as a warning, not a lockout", () => {
    expect(isTradingStatus("PAST_DUE")).toBe(true);
  });

  it("locks tenants who stopped paying or paused", () => {
    expect(isTradingStatus("SUSPENDED")).toBe(false);
    expect(isTradingStatus("PAUSED")).toBe(false);
    expect(isTradingStatus("CANCELLED")).toBe(false);
    expect(isTradingStatus("INACTIVE")).toBe(false);
  });

  // The property that matters: unknown input denies. A status nobody has taught
  // this function about must never grant access by accident.
  it("denies on unknown, empty, or absent status", () => {
    expect(isTradingStatus("GOLD_TIER")).toBe(false);
    expect(isTradingStatus("")).toBe(false);
    expect(isTradingStatus(null)).toBe(false);
    expect(isTradingStatus(undefined)).toBe(false);
  });

  it("is case-insensitive, so a lowercase write cannot lock a paying tenant out", () => {
    expect(isTradingStatus("active")).toBe(true);
  });

  const auth = readFileSync("app/lib/api-auth.ts", "utf8");

  it("reads businesses.subscription_status, not the sparse subscriptions table", () => {
    expect(auth).toContain('.from("businesses")');
    expect(auth).toContain('.select("subscription_status")');
  });

  it("fails closed and logs loudly when the tenant cannot be resolved", () => {
    expect(auth).toContain("SUBSCRIPTION_ROW_MISSING");
    expect(auth).toContain("SUBSCRIPTION_LOOKUP_FAILED");
    expect(auth).toContain('return { active: false, status: "UNKNOWN" }');
  });
});
