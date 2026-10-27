import { describe, expect, it } from "vitest";
import { acquisitionAttribution, projectOperatorOutcomes, readOperatorOutcomes } from "../../scripts/operator-acquisition-report.mjs";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const at = "2026-10-02T10:00:00Z";
// Fictional records only. They are not production conversions.
const account = { business_id: id(1), user_id: id(2), role: "MAIN_ADMIN", auth_user_created_at: at };
const invoice = { source_table: "platform_invoices", id: id(3), business_id: id(1), status: "PAID", paid_method: "YOCO", yoco_payment_id: true, monthly_price_zar: 100, amount_zar: 100, paid_at: at };

describe("operator acquisition outcomes", () => {
  it("projects confirmed subscription payments with stable deduplication", () => {
    const result = projectOperatorOutcomes({ accounts: [account,account], invoices: [invoice,invoice] });
    expect(result.map(row => row.event)).toEqual(["operator_subscription_payment_confirmed"]);
    expect(new Set(result.map(row => row.event_id)).size).toBe(1);
    expect(result.every(row => row.source === "unknown")).toBe(true);
    expect(result[0]).toMatchObject({ payment_environment: "unknown", live_conversion_confirmed: null });
  });
  it("does not infer historical operator signup from linked Auth creation or current roles", () => {
    expect(projectOperatorOutcomes({ accounts: [account,{ ...account, user_id: null },{ ...account,auth_user_created_at: null },{ ...account, role: "OPERATOR" }] })).toEqual([]);
  });
  it("does not turn owner changes or migrated password accounts into acquired businesses", () => {
    const result = projectOperatorOutcomes({ accounts: [account,{ ...account,user_id:id(4),auth_user_created_at:"2026-10-02T09:00:00Z" }] });
    expect(result).toEqual([]);
  });
  it.each([
    { source_table: "bookings" }, { status: "SENT" }, { status: "PAID_MANUALLY" }, { paid_method: "MANUAL" },
    { yoco_payment_id: false }, { monthly_price_zar: 0 }, { amount_zar: 0 }, { paid_at: null },
  ])("does not fabricate a software conversion from %j", extra => {
    expect(projectOperatorOutcomes({ invoices: [{ ...invoice,...extra }] })).toEqual([]);
  });
  it("does not infer a trial from ACTIVE/current TRIAL or a go-live event", () => {
    expect(projectOperatorOutcomes({ statusEvents: [{ business_id:id(1),action_type:"BUSINESS_SETUP_COMPLETED",after_status:"ACTIVE",created_at:at },{ business_id:id(1),after_status:"TRIAL",created_at:at }] })).toEqual([]);
    expect(projectOperatorOutcomes({ statusEvents: [{ business_id:id(1),target_id:id(1),target_entity:"businesses",action_type:"BUSINESS_STATUS_CHANGED",before_status:"INACTIVE",after_status:"TRIAL",created_at:at }] })).toMatchObject([{ event:"trial_activated" }]);
  });
  it("needs analytics consent and records coarse campaign tags as tags, not verified platform referrals", () => {
    const params = new URLSearchParams("utm_source=chatgpt&utm_medium=referral&utm_campaign=operator-demo");
    expect(acquisitionAttribution(params,{ analyticsConsent:false,approvedCampaigns:["operator-demo"] })).toBeNull();
    expect(acquisitionAttribution(params,{ analyticsConsent:true,approvedCampaigns:["operator-demo"] })).toEqual({ source:"chatgpt",medium:"referral",campaign:"operator-demo",basis:"campaign_tag" });
    expect(acquisitionAttribution(new URLSearchParams(),{ analyticsConsent:true })).toEqual({ source:"unknown",medium:null,campaign:null,basis:"unknown" });
  });
  it("recognises the ChatGPT domain tag without trusting lookalike domains or bypassing consent", () => {
    const params = new URLSearchParams("utm_source=chatgpt.com&utm_medium=referral");
    expect(acquisitionAttribution(params,{ analyticsConsent:false })).toBeNull();
    expect(acquisitionAttribution(params,{ analyticsConsent:true })).toEqual({ source:"chatgpt",medium:"referral",campaign:null,basis:"campaign_tag" });
    params.set("utm_source","chatgpt.com.attacker.invalid");
    expect(acquisitionAttribution(params,{ analyticsConsent:true })).toMatchObject({ source:"unknown",basis:"unknown" });
  });
  it("drops PII, arbitrary URLs and unapproved tracking fields", () => {
    const params = new URLSearchParams("utm_source=name@example.invalid&utm_campaign=name@example.invalid&email=person@example.invalid&url=https://private.invalid&token=secret");
    expect(acquisitionAttribution(params,{ analyticsConsent:true,approvedCampaigns:["name@example.invalid"] })).toEqual({ source:"unknown",medium:null,campaign:null,basis:"unknown" });
  });
  it("reads bounded authoritative tables in a read-only transaction and returns no payment identifiers", async () => {
    const queries: string[] = [];
    const client = { async query(sql: string) {
      queries.push(sql);
      return { rows: sql.includes("FROM public.platform_invoices") ? [invoice] : [] };
    } };
    const report = await readOperatorOutcomes(client,{ businessIds:[id(1)],startAt:"2026-10-01T00:00:00Z",endAt:"2026-10-03T00:00:00Z" });
    expect(report.events).toHaveLength(1);
    expect(report.coverage.operator_account_created).toContain("unavailable");
    expect(queries[0]).toBe("BEGIN READ ONLY");
    expect(queries.at(-1)).toBe("ROLLBACK");
    expect(queries.join(" ")).not.toMatch(/SELECT \*|FROM public\.bookings|auth\.users|email|phone|notes|INSERT|UPDATE|DELETE/);
    expect(JSON.stringify(report)).not.toMatch(/yoco_payment_id|customer_name|email/);
  });
  it("fails explicitly on upstream failures and excessive queries", async () => {
    const queries: string[] = [];
    const client = { async query(sql: string) { queries.push(sql); if (sql.includes("FROM public.platform_invoices")) throw new Error("upstream failed"); return { rows:[] }; } };
    await expect(readOperatorOutcomes(client,{ businessIds:[id(1)],startAt:"2026-10-01",endAt:"2026-10-03" })).rejects.toThrow("upstream failed");
    expect(queries.at(-1)).toBe("ROLLBACK");
    await expect(readOperatorOutcomes(client,{ businessIds:Array.from({ length:51 },()=>id(1)),startAt:"2026-10-01",endAt:"2026-10-03" })).rejects.toThrow("1–50");
  });
});
