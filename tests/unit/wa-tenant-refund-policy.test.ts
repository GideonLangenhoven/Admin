import { expect, it } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// The WhatsApp bot answers cancellation questions from the tenant's refund
// policy, so the tenant it resolves from a webhook must carry that policy.
it("a WhatsApp tenant is loaded with its refund policy", async () => {
  const policy = { refund_policy_tiers: [{ hours_before: 48, refund_percent: 100 }], refund_policy_text: "Full refund up to 48 hours before." };
  let columns = "";
  const supabase = { from: () => {
    const q: any = { select: (cols: string) => { columns = cols; return q; }, eq: () => q,
      maybeSingle: async () => ({ data: Object.fromEntries(["id", ...columns.split(",")].map(key => [key, (policy as any)[key] ?? (key === "id" ? "tenant-a" : null)])), error: null }) };
    return q;
  } };
  const resolve = sourceFunction("supabase/functions/_shared/tenant.ts", "resolveTenantByWhatsappPayload", {
    normalizePhoneLookup: (value: string) => String(value || "").replace(/\D/g, ""),
    getBusinessCredentials: async () => ({ waPhoneId: "1234567890" }),
  });
  const tenant = await resolve(supabase, { entry: [{ changes: [{ value: { metadata: { phone_number_id: "1234567890" } } }] }] });
  expect(tenant.business).toMatchObject(policy);
});
