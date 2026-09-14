import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isTradingStatus } from "../../app/lib/api-auth";

// Security triage 2026-08-05, item 3 of 3 — "no subscription row must not
// default ACTIVE".
//
// Already closed in the code: gating moved off the `subscriptions` table
// (which has a row for 1 of 13 tenants, so `?? "ACTIVE"` granted full access
// to every tenant that never had one) onto businesses.subscription_status,
// which is NOT NULL and populated for every tenant. This test exists so the
// fail-closed behaviour cannot quietly regress.
const API_AUTH = readFileSync("app/lib/api-auth.ts", "utf8");
const EDGE_SUB = readFileSync("supabase/functions/_shared/subscription.ts", "utf8");

describe("isTradingStatus is an allowlist, not a denylist", () => {
  it("admits only the three trading states", () => {
    for (const s of ["ACTIVE", "TRIAL", "PAST_DUE", "active", "past_due"]) {
      expect(isTradingStatus(s), s).toBe(true);
    }
  });

  it("denies every non-trading and unknown value", () => {
    // The point of an allowlist: a status nobody has thought of yet is denied,
    // so a new billing state can never silently grant access.
    for (const s of ["SUSPENDED", "PAUSED", "CANCELLED", "INACTIVE", "PENDING", "SOMETHING_NEW", "", "   "]) {
      expect(isTradingStatus(s), s).toBe(false);
    }
  });

  it("denies a missing status rather than defaulting to trading", () => {
    expect(isTradingStatus(null)).toBe(false);
    expect(isTradingStatus(undefined)).toBe(false);
  });
});

describe("subscription lookups fail closed", () => {
  it("requireActiveSubscription denies on a lookup error or missing row", () => {
    const fn = API_AUTH.slice(API_AUTH.indexOf("export async function requireActiveSubscription"));
    expect(fn).toContain("if (error || !data)");
    expect(fn).toContain('return { active: false, status: "UNKNOWN" }');
  });

  it("gating reads businesses.subscription_status, not the sparse subscriptions table", () => {
    const fn = API_AUTH.slice(API_AUTH.indexOf("export async function requireActiveSubscription"));
    expect(fn).toContain('.from("businesses")');
    expect(fn).not.toContain('.from("subscriptions")');
    // The exact fail-open this item was raised about.
    expect(API_AUTH).not.toMatch(/\?\?\s*"ACTIVE"(?!` handed)/);
  });

  it("the edge-side batch gate treats a failed lookup as non-trading", () => {
    const fn = EDGE_SUB.slice(EDGE_SUB.indexOf("export async function nonTradingBusinessIds"));
    // On error every id comes back as non-trading, and ids absent from the
    // result are never added to `trading`, so a missing row blocks too.
    expect(fn).toContain("return new Set(unique);");
    expect(fn).toContain("isTradingStatus(b.subscription_status)");
  });
});
