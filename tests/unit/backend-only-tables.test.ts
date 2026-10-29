import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// S7: a table with RLS enabled and no policy denies everything to anon and authenticated. Each one must be a
// recorded decision (a comment in a migration) and must not quietly hold a grant. The set is derived from the
// drift baseline, so adding a policy-less table without documenting it fails here.

const baseline = JSON.parse(readFileSync("supabase/security-baseline.json", "utf8"));
const allowlist = JSON.parse(readFileSync("supabase/grant-allowlist.json", "utf8"));

const withPolicy = new Set<string>(baseline.policies.map((p: { tablename: string }) => p.tablename));
const noPolicy: string[] = baseline.rls_status
  .filter((t: { rls_enabled: boolean; table_name: string }) => t.rls_enabled && !withPolicy.has(t.table_name))
  .map((t: { table_name: string }) => t.table_name)
  .sort();

// Documented by earlier migrations, before this review.
const ALREADY_DOCUMENTED = ["ngt_intake_submissions", "ngt_payments"];

describe("backend-only (RLS on, no policy) tables", () => {
  const sql = readFileSync("supabase/migrations/20261029121000_document_backend_only_tables.sql", "utf8");
  const commented = [...sql.matchAll(/^COMMENT ON TABLE public\.([a-z_]+) IS '/gm)].map((m) => m[1]).sort();

  it("finds the 25 policy-less tables the review covered", () => {
    expect(noPolicy).toHaveLength(25);
  });

  it("documents every one of them (a new policy-less table must be commented or given a policy)", () => {
    expect(commented).toEqual(noPolicy.filter((t) => !ALREADY_DOCUMENTED.includes(t)));
  });

  it.each(noPolicy)("%s: anon and authenticated hold no grant", (table) => {
    expect(allowlist.tables[table], table).toBeUndefined();
  });

  it("combo_settlements is readable by its two parties only: a SELECT policy, no policy for other commands, SELECT-only grant", () => {
    const policies = baseline.policies.filter((p: { tablename: string }) => p.tablename === "combo_settlements");
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({ cmd: "SELECT", roles: "{authenticated}", policyname: "combo_settlements_parties_select" });
    expect(policies[0].qual).toContain("collector_business_id");
    expect(policies[0].qual).toContain("owed_business_id");
    expect(allowlist.tables.combo_settlements).toEqual({ authenticated: ["SELECT"] });
  });
});
