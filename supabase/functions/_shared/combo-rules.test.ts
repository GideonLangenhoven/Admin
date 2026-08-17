// SUPABASE_URL=x SUPABASE_SERVICE_ROLE_KEY=x deno test --allow-env _shared/combo-rules.test.ts
// (--allow-env because combo.ts transitively imports tenant.ts, which reads env at load)
// validateComboDates gates real checkouts and reschedules — these cases pin
// the calendar-day maths, including the midnight-crossing edge where two
// instants 2 hours apart sit on different SAST dates.
import { validateComboDates } from "./combo.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

const D = (day: number, hour = 9) =>
  `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+02:00`;

Deno.test("no rules passes anything", () => {
  assert(validateComboDates(null, [D(1), D(1)]).ok, "null rules");
  assert(validateComboDates({}, [D(5), D(1)]).ok, "empty rules");
});

Deno.test("min gap enforced between consecutive legs", () => {
  const rules = { min_gap_days: 7 };
  assert(!validateComboDates(rules, [D(1), D(5)]).ok, "4 days apart must fail");
  assert(!validateComboDates(rules, [D(1), D(7)]).ok, "6 days apart must fail");
  assert(validateComboDates(rules, [D(1), D(8)]).ok, "7 days apart passes");
  // gap is symmetric when order is not enforced
  assert(validateComboDates(rules, [D(8), D(1)]).ok, "reverse order, 7 apart passes");
  assert(!validateComboDates(rules, [D(5), D(1)]).ok, "reverse order, 4 apart fails");
});

Deno.test("max gap bounds the overall span", () => {
  const rules = { max_gap_days: 7 };
  assert(validateComboDates(rules, [D(1), D(8)]).ok, "7-day span passes");
  assert(!validateComboDates(rules, [D(1), D(9)]).ok, "8-day span fails");
  // three legs: span is max minus min, not consecutive
  assert(!validateComboDates(rules, [D(1), D(4), D(9)]).ok, "3-leg 8-day span fails");
});

Deno.test("enforce_order requires non-decreasing dates", () => {
  const rules = { enforce_order: true };
  assert(validateComboDates(rules, [D(1), D(2)]).ok, "in order passes");
  assert(validateComboDates(rules, [D(1, 16), D(1, 9)]).ok, "same calendar day passes regardless of time");
  assert(!validateComboDates(rules, [D(2), D(1)]).ok, "out of order fails");
});

Deno.test("same-day legs: zero gap", () => {
  assert(validateComboDates({ min_gap_days: 1 }, [D(1, 9), D(1, 14)]).ok === false, "same day fails min_gap 1");
  assert(validateComboDates({ max_gap_days: 0 }, [D(1, 9), D(1, 14)]).ok, "same day passes max_gap 0");
  assert(!validateComboDates({ max_gap_days: 0 }, [D(1), D(2)]).ok, "different days fail max_gap 0");
});

Deno.test("dates compare in the tenant zone, not UTC", () => {
  // 23:30 SAST and 01:30 SAST next day are 2h apart but on different SAST
  // dates; in UTC they are 21:30 and 23:30 on the SAME date.
  const late = "2026-09-01T23:30:00+02:00";
  const early = "2026-09-02T01:30:00+02:00";
  assert(!validateComboDates({ max_gap_days: 0 }, [late, early]).ok, "different SAST dates must fail max_gap 0");
  assert(validateComboDates({ max_gap_days: 0 }, [late, early], "UTC").ok, "same UTC date passes when zone is UTC");
});

Deno.test("combined rules report the first violation", () => {
  const rules = { min_gap_days: 2, max_gap_days: 10, enforce_order: true };
  assert(validateComboDates(rules, [D(1), D(4)]).ok, "3-day forward gap passes all");
  const out = validateComboDates(rules, [D(4), D(1)]);
  assert(!out.ok && /in order/.test((out as any).error), "order violation named");
});

Deno.test("rules with non-numeric junk are ignored, not fatal", () => {
  const rules = { min_gap_days: "abc" as unknown as number, max_gap_days: null };
  assert(validateComboDates(rules, [D(1), D(1)]).ok, "junk min_gap ignored");
});
