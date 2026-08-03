import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeAiOverage, AI_QUOTA_FNS, AI_HARD_CEILING_MULTIPLE } from "../../app/lib/platform-billing";

// Fix 3: a paused or suspended operator stops taking NEW business, but keeps
// every obligation to customers who already paid. The two halves of that rule
// are enforced in different places, so both are pinned here.
describe("trading gate (Fix 3)", () => {
  const shared = readFileSync("supabase/functions/_shared/subscription.ts", "utf8");

  it("PAST_DUE still trades — it is a warning, not a lockout", () => {
    expect(shared).toContain('new Set(["ACTIVE", "TRIAL", "PAST_DUE"])');
  });

  it("fails closed when the tenant cannot be resolved", () => {
    expect(shared).toContain('return { status: "UNKNOWN", trading: false, suspensionReason: null }');
  });

  it("a failed batch lookup skips every tenant rather than sending anyway", () => {
    expect(shared).toContain("return new Set(unique);");
  });

  it("never tells a customer why the operator is closed", () => {
    // The whole customer-visible payload: message plus machine code. An
    // operator's billing trouble must not leak to their customers.
    const payload = shared.slice(shared.indexOf("export async function blockIfNotTrading"));
    const visible = [
      /error: "([^"]*)"/.exec(payload)?.[1] ?? "",
      /code: "([^"]*)"/.exec(payload)?.[1] ?? "",
    ].join(" ");
    expect(visible).toContain("not currently taking bookings");
    expect(visible).not.toMatch(/suspend|unpaid|overdue|billing|payment/i);
  });

  const gated: Array<[string, string]> = [
    ["supabase/functions/create-checkout/index.ts", "blockIfNotTrading"],
    ["supabase/functions/create-paysafe-checkout/index.ts", "blockIfNotTrading"],
    ["supabase/functions/marketing-dispatch/index.ts", "nonTradingBusinessIds"],
    ["supabase/functions/marketing-automation-dispatch/index.ts", "nonTradingBusinessIds"],
  ];
  it.each(gated)("%s gates on trading status", (path, symbol) => {
    expect(readFileSync(path, "utf8")).toContain(symbol);
  });

  // The obligations half. If someone later "tidies up" by gating these too, a
  // paused operator's already-paid customers stop getting their trip reminders
  // and confirmations — which is the failure this rule exists to prevent.
  const obligations = [
    "supabase/functions/auto-messages/index.ts",
    "supabase/functions/reminder-scheduler/index.ts",
    "supabase/functions/cron-tasks/index.ts",
    "supabase/functions/confirm-booking/index.ts",
  ];
  it.each(obligations)("%s keeps serving existing bookings when paused", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).not.toContain("blockIfNotTrading");
    expect(src).not.toContain("nonTradingBusinessIds");
  });
});

// Fix 4: the enforcement linkage between an unpaid invoice and trading state.
describe("billing enforcement (Fix 4)", () => {
  const fn = readFileSync("supabase/functions/billing-enforcement/index.ts", "utf8");
  const billing = readFileSync("supabase/functions/_shared/billing.ts", "utf8");

  it("rejects unauthenticated callers", () => {
    expect(fn).toContain("Unauthorized");
    expect(fn).toContain("const authorised =");
  });

  it("is idempotent: transitions are guarded on the current status", () => {
    expect(fn).toContain('status !== "SUSPENDED"');
    expect(fn).toContain('(status === "ACTIVE" || status === "TRIAL")');
  });

  it("only ever auto-restores a non-payment lockout", () => {
    expect(billing).toContain('status === "SUSPENDED" && reason === "NON_PAYMENT"');
    expect(billing).toContain('if (status !== "PAST_DUE" && !autoSuspended) return false;');
  });

  it("does not restore while any other invoice is still outstanding", () => {
    expect(billing).toContain("if (outstanding !== false) return false;");
  });

  it("the manual mark-paid route carries the same restore rule", () => {
    const route = readFileSync("app/api/platform-invoices/mark-paid/route.ts", "utf8");
    expect(route).toContain('status === "PAST_DUE" || (status === "SUSPENDED" && reason === "NON_PAYMENT")');
    expect(route).toContain("BILLING_RESTORED");
  });
});

// AI fair-use cap.
describe("AI fair-use cap", () => {
  it("bills only replies past the included allowance", () => {
    expect(computeAiOverage(2500, 3000, 0.15)).toEqual({ overageReplies: 0, overageZar: 0 });
    expect(computeAiOverage(3200, 3000, 0.15)).toEqual({ overageReplies: 200, overageZar: 30 });
  });

  it("never bills a negative overage", () => {
    expect(computeAiOverage(0, 3000, 0.15).overageZar).toBe(0);
  });

  it("counts customer-facing replies only, never the classifiers", () => {
    expect(AI_QUOTA_FNS).toContain("wa-faq");
    expect(AI_QUOTA_FNS).toContain("web-faq");
    expect(AI_QUOTA_FNS).not.toContain("wa-intent");
    expect(AI_QUOTA_FNS).not.toContain("wa-date");
    expect(AI_QUOTA_FNS).not.toContain("wa-v2-shadow");
    expect(AI_QUOTA_FNS).not.toContain("admin-help");
  });

  it("keeps the Deno enforcer's list identical to the admin app's", () => {
    const llm = readFileSync("supabase/functions/_shared/llm.ts", "utf8");
    const match = llm.match(/export const QUOTA_FNS = (\[[^\]]*\])/);
    expect(match).toBeTruthy();
    expect(JSON.parse(match![1].replace(/'/g, '"'))).toEqual(AI_QUOTA_FNS);
    expect(llm).toContain("const HARD_CEILING_MULTIPLE = " + AI_HARD_CEILING_MULTIPLE);
  });

  // The one place in this change set that fails OPEN, on purpose: a broken
  // counter must not silence a paying operator's bot.
  it("fails open when the counter is unreadable", () => {
    const llm = readFileSync("supabase/functions/_shared/llm.ts", "utf8");
    const quota = llm.slice(llm.indexOf("export async function withinAiQuota"), llm.indexOf("// Meter a completion"));
    expect(quota).toContain("AI_QUOTA_COUNT_ERR");
    expect(quota.match(/return true;/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
