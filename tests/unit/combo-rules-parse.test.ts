import { describe, expect, it } from "vitest";
import { CANCELLATION_POLICIES, parseComboRules } from "../../app/lib/combo-rules";

// The combo-offers API is the trust boundary for offer config: it decides what
// may be stored in combo_offers.combo_rules, and create-paysafe-checkout then
// enforces whatever landed there. A silent inversion here either stores a rule
// nobody asked for or drops one an operator set, so the branches are pinned.
describe("parseComboRules", () => {
  const rules = (raw: any) => parseComboRules(raw).rules;
  const error = (raw: any) => parseComboRules(raw).error;

  it("stores nothing when there are no rules", () => {
    expect(rules(undefined)).toEqual({});
    expect(rules(null)).toEqual({});
    expect(rules({})).toEqual({});
  });

  it("coerces the form's string values to integers", () => {
    expect(rules({ min_gap_days: "7" })).toEqual({ min_gap_days: 7 });
    expect(rules({ min_gap_days: 7.9 })).toEqual({ min_gap_days: 7 });
    expect(rules({ min_gap_days: 2, max_gap_days: 30, enforce_order: true }))
      .toEqual({ min_gap_days: 2, max_gap_days: 30, enforce_order: true });
  });

  it("treats blank and unparseable values as 'no rule'", () => {
    expect(rules({ min_gap_days: "", max_gap_days: null })).toEqual({});
    expect(rules({ min_gap_days: "abc" })).toEqual({});
  });

  // max_gap_days 0 means every leg on the same day. It is falsy, so any
  // truthiness check here would silently drop a real rule.
  it("keeps max_gap_days of 0", () => {
    expect(rules({ max_gap_days: 0 })).toEqual({ max_gap_days: 0 });
  });

  it("never stores keys outside the whitelist", () => {
    expect(rules({ evil: "x", combo_price: 1, min_gap_days: 2 })).toEqual({ min_gap_days: 2 });
  });

  it("coerces enforce_order to a boolean", () => {
    expect(rules({ enforce_order: true })).toEqual({ enforce_order: true });
    expect(rules({ enforce_order: false })).toEqual({ enforce_order: false });
  });

  // Rejected rather than dropped: an operator who typed a limit should be told
  // it was refused, not discover at checkout that it never applied.
  it("rejects out-of-range gaps", () => {
    expect(error({ min_gap_days: 0 })).toBeTruthy();
    expect(error({ min_gap_days: -3 })).toBeTruthy();
    expect(error({ max_gap_days: -1 })).toBeTruthy();
  });

  it("rejects an unsatisfiable min/max pair but allows equal ones", () => {
    expect(error({ min_gap_days: 10, max_gap_days: 3 })).toBeTruthy();
    expect(error({ min_gap_days: 5, max_gap_days: 5 })).toBeUndefined();
    expect(rules({ min_gap_days: 5, max_gap_days: 5 })).toEqual({ min_gap_days: 5, max_gap_days: 5 });
  });

  it("rejects non-object payloads", () => {
    expect(error([1, 2])).toBeTruthy();
    expect(error("nope")).toBeTruthy();
  });

  it("stores no rules alongside an error", () => {
    expect(rules({ min_gap_days: 10, max_gap_days: 3 })).toEqual({});
  });

  // The DB has a CHECK on these three; drift would turn a 400 into a 500.
  it("matches the cancellation_policy CHECK constraint", () => {
    expect(CANCELLATION_POLICIES).toEqual(["VOUCHER_ONLY", "NO_CANCEL", "POLICY_REFUND"]);
  });
});
