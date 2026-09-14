// Combo offer rule validation, shared by the combo-offers API create/update
// actions. Lives here rather than in the route so it stays unit-testable.
export const CANCELLATION_POLICIES = ["VOUCHER_ONLY", "NO_CANCEL", "POLICY_REFUND"];

// combo_rules is a whitelist, not a passthrough: unknown keys are dropped so a
// client can never park arbitrary jsonb on the offer. Enforcement of the rules
// themselves lives in the checkout edge function; this only decides what may be
// stored. Blank/garbage values clear a rule, out-of-range numbers are a 400 —
// silently dropping a limit the operator typed would surprise them later.
export function parseComboRules(raw: any): { rules: Record<string, unknown>; error?: string } {
  if (raw == null) return { rules: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { rules: {}, error: "combo_rules must be an object" };

  const rules: Record<string, unknown> = {};
  for (const key of ["min_gap_days", "max_gap_days"] as const) {
    const value = raw[key];
    if (value == null || value === "") continue;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) continue;
    if (key === "min_gap_days" && n < 1) return { rules: {}, error: "min_gap_days must be at least 1" };
    if (key === "max_gap_days" && n < 0) return { rules: {}, error: "max_gap_days cannot be negative" };
    rules[key] = n;
  }
  const min = rules.min_gap_days as number | undefined;
  const max = rules.max_gap_days as number | undefined;
  if (min != null && max != null && min > max) {
    return { rules: {}, error: "min_gap_days (" + min + ") cannot be greater than max_gap_days (" + max + ")" };
  }
  if (raw.enforce_order != null && raw.enforce_order !== "") rules.enforce_order = Boolean(raw.enforce_order);

  return { rules };
}
