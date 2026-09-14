import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evenPercentSplit } from "../../app/lib/combo-splits";

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");

describe("single-operator combos", () => {
  it("even percent splits are integers summing to exactly 100", () => {
    for (let n = 1; n <= 10; n++) {
      const s = evenPercentSplit(n);
      expect(s).toHaveLength(n);
      expect(s.every((x) => Number.isInteger(x) && x > 0)).toBe(true);
      expect(s.reduce((a, b) => a + b, 0)).toBe(100);
    }
    expect(evenPercentSplit(3)).toEqual([34, 33, 33]);
  });

  // The API's partnership requirement only covers OTHER businesses' items, so
  // an offer whose legs all belong to the creator needs no partnership. If
  // this filter changes, own-tour combos silently 403.
  it("combo-offers route exempts the creator's own items from the partnership check", () => {
    const src = read("app/api/combo-offers/route.ts");
    expect(src).toContain('.filter((id: string) => id !== business_id)');
  });

  // Same-business combos must fall through to the Yoco collect-everything
  // path — Paysafe SplitPay is only for two DISTINCT operators.
  it("checkout only considers Paysafe when two distinct businesses are involved", () => {
    const src = read("supabase/functions/create-paysafe-checkout/index.ts");
    expect(src).toMatch(/paysafeEligible = legSpecs\.length === 2 && distinctBusinessIds\.length === 2/);
  });

  // A single-operator combo owes nobody: the settlement ledger must keep
  // skipping legs owned by the collector.
  it("settlement ledger skips collector-owned legs", () => {
    const src = read("app/api/combo-settlements/route.ts");
    expect(src).toContain("if (it.business_id === collector) continue;");
  });
});
