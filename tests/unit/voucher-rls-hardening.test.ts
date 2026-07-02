import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// S3 — tenant-isolation RLS hardening + voucher money holes (CODE_AUDIT_2026-07-02).
const migration = readFileSync(
  "supabase/migrations/20260702120000_s3_tenant_rls_hardening.sql",
  "utf8",
);
const checkout = readFileSync("supabase/functions/create-checkout/index.ts", "utf8");
const baseline = JSON.parse(readFileSync("supabase/security-baseline.json", "utf8"));

describe("reviews RLS tenant scoping (S3)", () => {
  it("authenticated read/update are scoped to current_business_ids(), not USING(true)", () => {
    expect(migration).toContain("CREATE POLICY reviews_authenticated_read");
    expect(migration).toContain("CREATE POLICY reviews_authenticated_update");
    const readIdx = migration.indexOf("reviews_authenticated_read");
    const scopedIdx = migration.indexOf("business_id = ANY (public.current_business_ids())");
    expect(scopedIdx).toBeGreaterThan(readIdx);
    expect(migration).not.toMatch(/reviews_authenticated_(read|update)[\s\S]*?USING \(true\)/);
  });

  it("baseline tracks the scoped reviews policies", () => {
    const revs = baseline.policies.filter((p: { tablename: string }) => p.tablename === "reviews");
    const authRead = revs.find((p: { policyname: string }) => p.policyname === "reviews_authenticated_read");
    expect(authRead.qual).toContain("current_business_ids()");
    expect(authRead.qual).not.toBe("true");
  });
});

describe("voucher anon RLS (S3)", () => {
  it("anon INSERT may only create PENDING vouchers in the header's tenant", () => {
    expect(migration).toContain("CREATE POLICY vouchers_anon_insert");
    expect(migration).toMatch(/status = 'PENDING'/);
    expect(migration).toContain("business_id::text = public.bt_request_header('x-tenant-business-id')");
  });

  it("anon UPDATE policy is dropped (no legitimate anon voucher mutation)", () => {
    expect(migration).toContain("DROP POLICY IF EXISTS vouchers_anon_update ON public.vouchers");
    expect(migration).not.toContain("CREATE POLICY vouchers_anon_update");
    const anonUpdate = baseline.policies.find(
      (p: { tablename: string; policyname: string }) =>
        p.tablename === "vouchers" && p.policyname === "vouchers_anon_update",
    );
    expect(anonUpdate).toBeUndefined();
  });

  it("baseline anon INSERT is no longer WITH CHECK(true)", () => {
    const ins = baseline.policies.find(
      (p: { tablename: string; policyname: string }) =>
        p.tablename === "vouchers" && p.policyname === "vouchers_anon_insert",
    );
    expect(ins.with_check).toContain("PENDING");
    expect(ins.with_check).not.toBe("true");
  });
});

describe("gift-voucher charge cannot be underpaid (S3)", () => {
  it("create-checkout overrides the client amount with the DB face value", () => {
    expect(checkout).toContain('if (type === "GIFT_VOUCHER" && voucherId)');
    expect(checkout).toContain("const faceValue = Number(gvRow.data.value");
    expect(checkout).toContain("amount = faceValue;");
    // the override must run before the Yoco charge is constructed
    const overrideIdx = checkout.indexOf("amount = faceValue;");
    const chargeIdx = checkout.indexOf("amount: Math.round(Number(amount) * 100)");
    expect(overrideIdx).toBeGreaterThan(-1);
    expect(chargeIdx).toBeGreaterThan(overrideIdx);
  });
});
