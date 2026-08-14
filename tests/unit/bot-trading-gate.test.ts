import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Pins the trading gate on every customer entry point. A suspended/paused
// tenant's storefront is closed and create-checkout rejects payment, so the
// bots must not walk customers into bookings (or spend LLM quota) either.
const fn = (name: string) =>
  readFileSync(resolve(__dirname, `../../supabase/functions/${name}/index.ts`), "utf8");

describe("trading gate coverage", () => {
  it("web-chat gates the bot for non-trading tenants", () => {
    const src = fn("web-chat");
    expect(src).toContain('from "../_shared/subscription.ts"');
    expect(src).toContain("getSubscriptionState(db, requestedBusinessId)");
    expect(src).toMatch(/if \(!subState\.trading\)/);
  });

  it("wa-webhook skips auto-reply for non-trading tenants, after the DELETE handler", () => {
    const src = fn("wa-webhook");
    expect(src).toContain('from "../_shared/subscription.ts"');
    // DELETE-keyword compliance must run before the gate so data-deletion
    // requests are honored even for suspended tenants.
    const deleteIdx = src.indexOf("DELETE_RE.test(input)");
    const gateIdx = src.indexOf("WA_BOT_SKIP_NOT_TRADING");
    expect(deleteIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeGreaterThan(deleteIdx);
  });

  it("payment entry points keep blockIfNotTrading", () => {
    expect(fn("create-checkout")).toContain("blockIfNotTrading");
    expect(fn("create-paysafe-checkout")).toContain("blockIfNotTrading");
  });

  it("rebook-booking's paid legs route through the gated create-checkout", () => {
    // No gate of its own by design: unpaid actions (claims, equal swaps,
    // contact updates) stay available to customers of a suspended tenant,
    // while any uplift payment goes through create-checkout, which blocks.
    expect(fn("rebook-booking")).toContain("/functions/v1/create-checkout");
  });
});
