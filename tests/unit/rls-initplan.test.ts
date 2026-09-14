import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// RLS predicates that call a per-request function without wrapping it in a
// scalar subquery are re-evaluated for EVERY ROW scanned. Invisible on a
// 172-row table; at 4M rows it is the difference between a page load and a
// timeout. security-baseline.json is the committed snapshot of live policy
// state, so asserting against it catches a regression the moment the baseline
// is refreshed after someone reintroduces the bare form.
describe("RLS predicates are hoisted out of the row loop", () => {
  const baseline = JSON.parse(readFileSync("supabase/security-baseline.json", "utf8"));
  const policies: Array<{ tablename: string; policyname: string; qual: string | null; with_check: string | null }> =
    baseline.policies;

  const predicate = (p: (typeof policies)[number]) => (p.qual || "") + " " + (p.with_check || "");

  it("has policies to check", () => {
    expect(policies.length).toBeGreaterThan(200);
  });

  it("no policy calls auth.role() or auth.uid() outside a subquery", () => {
    const offenders = policies
      .filter((p) => /auth\.(role|uid|jwt)\(\)/.test(predicate(p)))
      .filter((p) => !/\(\s*SELECT\s+auth\.(role|uid|jwt)\(\)/.test(predicate(p)))
      .map((p) => p.tablename + "." + p.policyname);
    expect(offenders).toEqual([]);
  });

  it("no policy calls current_setting() outside a subquery", () => {
    const offenders = policies
      .filter((p) => /current_setting\(/.test(predicate(p)))
      .filter((p) => !/\(\s*SELECT\s+current_setting\(/.test(predicate(p)))
      .map((p) => p.tablename + "." + p.policyname);
    expect(offenders).toEqual([]);
  });

  it("no policy calls bt_request_header() outside a subquery", () => {
    const offenders = policies
      .filter((p) => /bt_request_header\(/.test(predicate(p)))
      .filter((p) => !/\(\s*SELECT\s+bt_request_header\(/.test(predicate(p)))
      .map((p) => p.tablename + "." + p.policyname);
    expect(offenders).toEqual([]);
  });

  // The tenant-scoping helper is used by 166 policies. 165 already kept it
  // inside a subquery; llm_usage_auth_select used the bare
  // `= ANY (current_business_ids())` form, and llm_usage is the fastest-growing
  // table in the schema.
  //
  // The assertion is the bare form specifically, not a particular spelling of
  // the hoisted one. Two spellings are in use and EXPLAIN confirms both put the
  // call in a ProjectSet/InitPlan evaluated once per query:
  //   IN ( SELECT unnest(( SELECT current_business_ids() )) )   <- most policies
  //   IN ( SELECT unnest(current_business_ids()) )              <- holds.*
  // Only `= ANY (current_business_ids())` lands it in a per-row Filter.
  it("no policy calls current_business_ids() in a per-row filter", () => {
    const offenders = policies
      .filter((p) => /=\s*ANY\s*\(\s*(public\.)?current_business_ids\(\)\s*\)/.test(predicate(p)))
      .map((p) => p.tablename + "." + p.policyname);
    expect(offenders).toEqual([]);
  });

  it("every use of the tenant helper sits inside a subquery", () => {
    const offenders = policies
      .filter((p) => /current_business_ids/.test(predicate(p)))
      .filter((p) => !/\(\s*SELECT[\s\S]*current_business_ids/.test(predicate(p)))
      .map((p) => p.tablename + "." + p.policyname);
    expect(offenders).toEqual([]);
  });
});

// The tenant filter is the shape of nearly every query the app makes. Without a
// leading business_id index it is a full-table scan of every other tenant's
// rows — and bookings had 14 indexes, none of which served it.
describe("tenant-scoped tables can use an index for business_id", () => {
  const sql = readFileSync("supabase/migrations/20260804090000_rls_initplan_and_tenant_indexes.sql", "utf8");

  it.each([
    ["bookings", "idx_bookings_business_status"],
    ["bookings", "idx_bookings_business_slot"],
    ["logs", "idx_logs_business_created"],
    ["auto_messages", "idx_auto_messages_business"],
    ["outbox", "idx_outbox_business_status"],
  ])("%s has a leading business_id index (%s)", (_table, index) => {
    expect(sql).toContain(index);
  });

  it("leaves the advisor's 'unused' indexes alone", () => {
    // idx_scan = 0 on a 172-row table means Postgres preferred a seq scan, not
    // that the index is worthless. Dropping on that signal would be acting on
    // the size of the dataset rather than the value of the index.
    expect(sql).toContain("Deliberately NOT dropping the 34 indexes");
  });
});
