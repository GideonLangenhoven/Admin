import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diffGrants, factsFromAllowlist, factsFromRows } from "../../scripts/check-grant-allowlist.mjs";

// S3 (security test G). The live comparison needs a database (scripts/check-grant-allowlist.mjs, run weekly and
// before deploys); these tests cover the comparison logic and guard the committed allowlist itself, so it cannot be
// quietly widened by "blessing" whatever is live.

const allowlist = JSON.parse(readFileSync("supabase/grant-allowlist.json", "utf8"));
const empty = { tables: [], columns: [], functions: [] };

describe("diffGrants", () => {
  const allowed = factsFromAllowlist({
    tables: { tours: { anon: ["SELECT"] } },
    columns: { anon: { bookings: { UPDATE: ["qty"] } } },
    functions: { anon: ["sign_waiver(p_booking_id uuid)"] },
  });
  const live = (over: Partial<typeof empty> = {}) =>
    factsFromRows({
      tables: [{ rel: "tours", role: "anon", priv: "SELECT" }],
      columns: [{ rel: "bookings", role: "anon", priv: "UPDATE", col: "qty" }],
      functions: [{ role: "anon", sig: "sign_waiver(p_booking_id uuid)" }],
      ...over,
    });

  it("passes when live equals the allowlist", () => {
    expect(diffGrants(live(), allowed)).toEqual({ extra: [], missing: [] });
  });

  it("flags an extra table privilege", () => {
    const d = diffGrants(live({ tables: [{ rel: "tours", role: "anon", priv: "SELECT" }, { rel: "tours", role: "anon", priv: "DELETE" }] }), allowed);
    expect(d.extra).toEqual(["table  anon  tours  DELETE"]);
  });

  it("flags a grant on a table that is not allowlisted at all", () => {
    const d = diffGrants(live({ tables: [{ rel: "tours", role: "anon", priv: "SELECT" }, { rel: "customers", role: "anon", priv: "INSERT" }] }), allowed);
    expect(d.extra).toEqual(["table  anon  customers  INSERT"]);
  });

  it("flags an extra column-level grant", () => {
    const d = diffGrants(live({ columns: [{ rel: "bookings", role: "anon", priv: "UPDATE", col: "qty" }, { rel: "bookings", role: "anon", priv: "UPDATE", col: "status" }] }), allowed);
    expect(d.extra).toEqual(["column anon  bookings.status  UPDATE"]);
  });

  it("flags a new function that anon can execute (e.g. default PUBLIC EXECUTE on a new function)", () => {
    const d = diffGrants(live({ functions: [{ role: "anon", sig: "sign_waiver(p_booking_id uuid)" }, { role: "anon", sig: "export_everything()" }] }), allowed);
    expect(d.extra).toEqual(["func   anon  export_everything()"]);
  });

  it("flags the same grant held by the other role", () => {
    const d = diffGrants(live({ tables: [{ rel: "tours", role: "anon", priv: "SELECT" }, { rel: "tours", role: "authenticated", priv: "SELECT" }] }), allowed);
    expect(d.extra).toEqual(["table  authenticated  tours  SELECT"]);
  });

  it("reports a grant that disappeared as missing", () => {
    const d = diffGrants(live({ tables: [] }), allowed);
    expect(d.missing).toEqual(["table  anon  tours  SELECT"]);
    expect(d.extra).toEqual([]);
  });
});

describe("committed grant allowlist", () => {
  const tables = allowlist.tables as Record<string, Record<string, string[]>>;
  const privsOf = (rel: string, role: string) => tables[rel]?.[role] ?? [];
  const WRITES = ["INSERT", "UPDATE", "DELETE"];

  it("grants nobody TRUNCATE, REFERENCES or TRIGGER (TRUNCATE ignores RLS)", () => {
    for (const [rel, byRole] of Object.entries(tables))
      for (const [role, privs] of Object.entries(byRole))
        for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) expect(privs, `${role} on ${rel}`).not.toContain(p);
  });

  it("limits anon's table-level writes to the storefront's insert paths", () => {
    const writes: Record<string, string[]> = {};
    for (const [rel, byRole] of Object.entries(tables)) {
      const w = (byRole.anon ?? []).filter((p) => WRITES.includes(p));
      if (w.length) writes[rel] = w;
    }
    expect(writes).toEqual({ booking_add_ons: ["INSERT"], bookings: ["INSERT"], vouchers: ["INSERT"] });
  });

  it("limits anon's column-level writes to bookings (policy- and trigger-limited)", () => {
    const writes = Object.entries(allowlist.columns.anon ?? {}).filter(([, byPriv]) => WRITES.some((w) => (byPriv as Record<string, string[]>)[w]));
    expect(writes.map(([rel]) => rel)).toEqual(["bookings"]);
  });

  it.each([
    "chat_faq_entries", "chatbot_avatars", "combo_bookings", "combo_booking_items", "data_subject_requests", "marketing_automation_revisions",
    "marketing_deliveries", "marketing_journey_status_events", "marketing_permission_events", "otp_attempts", "pii_anonymization_log",
    "promotion_uses", "tenant_health",
  ])("gives anon nothing at all on %s", (rel) => {
    expect(privsOf(rel, "anon")).toEqual([]);
  });

  it("keeps anon's customers access read-only (bookings_read sub-queries it; RLS returns no rows)", () => {
    expect(privsOf("customers", "anon")).toEqual(["SELECT"]);
  });

  it("keeps the views read-only", () => {
    for (const view of ["tour_review_stats", "marketing_eligible_contacts", "operator_directory", "payment_recovery_bookings"])
      for (const role of ["anon", "authenticated"]) expect(privsOf(view, role).filter((p) => WRITES.includes(p)), `${role} on ${view}`).toEqual([]);
  });

  it("never lets authenticated create or delete admin rows directly (admin changes go through server routes)", () => {
    expect(privsOf("admin_users", "authenticated")).toEqual(["SELECT"]);
  });

  it("documents the three functions anon may call by design", () => {
    const anonFns: string[] = allowlist.functions.anon;
    for (const fn of ["current_business_ids()", "sign_waiver(", "validate_promo_code("]) expect(anonFns.some((s) => s.startsWith(fn))).toBe(true);
  });
});
